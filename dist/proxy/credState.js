import { pickSticky } from './pool.js';
function maskSession(password) {
    return password.match(/session-([A-Za-z0-9]+)/)?.[1]?.slice(0, 8) ?? '?';
}
function log(msg) {
    console.log(`[surfagent] ${msg}`);
}
/**
 * Idempotent env-stash. If creds are already set in process.env, no-op and
 * returns null. Otherwise pick from the pool and stash. Returns the cred
 * (newly picked) or null if already set / pool absent / pool unreadable.
 *
 * Log shape (operator-facing, preserved exactly):
 *   launch:  "Chrome will route via proxy <host>:<port> (sticky session <tag>)"
 *   restart: "Proxy creds restored from pool (sticky session <tag>) — node restarted while Chrome was alive"
 */
export function ensureProxyEnvSet(reason) {
    if (process.env.SURFAGENT_PROXY_USERNAME && process.env.SURFAGENT_PROXY_PASSWORD) {
        return null; // already set in this process
    }
    const poolFile = process.env.SURFAGENT_PROXY_POOL_FILE;
    if (!poolFile)
        return null;
    const cred = pickSticky(poolFile);
    if (!cred)
        return null;
    process.env.SURFAGENT_PROXY_USERNAME = cred.username;
    process.env.SURFAGENT_PROXY_PASSWORD = cred.password;
    const tag = maskSession(cred.password);
    if (reason === 'launch') {
        log(`Chrome will route via proxy ${cred.host}:${cred.port} (sticky session ${tag})`);
    }
    else {
        log(`Proxy creds restored from pool (sticky session ${tag}) — node restarted while Chrome was alive`);
    }
    return cred;
}
/**
 * Unconditional re-pick. Mutates process.env with fresh creds.
 * Returns { cred, previousTag } so the API layer can echo both
 * tags back in its response. Returns null on pool error (unset pool file
 * or pickSticky returned null).
 *
 * NOTE: "next CDP connection" nuance — already-open CDP clients closure-
 * captured the OLD credentials when installProxyAuth ran; those keep using
 * old creds for already-paused requests. The fork creates a fresh CDP client
 * per API call, so the very next /navigate or /recon after /rotate-proxy
 * will use the new creds. Do not attempt to re-bind listeners on live clients.
 */
export function rotateProxyCred() {
    const poolFile = process.env.SURFAGENT_PROXY_POOL_FILE;
    if (!poolFile)
        return null;
    const previousTag = process.env.SURFAGENT_PROXY_PASSWORD
        ? maskSession(process.env.SURFAGENT_PROXY_PASSWORD)
        : '?';
    const cred = pickSticky(poolFile);
    if (!cred)
        return null;
    process.env.SURFAGENT_PROXY_USERNAME = cred.username;
    process.env.SURFAGENT_PROXY_PASSWORD = cred.password;
    const tag = maskSession(cred.password);
    log(`Proxy creds rotated: ${previousTag} -> ${tag} (host ${cred.host}:${cred.port})`);
    return { cred, previousTag };
}
