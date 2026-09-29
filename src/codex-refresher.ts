import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { Context, Effect, Layer, Schema } from "effect";

import { CodexCredentialSchema } from "./auth-file.js";
import type { CodexCredential } from "./auth-file.js";
import { PiCodexRefreshFailed } from "./errors.js";

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
        catch: (cause) => new PiCodexRefreshFailed({ reason: String(cause) }),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect.tryPromise takes pi-ai's Promise directly.
        try: (signal) => oauth.refresh({ ...credential }, signal),
      });

      return yield* decodeCredential({ ...refreshed, type: "oauth" }).pipe(
        Effect.mapError(
          (failure) => new PiCodexRefreshFailed({ reason: failure.message })
        )
      );
    });

    return { refresh } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
