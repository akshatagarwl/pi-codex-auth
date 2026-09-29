import { homedir } from "node:os";

import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";

import { PiAuthFileInvalid, PiCodexNotLoggedIn } from "./errors.js";

export const CODEX_PROVIDER_ID = "openai-codex";

const OWNER_ONLY = 0o600;

export const CodexCredentialSchema = Schema.Struct({
  access: Schema.String,
  accountId: Schema.optional(Schema.String),
  expires: Schema.Finite,
  refresh: Schema.String,
  type: Schema.Literal("oauth"),
});

export type CodexCredential = typeof CodexCredentialSchema.Type;

const AuthFileJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown)
);

const decodeAuthFile = Schema.decodeUnknownEffect(AuthFileJson);

const decodeCredential = Schema.decodeUnknownEffect(CodexCredentialSchema);

export type AuthFileContents = typeof AuthFileJson.Type;

export const piAuthFilePath = Effect.gen(function* piAuthFilePath() {
  const path = yield* Path.Path;
  const configured = yield* Config.String("PI_CODING_AGENT_DIR").pipe(
    Config.option
  );
  const home = homedir();
  const agentDir = Option.match(configured, {
    onNone: () => path.join(home, ".pi", "agent"),
    onSome: (dir) =>
      dir === "~" || dir.startsWith("~/") ? path.join(home, dir.slice(1)) : dir,
  });

  return path.join(agentDir, "auth.json");
});

export const readAuthFile = Effect.fn("readAuthFile")(function* readAuthFile(
  file: string
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem.readFileString(file).pipe(
    Effect.catchReason(
      "PlatformError",
      "NotFound",
      () => Effect.fail(new PiCodexNotLoggedIn({ file })),
      (_reason, failure) =>
        Effect.fail(new PiAuthFileInvalid({ file, reason: failure.message }))
    )
  );

  return yield* decodeAuthFile(text).pipe(
    Effect.mapError(
      (failure) => new PiAuthFileInvalid({ file, reason: failure.message })
    )
  );
});

export const codexCredentialIn = Effect.fn("codexCredentialIn")(
  function* codexCredentialIn(file: string, contents: AuthFileContents) {
    const entry = contents[CODEX_PROVIDER_ID];

    if (entry === undefined) {
      return yield* new PiCodexNotLoggedIn({ file });
    }

    return yield* decodeCredential(entry).pipe(
      Effect.mapError(
        (failure) => new PiAuthFileInvalid({ file, reason: failure.message })
      )
    );
  }
);

export const writeAuthFile = Effect.fn("writeAuthFile")(function* writeAuthFile(
  file: string,
  contents: AuthFileContents
) {
  const fileSystem = yield* FileSystem.FileSystem;

  yield* fileSystem
    .writeFileString(file, JSON.stringify(contents, null, 2), {
      mode: OWNER_ONLY,
    })
    .pipe(
      Effect.andThen(fileSystem.chmod(file, OWNER_ONLY)),
      Effect.mapError(
        (failure) => new PiAuthFileInvalid({ file, reason: failure.message })
      )
    );
});
