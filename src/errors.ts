import { Schema } from "effect";

export class PiCodexNotLoggedIn extends Schema.TaggedError<PiCodexNotLoggedIn>()(
  "PiCodexNotLoggedIn",
  { file: Schema.String }
) {
  override get message() {
    return `Pi has no OpenAI Codex login in ${this.file}. Run \`pi\`, then \`/login\`, and pick OpenAI Codex.`;
  }
}

export class PiAuthFileInvalid extends Schema.TaggedError<PiAuthFileInvalid>()(
  "PiAuthFileInvalid",
  { file: Schema.String, reason: Schema.String }
) {
  override get message() {
    return `Pi's auth file ${this.file} is unusable: ${this.reason}`;
  }
}

export class PiAuthLockFailed extends Schema.TaggedError<PiAuthLockFailed>()(
  "PiAuthLockFailed",
  { file: Schema.String, held: Schema.Boolean, reason: Schema.String }
) {
  override get message() {
    return `Could not lock ${this.file}: ${this.reason}`;
  }
}

export class PiCodexRefreshFailed extends Schema.TaggedError<PiCodexRefreshFailed>()(
  "PiCodexRefreshFailed",
  { reason: Schema.String }
) {
  override get message() {
    return `OpenAI Codex token refresh failed: ${this.reason}. Log in again with \`pi\` → \`/login\`.`;
  }
}

export type PiCodexAuthError =
  | PiAuthFileInvalid
  | PiAuthLockFailed
  | PiCodexNotLoggedIn
  | PiCodexRefreshFailed;
