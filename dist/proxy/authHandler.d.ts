/**
 * Install a CDP Fetch domain listener to handle proxy authentication challenges.
 *
 * Mirrors the src/stealth/inject.ts pattern: best-effort, never throws,
 * logs on failure only when SURFAGENT_DEBUG=1. Called from connector.ts
 * immediately after injectStealth().
 *
 * No-op when SURFAGENT_PROXY_USERNAME / SURFAGENT_PROXY_PASSWORD are unset
 * (i.e., when no pool file is configured or pickSticky returned null).
 */
export declare function installProxyAuth(client: any): Promise<void>;
