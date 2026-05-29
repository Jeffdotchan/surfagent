# Feature: `POST /capture` — hidden-API discovery via CDP Network domain

**Date:** 2026-05-28
**Type:** feature
**Repo:** `surfagent` (Jeffdotchan/surfagent fork)

## Problem

Surfagent today can map the **DOM** (`/recon`) and run **JS** (`/eval`), but it has no
way to observe **network traffic**. There is no built-in capability to enumerate the
undocumented XHR/fetch/websocket endpoints a page calls — the actual "hidden APIs"
behind a site. The only CDP `Network`/`Fetch` usage in the codebase is
`Fetch.enable({handleAuthRequests:true})` in `src/proxy/authHandler.ts`, used purely
to feed proxy credentials.

A caller wanting to discover a site's backend API must currently inject a `fetch`/`XHR`
monkey-patch through `/eval`, which (a) only catches calls fired *after* injection,
(b) misses on-load and websocket traffic, and (c) is not exposed through the public
tunnel. We want a first-class, passive capture endpoint.

## Goal

Add `POST /capture`: attach to a tab, passively record all network requests for a
time window (optionally reloading/navigating to catch on-load calls), and return a
**deduped list of API calls** (method, URL, resourceType, status, mime, optional
request payload + response body).

## Approach

Use the CDP **`Network`** domain. Attach a CDP client to the target tab, register
`Network.*` listeners **before** any navigation (per memory
`feedback_cdp_fetch_handlers_before_navigate` — handlers must be registered before
navigation races them), then `Network.enable()`, optionally reload/navigate, collect
events for `durationMs`, and return.

Default filter is `XHR` + `Fetch` resource types (that's what "hidden API" means —
not images/css/fonts/documents). `WebSocket` endpoints are captured by URL.

### New module: `src/api/capture.ts`

```ts
import CDP from 'chrome-remote-interface';
import { findTab } from '../chrome/tabs.js';
import { injectStealth } from '../stealth/inject.js';
import { installProxyAuth } from '../proxy/authHandler.js';

const DEFAULT_DURATION_MS = 8000;
const MAX_DURATION_MS = 60000;
const BODY_CAP_BYTES = 64 * 1024;
const DEFAULT_TYPES = ['XHR', 'Fetch'];

export interface CaptureBody {
  tab: string;                 // required — resolved via findTab (index | id | url/title)
  durationMs?: number;         // default 8000, clamped to MAX_DURATION_MS
  reload?: boolean;            // default false — Page.reload() after attaching (catch on-load calls)
  navigate?: string;           // optional — Page.navigate({url}) after attaching (alt to reload)
  types?: string[];            // default ['XHR','Fetch']; '*' (single elem) = all resource types
  includeBodies?: boolean;     // default false — Network.getResponseBody for matching calls
  stripQuery?: boolean;        // default true — dedup key ignores ?query
}

export interface CapturedApi {
  method: string;
  url: string;
  type: string;                // resourceType: XHR | Fetch | WebSocket | ...
  status: number | null;
  mimeType: string | null;
  requestPayload: string | null;   // postData if present
  responseBytes: number | null;    // encodedDataLength from loadingFinished
  body?: string;                    // only when includeBodies and fetchable; capped, may be truncated
  truncated?: boolean;
}
```

`captureTab(body, opts)` flow:

1. `const target = await findTab(body.tab, opts.port, opts.host)` → throw
   `Tab not found: <tab>` if null (server.ts already maps "Tab not found" → 404).
2. Connect a fresh raw client and apply the same setup `connectToTab` does, **plus**
   Network. Do NOT call `connectToTab` (its `CDPClient` type omits `Network`); mirror it:
   ```ts
   const client = await CDP({ target: target.id, port: opts.port, host: opts.host });
   const { Network, Page, Runtime, DOM } = client;
   await Page.enable(); await Runtime.enable(); await DOM.enable();
   await injectStealth(client); await installProxyAuth(client);
   ```
   (Stealth + proxy must be re-applied so a `reload`/`navigate` behaves like a normal
   surfagent session.)
3. Register listeners **before** `Network.enable()`:
   - `Network.requestWillBeSent` → seed a `Map<requestId, CapturedApi>` with
     `method`, `url`, `type` (`params.type`), `requestPayload` (`params.request.postData ?? null`).
   - `Network.responseReceived` → fill `status`, `mimeType`, and overwrite `type`
     with `params.type` (more reliable here).
   - `Network.loadingFinished` → set `responseBytes = params.encodedDataLength`; if
     `includeBodies` and the record's type is in the filter, `await Network.getResponseBody({requestId})`
     inside try/catch (bodies get evicted → skip on throw), cap to `BODY_CAP_BYTES`,
     set `truncated` flag.
   - `Network.webSocketCreated` → record `{method:'GET', url:params.url, type:'WebSocket', status:null,...}`.
4. `await Network.enable()`.
5. If `body.navigate` → `await Page.navigate({url: body.navigate})`; else if `body.reload`
   → `await Page.reload()`.
6. `await sleep(min(durationMs ?? DEFAULT, MAX))`.
7. `await client.close()` (always, in `finally`).
8. Filter to requested `types` (skip filter if `types` is `['*']`), **dedup** by
   `method + (stripQuery ? url.split('?')[0] : url)` keeping the first seen, sort by url,
   return `{ tab: target.id, url: target.url, capturedMs, totalRequests, apis }`.

### Route: `src/api/server.ts`

Add alongside the other handlers (e.g. after `/eval`):

```ts
// POST /capture — record network traffic and return discovered API calls
if (path === '/capture' && req.method === 'POST') {
  const body = parseBody(await readBody(req));
  if (!body.tab) {
    return json(res, 400, { error: 'Provide "tab", optional "durationMs", "reload", "navigate", "types", "includeBodies", "stripQuery"' });
  }
  const start = Date.now();
  const result = await captureTab(body, { port: CDP_PORT, host: CDP_HOST });
  return json(res, 200, { ...result, _captureMs: Date.now() - start });
}
```

- Import `captureTab` at top of `server.ts`.
- Update the 404 endpoint string (line ~222) to include `/capture`.
- Add a `console.log` line for `/capture` in the `server.listen` banner (line ~252+).

### Types note

`src/types/chrome-remote-interface.d.ts` may need `Network` added to the client typing.
Check it; if `Network` isn't declared, add it (loosely typed `any` event handlers are
acceptable and consistent with the existing shim).

## Files touched

| File | Change |
|------|--------|
| `src/api/capture.ts` | **new** — `captureTab()` + types (~160–200 lines) |
| `src/api/server.ts` | new `/capture` route, import, 404 string, banner line |
| `src/types/chrome-remote-interface.d.ts` | add `Network` to client type if missing |
| `API.md` | document `POST /capture` (request/response/examples) |

## Out of scope / security

- **Do NOT add `/capture` to the public cloudflared allowlist.** Response bodies can
  contain auth tokens / PII; like `/eval` it stays LAN/loopback-only. Public tunnel
  remains `/navigate`, `/recon`, `/browser/fetch/search` only
  (see `jarvis app_docs/bld_surfagent_tunnel.md`). Note this in API.md.
- No stateful start/stop session API in this pass — windowed capture (single
  round-trip) covers "scan this page's APIs." A `start`/`stop`/`read` session variant
  is a possible follow-up if interactive multi-step flows need it.

## Validation

Run from repo root:

```bash
# 1. Build must pass (tsc strict)
npm run build

# 2. Smoke against a live XHR-heavy page (Chrome must be running with CDP).
#    Open a JSON-driven SPA in tab 0, then:
curl -s -X POST localhost:3456/capture \
  -H 'Content-Type: application/json' \
  -d '{"tab":"0","reload":true,"durationMs":8000}' | jq '.totalRequests, (.apis | length), .apis[0]'
#    Expect: totalRequests > 0, apis array non-empty, first entry has method+url+type=XHR|Fetch.

# 3. Response bodies
curl -s -X POST localhost:3456/capture \
  -H 'Content-Type: application/json' \
  -d '{"tab":"0","reload":true,"includeBodies":true,"durationMs":8000}' | jq '.apis[] | select(.mimeType=="application/json") | {url, status, body: (.body|length)}'
#    Expect: at least one JSON endpoint with a non-empty body string.

# 4. Validation / 404 surface
curl -s -X POST localhost:3456/capture -H 'Content-Type: application/json' -d '{}' | jq .   # 400 with hint
curl -s localhost:3456/nope | jq -r .error                                                   # 404 string includes /capture
```

Build green + smoke (2) returning a non-empty deduped `apis` array containing the
page's real backend endpoints = done. Fix any tsc failure before reporting complete.
