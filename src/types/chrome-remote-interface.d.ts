declare module 'chrome-remote-interface' {
  interface CDPOptions {
    target?: string;
    port?: number;
    host?: string;
  }

  interface ListOptions {
    port?: number;
    host?: string;
  }

  interface Target {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
  }

  interface RuntimeEvaluateResult {
    result: {
      value?: any;
      type?: string;
    };
  }

  // Minimal stub for the Fetch CDP domain — only the methods used by the proxy auth handler.
  // The chrome-remote-interface JS runtime supports the full Fetch domain;
  // this typing covers just enable/requestPaused/authRequired/continueWithAuth/continueRequest.
  interface FetchDomain {
    enable(options?: { handleAuthRequests?: boolean }): Promise<void>;
    continueRequest(options: { requestId: string }): Promise<void>;
    continueWithAuth(options: {
      requestId: string;
      authChallengeResponse: {
        response: string;
        username?: string;
        password?: string;
      };
    }): Promise<void>;
    requestPaused(callback: (event: any) => void): void;
    authRequired(callback: (event: any) => void): void;
  }

  // Minimal stub for the Network CDP domain — only what /capture uses.
  // The chrome-remote-interface JS runtime supports the full Network domain;
  // event handlers are loosely typed (`any`) consistent with the Fetch shim above.
  interface NetworkDomain {
    enable(options?: { maxResourceBufferSize?: number; maxTotalBufferSize?: number }): Promise<void>;
    getResponseBody(options: { requestId: string }): Promise<{ body: string; base64Encoded: boolean }>;
    requestWillBeSent(callback: (event: any) => void): void;
    requestWillBeSentExtraInfo(callback: (event: any) => void): void;
    responseReceived(callback: (event: any) => void): void;
    loadingFinished(callback: (event: any) => void): void;
    webSocketCreated(callback: (event: any) => void): void;
  }

  interface Client {
    Page: {
      enable(): Promise<void>;
      addScriptToEvaluateOnNewDocument(options: { source: string }): Promise<void>;
      captureScreenshot(options?: {
        format?: string;
        fromSurface?: boolean;
      }): Promise<{ data: string }>;
      reload(options?: { ignoreCache?: boolean }): Promise<void>;
      navigate(options: { url: string }): Promise<{ frameId?: string; errorText?: string }>;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(options: {
        expression: string;
        returnByValue?: boolean;
      }): Promise<RuntimeEvaluateResult>;
    };
    DOM: {
      enable(): Promise<void>;
    };
    Fetch?: FetchDomain;
    Network?: NetworkDomain;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<Client>;

  namespace CDP {
    function List(options?: ListOptions): Promise<Target[]>;
    function New(options?: { port?: number; host?: string; url?: string }): Promise<Target>;
    function Close(options?: { port?: number; host?: string; id: string }): Promise<void>;
    interface Client {
      Page: Client['Page'];
      Runtime: Client['Runtime'];
      DOM: Client['DOM'];
      close(): Promise<void>;
    }
  }

  export = CDP;
}
