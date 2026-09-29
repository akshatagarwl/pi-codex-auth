import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { Context, Effect, Layer, Schema } from "effect";

const REFRESH_TIMEOUT = "15 seconds";

import { CodexCredentialSchema } from "./auth-file.js";
import type { CodexCredential } from "./auth-file.js";
import { PiCodexRefreshFailed } from "./errors.js";
import { redactedReason } from "./redact.js";

const decodeCredential = Schema.decodeUnknownEffect(CodexCredentialSchema);

export class CodexTokenRefresher extends Context.Service<
  CodexTokenRefresher,
  {
    readonly refresh: (
      credential: CodexCredential
    ) => Effect.Effect<CodexCredential, PiCodexRefreshFailed>;
  }
>()("@akshatagarwl/pi-codex-auth/CodexTokenRefresher", {
  make: Effect.gen(function* makeCodexTokenRefresher() {
    const oauth = openaiCodexProvider().auth?.oauth;

    if (oauth === undefined) {
      return yield* Effect.die(
        new Error("pi-ai's openai-codex provider ships no OAuth flow")
      );
    }

    const refresh = Effect.fn("CodexTokenRefresher.refresh")(function* refresh(
      credential: CodexCredential
    ) {
      const refreshed = yield* Effect.tryPromise({
        catch: (cause) =>
          new PiCodexRefreshFailed({ reason: redactedReason(cause) }),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect.tryPromise takes pi-ai's Promise directly.
        try: (signal) => oauth.refresh({ ...credential }, signal),
      }).pipe(
        Effect.timeoutOrElse({
          duration: REFRESH_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new PiCodexRefreshFailed({
                reason: `no response within ${REFRESH_TIMEOUT}`,
              })
            ),
        })
      );

      return yield* decodeCredential({ ...refreshed, type: "oauth" }).pipe(
        Effect.mapError(
          (failure) =>
            new PiCodexRefreshFailed({ reason: redactedReason(failure.message) })
        )
      );
    });

    return { refresh } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
