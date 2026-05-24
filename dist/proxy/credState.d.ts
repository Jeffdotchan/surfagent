import { type StickyCred } from './pool.js';
/**
 * Idempotent env-stash. If creds are already set in process.env, no-op and
 * returns null. Otherwise pick from the pool and stash. Returns the cred
 * (newly picked) or null if already set / pool absent / pool unreadable.
 *
 * Log shape (operator-facing, preserved exactly):
 *   launch:  "Chrome will route via proxy <host>:<port> (sticky session <tag>)"
 *   restart: "Proxy creds restored from pool (sticky session <tag>) — node restarted while Chrome was alive"
 */
export declare function ensureProxyEnvSet(reason: 'launch' | 'restart'): StickyCred | null;
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
export declare function rotateProxyCred(): {
    cred: StickyCred;
    previousTag: string;
} | null;
