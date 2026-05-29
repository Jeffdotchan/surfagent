import { ProxyAgent } from 'undici';
import { currentProxyCred } from '../proxy/credState.js';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_BODY_CAP_BYTES = 2 * 1024 * 1024; // 2 MiB — listings JSON is bigger than capture's 64 KiB default
const MAX_BODY_CAP_BYTES = 16 * 1024 * 1024;
function clamp(value, fallback, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return fallback;
    return Math.min(value, max);
}
/**
 * Browserless HTTP request, by default routed through the instance's sticky
 * PacketStream session (via undici ProxyAgent) so the target site sees the
 * same residential IP the live browser uses. Throws on validation / transport
 * failure; the server maps those to 400 / 502.
 */
export async function fetchUrl(body) {
    // 1. Validate url: absolute http(s) only — reject file:/data:/non-http schemes.
    let parsed;
    try {
        parsed = new URL(body.url);
    }
    catch {
        throw new Error('Invalid url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid url');
    }
    // 2. Build dispatcher from the current sticky cred unless proxy is disabled.
    let dispatcher;
    let proxied = false;
    if (body.proxy !== false) {
        const cred = currentProxyCred();
        if (cred) {
            const token = 'Basic ' + Buffer.from(`${cred.username}:${cred.password}`).toString('base64');
            dispatcher = new ProxyAgent({ uri: `http://${cred.host}:${cred.port}`, token });
            proxied = true;
        }
    }
    // 3. AbortController timeout (clamped).
    const timeoutMs = clamp(body.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // 4. Perform the request.
        const response = await fetch(parsed.toString(), {
            method: body.method || 'GET',
            headers: body.headers,
            body: body.body,
            // @ts-expect-error — undici dispatcher option not in the lib.dom fetch type
            dispatcher,
            redirect: 'follow',
            signal: controller.signal,
        });
        // 5. Read body as text, cap to maxBodyBytes.
        const cap = clamp(body.maxBodyBytes, DEFAULT_BODY_CAP_BYTES, MAX_BODY_CAP_BYTES);
        const text = await response.text();
        const fullBytes = Buffer.byteLength(text, 'utf-8');
        let outText = text;
        let truncated = false;
        if (fullBytes > cap) {
            outText = Buffer.from(text, 'utf-8').subarray(0, cap).toString('utf-8');
            truncated = true;
        }
        // 6. Flatten headers + build result.
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        const result = {
            status: response.status,
            ok: response.ok,
            url: response.url || parsed.toString(),
            headers,
            mimeType: response.headers.get('content-type'),
            bytes: fullBytes,
            proxied,
        };
        if (truncated)
            result.truncated = true;
        if (body.json) {
            try {
                result.json = JSON.parse(outText);
            }
            catch {
                // parse failed — fall back to raw body, do not throw
                result.body = outText;
            }
        }
        else {
            result.body = outText;
        }
        return result;
    }
    finally {
        clearTimeout(timer);
    }
}
