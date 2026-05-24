import http from 'node:http';
/**
 * POST /rotate-proxy
 *
 * Re-picks a random sticky session from the pool, updates in-process
 * credentials, and returns the new and previous session tags.
 * No request body required.
 *
 * Responses:
 *   200 — { ok: true, host, port, sessionTag, previousSessionTag, note }
 *   400 — { error: "instance is not proxied (SURFAGENT_PROXY_POOL_FILE unset)" }
 *   503 — { error: "pool unreadable or no valid entries — proxy state unchanged" }
 *
 * "Next CDP connection" nuance: already-open CDP clients retain old creds
 * until they are closed. The fork creates a fresh client per API call, so
 * the very next /navigate or /recon will use the new session.
 */
export declare function handleRotateProxy(_req: http.IncomingMessage, res: http.ServerResponse, json: (res: http.ServerResponse, status: number, data: any) => void): Promise<void>;
