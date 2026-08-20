// Types for Electron-only features used in the renderer.
declare global {
  interface Window {
    casperElectron?: {
      isElectron?: boolean;
      onShortcut?: (cb: (e: { action: string }) => void) => () => void;
      updates?: {
        onEvent?: (cb: (e: UpdateEvent) => void) => () => void;
        checkForUpdates?: () => void;
        quitAndInstall?: () => void;
      };
    };
  }

  type UpdateEvent =
    | { type: "checking" }
    | { type: "available"; version?: string }
    | { type: "up-to-date"; version?: string }
    | { type: "progress"; percent?: number }
    | { type: "downloaded"; version?: string }
    | { type: "error"; message?: string };

  interface PageContext {
    url?: string;
    title?: string;
    description?: string;
    selection?: string;
    text?: string;
    error?: string;
    at?: number;
  }
}

// The <webview> custom element (Electron only). Declared so TSX compiles.
export {};
