import { describe, expect, it } from "@effect/vitest";

import { redactedReason } from "../src/redact.js";

const jwt =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJlLWJ5dGVzLWhlcmU";

describe("redactedReason", () => {
  it("removes tokens that pi-ai echoes in a malformed token response", () => {
    const cause = new Error(
      `OpenAI Codex token refresh response missing fields: {"access_token":"${jwt}","expires_in":3600}`
    );

    const reason = redactedReason(cause);

    expect(reason).not.toContain(jwt);
    expect(reason).toContain("response missing fields");
    expect(reason).toContain("[redacted]");
  });

  it("keeps the readable parts of an OAuth error", () => {
    const reason = redactedReason(
      new Error(
        'OpenAI Codex token refresh failed (401): {"error":"invalid_grant"}'
      )
    );

    expect(reason).toContain("(401)");
    expect(reason).toContain("invalid_grant");
  });
});
