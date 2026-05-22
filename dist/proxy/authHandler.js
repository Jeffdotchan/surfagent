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
export async function installProxyAuth(client) {
    const username = process.env.SURFAGENT_PROXY_USERNAME;
    const password = process.env.SURFAGENT_PROXY_PASSWORD;
    if (!username || !password)
        return;
    try {
        const { Fetch } = client;
        if (!Fetch)
            return;
        await Fetch.enable({ handleAuthRequests: true });
        // Continue every paused non-auth request immediately.
        Fetch.requestPaused((event) => {
            Fetch.continueRequest({ requestId: event.requestId }).catch(() => { });
        });
        // Respond to proxy auth challenges with the sticky-session credentials.
        Fetch.authRequired((event) => {
            Fetch.continueWithAuth({
                requestId: event.requestId,
                authChallengeResponse: {
                    response: 'ProvideCredentials',
                    username,
                    password,
                },
            }).catch(() => { });
        });
    }
    catch (e) {
        // Auth handler is best-effort. Never fail the connect over it.
        if (process.env.SURFAGENT_DEBUG === '1') {
            console.error('[surfagent] proxy auth install failed:', e.message);
        }
    }
}
