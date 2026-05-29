import CDP from 'chrome-remote-interface';
import { findTab } from '../chrome/tabs.js';
import { injectStealth } from '../stealth/inject.js';
import { installProxyAuth } from '../proxy/authHandler.js';
const DEFAULT_DURATION_MS = 8000;
const MAX_DURATION_MS = 60000;
const DEFAULT_BODY_CAP_BYTES = 64 * 1024;
const MAX_BODY_CAP_BYTES = 8 * 1024 * 1024; // hard ceiling to bound memory per capture
const DEFAULT_TYPES = ['XHR', 'Fetch'];
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export async function captureTab(body, opts = {}) {
    const target = await findTab(body.tab, opts.port, opts.host);
    if (!target) {
        throw new Error(`Tab not found: ${body.tab}`);
    }
    const types = Array.isArray(body.types) && body.types.length > 0 ? body.types : DEFAULT_TYPES;
    const allTypes = types.length === 1 && types[0] === '*';
    const stripQuery = body.stripQuery !== false; // default true
    const includeBodies = body.includeBodies === true;
    const durationMs = Math.min(typeof body.durationMs === 'number' && body.durationMs > 0 ? body.durationMs : DEFAULT_DURATION_MS, MAX_DURATION_MS);
    const bodyCap = Math.min(typeof body.maxBodyBytes === 'number' && body.maxBodyBytes > 0 ? body.maxBodyBytes : DEFAULT_BODY_CAP_BYTES, MAX_BODY_CAP_BYTES);
    // Connect a fresh raw client and mirror connectToTab's setup, plus the Network domain.
    const client = await CDP({ target: target.id, port: opts.port, host: opts.host });
    try {
        const { Network, Page, Runtime, DOM } = client;
        if (!Network) {
            throw new Error('CDP Network domain unavailable on this client');
        }
        await Page.enable();
        await Runtime.enable();
        await DOM.enable();
        await injectStealth(client);
        await installProxyAuth(client);
        // requestId -> record. Seed on requestWillBeSent, enrich on later events.
        const records = new Map();
        let totalRequests = 0;
        // Register all listeners BEFORE Network.enable() so navigation can't race them
        // (per feedback_cdp_fetch_handlers_before_navigate).
        Network.requestWillBeSent((event) => {
            totalRequests++;
            const requestId = event.requestId;
            if (!records.has(requestId)) {
                records.set(requestId, {
                    method: event.request?.method ?? 'GET',
                    url: event.request?.url ?? '',
                    type: event.type ?? 'Other',
                    status: null,
                    mimeType: null,
                    requestPayload: event.request?.postData ?? null,
                    responseBytes: null,
                });
            }
        });
        Network.responseReceived((event) => {
            const rec = records.get(event.requestId);
            if (!rec)
                return;
            rec.status = typeof event.response?.status === 'number' ? event.response.status : rec.status;
            rec.mimeType = event.response?.mimeType ?? rec.mimeType;
            // resourceType is more reliable on responseReceived than on requestWillBeSent.
            if (event.type)
                rec.type = event.type;
        });
        Network.loadingFinished((event) => {
            const rec = records.get(event.requestId);
            if (!rec)
                return;
            if (typeof event.encodedDataLength === 'number') {
                rec.responseBytes = event.encodedDataLength;
            }
            if (includeBodies && (allTypes || types.includes(rec.type))) {
                // Bodies get evicted quickly; fetch best-effort and never let it reject the capture.
                Network.getResponseBody({ requestId: event.requestId })
                    .then(resBody => {
                    let text = resBody?.body ?? '';
                    if (text.length > bodyCap) {
                        text = text.slice(0, bodyCap);
                        rec.truncated = true;
                    }
                    rec.body = text;
                })
                    .catch(() => {
                    // body evicted / not available — skip
                });
            }
        });
        Network.webSocketCreated((event) => {
            totalRequests++;
            const requestId = event.requestId;
            if (!records.has(requestId)) {
                records.set(requestId, {
                    method: 'GET',
                    url: event.url ?? '',
                    type: 'WebSocket',
                    status: null,
                    mimeType: null,
                    requestPayload: null,
                    responseBytes: null,
                });
            }
        });
        await Network.enable();
        // Optionally trigger fresh traffic to catch on-load API calls.
        if (body.navigate) {
            await Page.navigate({ url: body.navigate });
        }
        else if (body.reload) {
            await Page.reload();
        }
        await sleep(durationMs);
        // Filter by resource type (unless '*'), dedup by method + url(stripQuery), keep first seen.
        const seen = new Set();
        const apis = [];
        for (const rec of records.values()) {
            if (!allTypes && !types.includes(rec.type))
                continue;
            const key = `${rec.method} ${stripQuery ? rec.url.split('?')[0] : rec.url}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            apis.push(rec);
        }
        apis.sort((a, b) => a.url.localeCompare(b.url));
        return {
            tab: target.id,
            url: target.url,
            capturedMs: durationMs,
            totalRequests,
            apis,
        };
    }
    finally {
        await client.close().catch(() => { });
    }
}
