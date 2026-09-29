# @akshatagarwl/pi-codex-auth

A current OpenAI Codex (ChatGPT subscription) access token from [Pi](https://pi.dev)'s own login, for code that embeds `pi-ai` without the Pi CLI, such as a [Flue](https://flueframework.com) agent.

Pi's CLI stores and refreshes OAuth credentials in `~/.pi/agent/auth.json`, but that storage is not part of its public API, and frameworks that embed only `pi-ai` take a static API key. This package reads Pi's login and refreshes it the way Pi does, so the pi CLI and your process can share one login without invalidating each other's rotated refresh token.

## Guarantees

- **Same file:** `$PI_CODING_AGENT_DIR/auth.json` (with `~` expanded), otherwise `~/.pi/agent/auth.json`, which is how Pi resolves it.
- **Same lock:** refreshes run under `proper-lockfile` on `auth.json` with `realpath: false` and a 30 s stale window, which is Pi's protocol. The credential is re-read after taking the lock, and if Pi already refreshed it, it is used as is.
- **Same format:** the whole file is rewritten as `JSON.stringify(data, null, 2)`, other providers untouched, mode forced to `0600`.
- **Refresh token stays put:** only the access token is returned. Refresh happens when fewer than 5 minutes remain, through `pi-ai`'s own `openai-codex` OAuth provider.
- **Typed failures:** `PiCodexNotLoggedIn`, `PiAuthFileInvalid`, `PiAuthLockFailed`, `PiCodexRefreshFailed`.

## Use

Log in once with Pi: run `pi`, then `/login`, and pick OpenAI Codex.

```sh
pnpm add github:akshatagarwl/pi-codex-auth effect @earendil-works/pi-ai
```

```ts
import { NodeServices } from "@effect/platform-node";
import { PiCodexAuth } from "@akshatagarwl/pi-codex-auth";
import { Effect, Layer, ManagedRuntime } from "effect";

const runtime = ManagedRuntime.make(
  Layer.provideMerge(PiCodexAuth.layer, NodeServices.layer)
);

const apiKey = await runtime.runPromise(
  PiCodexAuth.use((auth) => auth.accessToken)
);
```

With Flue, register the token before each agent starts:

```ts
registerProvider("openai-codex", { apiKey });
```

`PiCodexAuth.layerWithoutRefresher` lets you supply your own `CodexTokenRefresher`, which is how the tests run without the network.

## Scope

OpenAI Codex only. Anthropic subscription tokens also need request shaping (see `@gotgenes/pi-anthropic-auth`), so a bare token is not enough there. Node.js 24+, Effect 4.

## Prior art

[OxFrancesco/Flue-Codex](https://github.com/OxFrancesco/Flue-Codex) (MIT) showed the approach: let Pi own the login, lock `auth.json` for refresh, and hand only the access token to Flue. This package is an independent Effect implementation with typed errors and Schema-validated credentials.

## License

MIT
