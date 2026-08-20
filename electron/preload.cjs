// Haunted Browser — renderer preload (runs in the React shell window, isolated context).
// Exposes a tiny, safe bridge so the React app knows it's inside Electron and can
// receive auto-update events. Page-context snapshots are collected directly via
// <webview>.executeJavaScript in ElectronViewport (no guest preload needed).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("casperElectron", {
  isElectron: true,
  onShortcut: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("casper:shortcut", handler);
    return () => ipcRenderer.removeListener("casper:shortcut", handler);
  },
  updates: {
    onEvent: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on("casper:update-event", handler);
      return () => ipcRenderer.removeListener("casper:update-event", handler);
    },
    checkForUpdates: () => ipcRenderer.send("casper:check-updates"),
    quitAndInstall: () => ipcRenderer.send("casper:quit-and-install"),
  },
});
