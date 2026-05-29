export interface FetchBody {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    proxy?: boolean;
    json?: boolean;
    maxBodyBytes?: number;
    timeoutMs?: number;
}
export interface FetchResult {
    status: number;
    ok: boolean;
    url: string;
    headers: Record<string, string>;
    mimeType: string | null;
    bytes: number;
    body?: string;
    json?: any;
    truncated?: boolean;
    proxied: boolean;
}
/**
 * Browserless HTTP request, by default routed through the instance's sticky
 * PacketStream session (via undici ProxyAgent) so the target site sees the
 * same residential IP the live browser uses. Throws on validation / transport
 * failure; the server maps those to 400 / 502.
 */
export declare function fetchUrl(body: FetchBody): Promise<FetchResult>;
