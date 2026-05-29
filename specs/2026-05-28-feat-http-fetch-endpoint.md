# Feature: `POST /fetch` — browserless HTTP fetch (the harvest half of capture→fetch)

**Date:** 2026-05-28
**Type:** feature
**Repo:** `surfagent` (Jeffdotchan/surfagent fork)

## Problem

`/capture` (shipped) *discovers* a site's hidden backend API by watching the browser's
XHR/fetch traffic. But surfagent is 100% browser-bound — to actually *harvest* that
API at scale (page 2…N of a listings endpoint), you still have to drive Chrome, which
is slow and heavy. The natural second half is missing: a way to hit a discovered
endpoint with a plain HTTP request, **out the same residential proxy IP** the browser
is using, with no Chrome in the loop.

This is the **discover-then-direct-fetch** loop: `/capture` finds
`websites-search.api.carscommerce.inc/api/v1/listings/.../search` from a warm browser
session; `/fetch` then pulls every subsequent page directly — orders of magnitude
cheaper than rendering each page. (Pattern validated against Chesrown 2026-05-28.)

browser-use/browser-harness ships exactly this primitive (`http_get` with optional
proxy routing); this brings the equivalent to surfagent.

## Goal

Add `POST /fetch`: a browserless HTTP request that (by default) routes through the
**same PacketStream sticky session** the instance's Chrome uses, so the target site
sees a consistent residential IP across the discovery (browser) and harvest (fetch)
phases. Returns status, headers, and body (capped, optional JSON parse).

## Approach

Node 22 has global `fetch` + `undici`. Use `undici`'s `ProxyAgent` as the dispatcher
to route through PacketStream. Reuse the existing proxy modules (`src/proxy/pool.ts`,
`src/proxy/credState.ts`) so the proxy contract stays single-sourced.

### New shared helper: `src/proxy/credState.ts`

The launch path stashes only `SURFAGENT_PROXY_USERNAME` / `_PASSWORD` in env today
(host/port aren't persisted). Add:
- On launch/restart, also stash `SURFAGENT_PROXY_HOST` + `SURFAGENT_PROXY_PORT`
  (extend `ensureProxyEnvSet` to set them from the picked cred; `rotateProxyCred`
  already mutates env — set host/port there too).
- Export `currentProxyCred(): StickyCred | null` — reads all four from env, returns
  `null` if username/password absent. `/fetch` and any future proxied path share it.

This keeps `/fetch` on the **exact same sticky session** as the live browser (the
session id lives in the password), so the residential IP matches — critical, because
discovered APIs often bind to the session/IP that established the page.

### New module: `src/api/fetchUrl.ts`

```ts
import { ProxyAgent } from 'undici';
import { currentProxyCred } from '../proxy/credState.js';

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_BODY_CAP_BYTES = 2 * 1024 * 1024;   // 2 MiB — listings JSON is bigger than capture's 64 KiB default
const MAX_BODY_CAP_BYTES = 16 * 1024 * 1024;

export interface FetchBody {
  url: string;                 // required — absolute http(s) URL
  method?: string;             // default 'GET'
  headers?: Record<string,string>; // e.g. UA, Accept, Cookie copied from the captured request
  body?: string;               // request body for POST/PUT (string; caller JSON.stringifies)
  proxy?: boolean;             // default true — route via the instance's sticky PacketStream session.
                               //   false = direct (BLD home IP). No effect if no proxy configured.
  json?: boolean;              // default false — if true, JSON.parse the body and return it as `json`
  maxBodyBytes?: number;       // default 2 MiB, clamped to 16 MiB
  timeoutMs?: number;          // default 20000, clamped to 120000
}

export interface FetchResult {
  status: number;
  ok: boolean;
  url: string;                 // final URL after redirects
  headers: Record<string,string>;
  mimeType: string | null;
  bytes: number;               // body byte length (pre-cap)
  body?: string;               // text body, capped; omitted if json parsed ok
  json?: any;                  // present when json:true and parse succeeded
  truncated?: boolean;
  proxied: boolean;            // whether the request actually went through a proxy
}
```

`fetchUrl(body)` flow:
1. Validate `url` is an absolute `http://`/`https://` URL → else throw
   `Invalid url` (server maps to 400). Reject non-http(s) schemes (no `file:`/`data:`).
2. Build dispatcher: if `proxy !== false` and `currentProxyCred()` returns a cred,
   `new ProxyAgent({ uri: 'http://${host}:${port}', token: 'Basic ' + base64(user:pass) })`
   (PacketStream is an HTTP proxy with basic auth). Else no dispatcher (direct).
3. `AbortController` with `timeoutMs` (clamped).
4. `await fetch(url, { method, headers, body, dispatcher, redirect: 'follow', signal })`.
5. Read body as text; record `bytes`; cap to `maxBodyBytes` (clamped) setting
   `truncated`. If `json:true`, try `JSON.parse` — on success return `json` and omit
   `body`; on failure return raw `body` (do not throw).
6. Return `FetchResult` with a flattened headers object and `proxied` reflecting (2).
   Always clear the timeout in `finally`.

Errors: timeouts / DNS / connection failures throw with a readable message →
server maps to 502 (`Upstream fetch failed: <msg>`).

### Route: `src/api/server.ts`

Add after `/capture` (mirror the existing conventions — `parseBody`, `json`,
400-hint, `_fetchMs`):

```ts
// POST /fetch — browserless HTTP request, routed through the instance's residential proxy
if (path === '/fetch' && req.method === 'POST') {
  const body = parseBody(await readBody(req));
  if (!body.url) {
    return json(res, 400, { error: 'Provide "url", optional "method", "headers", "body", "proxy", "json", "maxBodyBytes", "timeoutMs"' });
  }
  const start = Date.now();
  const result = await fetchUrl(body);
  return json(res, 200, { ...result, _fetchMs: Date.now() - start });
}
```
- Import `fetchUrl`; add `/fetch` to the 404 endpoints string and the startup banner.
- Add a catch mapping for upstream failures → 502 in the existing error block
  (alongside the "Cannot connect to Chrome" 503 case).

## Files touched

| File | Change |
|------|--------|
| `src/api/fetchUrl.ts` | **new** — `fetchUrl()` + types (~120 lines) |
| `src/proxy/credState.ts` | stash host/port on launch+rotate; add `currentProxyCred()` |
| `src/api/server.ts` | `/fetch` route, import, 404 string, banner, 502 mapping |
| `API.md` | document `POST /fetch` + the capture→fetch workflow |

## Out of scope / security

- **LAN / loopback only — NOT on the public cloudflared allowlist.** `/fetch` is a
  classic SSRF primitive (it'll request any URL from BLD's network, incl. internal
  hosts) and can route arbitrary traffic out the residential proxy. It must stay
  loopback like `/eval` and `/capture`. Public surface remains `/navigate`, `/recon`,
  `/browser/fetch/search`.
- Cookie/session reuse from the captured tab (auto-pull `Network.getCookies` and
  attach) is a **follow-up** — v1 accepts a caller-supplied `Cookie` header, which
  covers the listings-API case (those are usually keyless/cookieless once you have
  the residential IP).
- No automatic pagination loop in v1 — the caller drives page N. (A `/harvest`
  convenience that loops a templated URL is a possible follow-up.)

## Validation

```bash
# 1. Build clean (tsc strict)
npm run build

# 2. Proxy parity: fetch an IP-echo through the instance's sticky session and direct,
#    confirm the proxied IP is residential (differs from BLD's home IP).
curl -s -X POST localhost:3456/fetch -H 'Content-Type: application/json' \
  -d '{"url":"https://api.ipify.org?format=json","json":true}' | jq '.json, .proxied'
curl -s -X POST localhost:3456/fetch -H 'Content-Type: application/json' \
  -d '{"url":"https://api.ipify.org?format=json","json":true,"proxy":false}' | jq '.json, .proxied'

# 3. The capture→fetch loop, end-to-end on a real car platform:
#    a) /capture a client-rendered SRP to discover its listings API (see /capture docs)
#    b) /fetch that endpoint's page 2 directly and assert structured listings come back
curl -s -X POST localhost:3456/fetch -H 'Content-Type: application/json' \
  -d '{"url":"<discovered listings endpoint, page 2>","json":true,"maxBodyBytes":4194304}' \
  | jq '.status, .proxied, (.json | keys)'
#    Expect: 200, proxied:true, JSON with the platform's listing array.

# 4. SSRF guard + error surface
curl -s -X POST localhost:3456/fetch -H 'Content-Type: application/json' -d '{"url":"file:///etc/passwd"}' | jq .   # 400 Invalid url
curl -s -X POST localhost:3456/fetch -H 'Content-Type: application/json' -d '{}' | jq .                              # 400 hint
```

Build green + smoke (2) showing a residential IP under `proxied:true` + smoke (3)
returning the platform's listings JSON over plain HTTP = done. This proves the
discover-then-direct-fetch loop and is the payoff this feature exists for.
