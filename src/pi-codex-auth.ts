import { Clock, Context, Effect, FileSystem, Layer } from "effect";

import {
  CODEX_PROVIDER_ID,
  codexCredentialIn,
  piAuthFilePath,
  readAuthFile,
  writeAuthFile,
} from "./auth-file.js";
import type { CodexCredential } from "./auth-file.js";
import { withPiAuthLock } from "./auth-lock.js";
import { CodexTokenRefresher } from "./codex-refresher.js";
import type { PiCodexAuthError } from "./errors.js";

export const REFRESH_WHEN_UNDER_MILLIS = 5 * 60_000;

const expiresSoon = (credential: CodexCredential) =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) => credential.expires - now <= REFRESH_WHEN_UNDER_MILLIS)
  );

export class PiCodexAuth extends Context.Service<
  PiCodexAuth,
  {
    readonly file: string;
    readonly accessToken: Effect.Effect<string, PiCodexAuthError>;
  }
>()("@akshatag/pi-codex-auth/PiCodexAuth", {
  make: Effect.gen(function* makePiCodexAuth() {
    const fileSystem = yield* FileSystem.FileSystem;
    const refresher = yield* CodexTokenRefresher;
    const file = yield* piAuthFilePath;

    const current = readAuthFile(file).pipe(
      Effect.flatMap((contents) => codexCredentialIn(file, contents)),
      Effect.provideService(FileSystem.FileSystem, fileSystem)
    );

    const refreshUnderLock = withPiAuthLock(file, (stillHeld) =>
      Effect.gen(function* refreshUnderLock() {
        const contents = yield* readAuthFile(file);
        const credential = yield* codexCredentialIn(file, contents);

        if (!(yield* expiresSoon(credential))) {
          return credential.access;
        }

        const refreshed = yield* refresher.refresh(credential);
        yield* stillHeld;
        yield* writeAuthFile(file, {
          ...contents,
          [CODEX_PROVIDER_ID]: refreshed,
        });

        return refreshed.access;
      }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem))
    );

    const accessToken = Effect.gen(function* accessToken() {
      const credential = yield* current;

      return (yield* expiresSoon(credential))
        ? yield* refreshUnderLock
        : credential.access;
    }).pipe(Effect.withSpan("PiCodexAuth.accessToken"));

    return { accessToken, file } as const;
  }),
}) {
  static readonly layerWithoutRefresher = Layer.effect(this, this.make);

  static readonly layer = this.layerWithoutRefresher.pipe(
    Layer.provide(CodexTokenRefresher.layer)
  );
}
