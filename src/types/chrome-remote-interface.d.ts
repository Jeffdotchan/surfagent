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

  interface Client {
    Page: {
      enable(): Promise<void>;
      addScriptToEvaluateOnNewDocument(options: { source: string }): Promise<void>;
      captureScreenshot(options?: {
        format?: string;
        fromSurface?: boolean;
      }): Promise<{ data: string }>;
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
