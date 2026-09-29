const TOKEN_LIKE = /[A-Za-z0-9._~+/=-]{24,}/gu;

export const redactedReason = (cause: unknown) =>
  String(cause).replaceAll(TOKEN_LIKE, "[redacted]");
