# Bug: `/recon` 500 "Cannot read properties of undefined (reading 'meta')" on `http://` sites

**Date:** 2026-05-28
**Type:** bug
**Repo:** `surfagent` (Jeffdotchan/surfagent fork)

## Symptom

During a batch `/capture` discovery run (which warm-loads each page through `/recon`
first), 4 dealer platforms returned a **HTTP 500** with body:

```json
{ "error": "Cannot read properties of undefined (reading 'meta')" }
```

The 500 is produced by the generic catch-all in `src/api/server.ts:272`
(`json(res, 500, { error: message })`) — i.e. an *unhandled* JS `TypeError` bubbled out
of `reconUrl`, not a deliberate error path.

## Affected platforms (the common factor)

| Platform | Sample dealer URL | Scheme |
|---|---|---|
| DealerCarSearch | `http://www.bigcitymotors.biz/` | **http://** |
| AutoRevo_Sites  | (http variants in the batch) | **http://** |
| CarBase_Sites   | `http://www.brothersautoonline.com` | **http://** |
| VinList         | (http variants in the batch) | **http://** |

All four are **non-TLS `http://`** origins. That is the shared trait.

## Root cause

`src/api/recon.ts`

The extraction result is read **unconditionally**, with no guard for the case where the
in-page `Runtime.evaluate` returned no serialized value:

```ts
// recon.ts:382-387 (reconUrl) — and identically 452-456 (reconTab)
const extractionResult = await client.Runtime.evaluate({
  expression: EXTRACTION_SCRIPT,
  returnByValue: true
});

const data = extractionResult.result.value as any;   // ← can be undefined
```

then later:

```ts
// recon.ts:405 (reconUrl) — and 468 (reconTab)
meta: data.meta,        // ← TypeError when data is undefined: "reading 'meta'"
headings: data.headings,
navigation: data.navigation,
...
```

When `Runtime.evaluate` does **not** return a serialized value, `extractionResult.result.value`
is `undefined`, so `data` is `undefined`, and the very first field access `data.meta` throws
`Cannot read properties of undefined (reading 'meta')`. `meta` is simply the first key in the
return object (recon.ts:397-411), which is why the message names `'meta'` specifically — it is
not really about the meta tags, it is the first property touched on an undefined object.

`result.value` comes back `undefined` in exactly the situations an `http://` dealer site
provokes:

1. **http→https (or http→http) redirect / context swap mid-recon.** Most modern dealer
   sites serve `http://` only to 301/HSTS-upgrade to `https://`. `reconUrl` does
   `Page.navigate(http://…)` → `Page.loadEventFired()` → fixed `waitMs` settle → then a
   sequence of `Runtime.evaluate` calls (title, location, EXTRACTION_SCRIPT). If the
   http→https navigation lands *after* `loadEventFired` (common: the first response is the
   redirect, the load event can fire on the interstitial/initial doc, then the real
   document swaps in), the **execution context is destroyed** between the location read and
   the EXTRACTION_SCRIPT evaluate. CDP then returns no `result.value` → `data` undefined.

2. **Script threw in-page.** The extraction script does `document.body.cloneNode(true)`
   (recon.ts:304) with no null guard. On a transient about:blank / mid-navigation document
   `document.body` can be `null`, the script throws, `Runtime.evaluate` returns
   `exceptionDetails` and **no** `result.value`. (Note `chrome-error://` interstitials do
   render a real `<body>`, so those alone do not trigger it — verified live.)

3. **`returnByValue` serialization failure.** A pathological `jsonLd` payload (huge or
   non-serializable) can cause CDP to return without a `value`.

In every case the fix is the same: `recon.ts` must not assume `data` is defined, and the
in-page script must not assume `document.body` is non-null.

Note the sibling module already does this right: `src/api/act.ts:493` checks
`result.exceptionDetails` before reading `result.value`. `recon.ts` simply never got the
same guard.

### Why it's intermittent / hard to repro deterministically

It is a navigation-timing race tied to the http→https redirect, so the same URL can
succeed on one run and 500 on the next (confirmed: `http://www.bigcitymotors.biz/`
returned a clean 200 on a live fleet repro attempt). The batch hit it on the runs where the
redirect landed after the load event. The defensive guard is correct regardless of which
sub-case fires; chasing a deterministic live repro is not required to fix it.

## Proposed fix (minimal, low-risk)

Two defensive layers, both pure guards — no behavior change on the happy path:

**1. Guard the in-page script (`EXTRACTION_SCRIPT`, recon.ts ~304).** Tolerate a null
`document.body`:

```js
const bodyEl = document.body;
const clone = bodyEl ? bodyEl.cloneNode(true) : null;
if (clone) clone.querySelectorAll('script,style,noscript,svg').forEach(e => e.remove());
const fullText = clone ? (clone.innerText || '').trim() : '';
```

**2. Guard the TS consumer in both `reconUrl` and `reconTab`.** After
`const data = extractionResult.result.value as any;`, fall back to an empty-shaped result
instead of dereferencing `undefined`. Recommended: a small helper that normalizes a
possibly-undefined `data` into the `ReconResult` field set, e.g.

```ts
const data = (extractionResult.result.value as any) ?? {};
// then build the result with safe accessors:
meta: data.meta ?? { description: null, ogTitle: null, ogDescription: null, jsonLd: [] },
headings: data.headings ?? [],
navigation: data.navigation ?? [],
elements: data.elements ?? [],
totalElements: data.totalElements ?? data.elements?.length ?? 0,
forms: data.forms ?? [],
contentSummary: data.contentSummary ?? '',
landmarks: data.landmarks ?? [],
overlays: data.overlays ?? [],
captchas: data.captchas ?? [],
```

Optionally surface a diagnostic when the evaluate threw — mirror `act.ts:493` and read
`extractionResult.exceptionDetails` to log/return a hint — but the primary requirement is
**stop returning a 500**: a degraded-but-valid `ReconResult` (correct `url`/`title`, empty
collections) is the right outcome for a page whose DOM couldn't be extracted.

## Files touched

| File | Change |
|------|--------|
| `src/api/recon.ts` | null-guard `document.body` in `EXTRACTION_SCRIPT`; `?? {}` + per-field `??` fallbacks in `reconUrl` and `reconTab` |

## Out of scope

- Re-architecting the http→https redirect handling (e.g. waiting on a second
  `loadEventFired`, or re-acquiring the execution context). The guard makes recon *safe*
  on these pages; making it *extract more* from a redirecting http page is a separate
  enhancement.

## Validation

```bash
# 1. Build must pass (tsc strict)
npm run build

# 2. Happy-path recon still returns full data (Chrome with CDP running):
curl -s -X POST localhost:3456/recon -H 'Content-Type: application/json' \
  -d '{"url":"http://www.bigcitymotors.biz/","waitMs":3000}' | jq '.title, (.meta!=null), (.elements|length)'
#    Expect: real title, meta != null, elements > 0.

# 3. Degraded path no longer 500s. A page whose extraction returns no value must yield a
#    200 with empty collections, not a 500 "reading 'meta'". (Hard to force deterministically;
#    the guard is verified by code review + build.)
```

Build green + happy-path recon unchanged = done.
