export interface CaptureBody {
    tab: string;
    durationMs?: number;
    reload?: boolean;
    navigate?: string;
    types?: string[];
    includeBodies?: boolean;
    maxBodyBytes?: number;
    stripQuery?: boolean;
}
export interface CapturedApi {
    method: string;
    url: string;
    type: string;
    status: number | null;
    mimeType: string | null;
    requestPayload: string | null;
    responseBytes: number | null;
    body?: string;
    truncated?: boolean;
}
export interface CaptureResult {
    tab: string;
    url: string;
    capturedMs: number;
    totalRequests: number;
    apis: CapturedApi[];
}
interface CaptureOptions {
    port?: number;
    host?: string;
}
export declare function captureTab(body: CaptureBody, opts?: CaptureOptions): Promise<CaptureResult>;
export {};
