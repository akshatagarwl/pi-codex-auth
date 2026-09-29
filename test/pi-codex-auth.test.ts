import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  ConfigProvider,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Ref,
} from "effect";
import lockfile from "proper-lockfile";

import {
  CodexTokenRefresher,
  PiAuthFileInvalid,
  PiCodexAuth,
  PiCodexNotLoggedIn,
  PiCodexRefreshFailed,
  REFRESH_WHEN_UNDER_MILLIS,
} from "../src/index.js";
import type { CodexCredential } from "../src/index.js";

const HOUR = 60 * 60_000;

const credential = (access: string, expires: number): CodexCredential => ({
  access,
  accountId: "account-1",
  expires,
  refresh: `refresh-${access}`,
  type: "oauth",
});

const otherProviders = {
  anthropic: { access: "a", expires: 1, refresh: "r", type: "oauth" },
};

interface Harness {
  readonly authFile: string;
  readonly refreshes: Ref.Ref<number>;
}

const inPiAgentDir = <A, E>(
  refresh: (current: CodexCredential) => Effect.Effect<CodexCredential, PiCodexRefreshFailed>,
  body: (harness: Harness) => Effect.Effect<A, E, PiCodexAuth | FileSystem.FileSystem>
) =>
  Effect.gen(function* inPiAgentDirBody() {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const agentDir = yield* fileSystem.makeTempDirectoryScoped();
    const refreshes = yield* Ref.make(0);
    const counted = Layer.succeed(CodexTokenRefresher, {
      refresh: (current) =>
        Ref.update(refreshes, (count) => count + 1).pipe(
          Effect.andThen(refresh(current))
        ),
    });
    const auth = PiCodexAuth.layerWithoutRefresher.pipe(
      Layer.provide(counted),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { PI_CODING_AGENT_DIR: agentDir } })
        )
      )
    );

    return yield* body({
      authFile: path.join(agentDir, "auth.json"),
      refreshes,
    }).pipe(Effect.provide(auth));
  }).pipe(Effect.scoped);

const seed = (file: string, contents: unknown) =>
  FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.writeFileString(file, JSON.stringify(contents, null, 2))
  );

const readBack = (file: string) =>
  FileSystem.FileSystem.use((fileSystem) => fileSystem.readFileString(file));

const renewTo = (access: string) => (current: CodexCredential) =>
  Effect.succeed({ ...current, access, expires: current.expires + HOUR });

const refreshMustNotRun = () =>
  Effect.fail(new PiCodexRefreshFailed({ reason: "refresh must not run" }));

const accessToken = PiCodexAuth.use((auth) => auth.accessToken);

describe("PiCodexAuth", () => {
  it.layer(NodeServices.layer)("accessToken", (test) => {
    test.effect("returns a fresh token without refreshing", () =>
      inPiAgentDir(refreshMustNotRun, ({ authFile, refreshes }) =>
        Effect.gen(function* freshCase() {
          yield* seed(authFile, {
            "openai-codex": credential("fresh", REFRESH_WHEN_UNDER_MILLIS + HOUR),
          });

          expect(yield* accessToken).toBe("fresh");
          expect(yield* Ref.get(refreshes)).toBe(0);
        })
      )
    );

    test.effect(
      "refreshes a stale token and rewrites auth.json the way pi does",
      () =>
        inPiAgentDir(renewTo("renewed"), ({ authFile }) =>
          Effect.gen(function* staleCase() {
            yield* seed(authFile, {
              ...otherProviders,
              "openai-codex": credential("old", REFRESH_WHEN_UNDER_MILLIS),
            });

            expect(yield* accessToken).toBe("renewed");

            const text = yield* readBack(authFile);
            const written = JSON.parse(text);
            expect(text).toBe(JSON.stringify(written, null, 2));
            expect(written.anthropic).toStrictEqual(otherProviders.anthropic);
            expect(written["openai-codex"].access).toBe("renewed");

            const info = yield* FileSystem.FileSystem.use((fileSystem) =>
              fileSystem.stat(authFile)
            );
            expect(info.mode & 0o777).toBe(0o600);
          })
        )
    );

    test.effect("leaves auth.json untouched when the refresh fails", () =>
      inPiAgentDir(
        () => Effect.fail(new PiCodexRefreshFailed({ reason: "invalid_grant" })),
        ({ authFile }) =>
          Effect.gen(function* refreshFailureCase() {
            yield* seed(authFile, { "openai-codex": credential("old", 0) });
            const before = yield* readBack(authFile);

            const error = yield* Effect.flip(accessToken);

            expect(error).toBeInstanceOf(PiCodexRefreshFailed);
            expect(yield* readBack(authFile)).toBe(before);
          })
      )
    );

    test.effect("reports a missing auth.json as not logged in", () =>
      inPiAgentDir(refreshMustNotRun, ({ authFile }) =>
        Effect.gen(function* missingFileCase() {
          const error = yield* Effect.flip(accessToken);

          expect(error).toBeInstanceOf(PiCodexNotLoggedIn);
          expect(error).toHaveProperty("file", authFile);
        })
      )
    );

    test.effect("reports an auth.json without a Codex login as not logged in", () =>
      inPiAgentDir(refreshMustNotRun, ({ authFile }) =>
        Effect.gen(function* noCodexEntryCase() {
          yield* seed(authFile, otherProviders);

          expect(yield* Effect.flip(accessToken)).toBeInstanceOf(
            PiCodexNotLoggedIn
          );
        })
      )
    );

    test.effect("rejects a malformed Codex entry", () =>
      inPiAgentDir(refreshMustNotRun, ({ authFile }) =>
        Effect.gen(function* malformedCase() {
          yield* seed(authFile, { "openai-codex": { access: 1 } });

          expect(yield* Effect.flip(accessToken)).toBeInstanceOf(
            PiAuthFileInvalid
          );
        })
      )
    );
  });
  it.live(
      "waits for pi's lock and skips the refresh pi already did",
      () =>
        inPiAgentDir(refreshMustNotRun, ({ authFile, refreshes }) =>
          Effect.gen(function* lockInteropCase() {
            const now = yield* Clock.currentTimeMillis;
            yield* seed(authFile, { "openai-codex": credential("old", now) });
            const release = yield* Effect.promise(() =>
              lockfile.lock(authFile, {
                onCompromised: () => undefined,
                realpath: false,
                stale: 30_000,
              })
            );
            const waiting = yield* Deferred.make<void>();

            const fiber = yield* accessToken.pipe(
              Effect.onExit(() => Deferred.succeed(waiting, undefined)),
              Effect.forkChild
            );
            yield* Effect.sleep("300 millis");
            expect(yield* Deferred.isDone(waiting)).toBe(false);

            yield* seed(authFile, {
              "openai-codex": credential("pi-refreshed", now + HOUR),
            });
            yield* Effect.promise(() => release());

            expect(yield* Fiber.join(fiber)).toBe("pi-refreshed");
            expect(yield* Ref.get(refreshes)).toBe(0);
          })
        ).pipe(Effect.provide(NodeServices.layer)),
      { timeout: 10_000 }
    );
});
