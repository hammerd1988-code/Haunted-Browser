// Haunted Browser — Electron main process.
// Creates the app window (React shell), enables <webview> for real per-tab browsing,
// and starts the local Express backend if it isn't already running.
const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");

const PORT = process.env.CASPER_PORT ? Number(process.env.CASPER_PORT) : 5000;
const URL = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");

let serverProc = null;
let mainWindow = null; // the shell BrowserWindow — used to route webview shortcut IPC back to the renderer

process.on("unhandledRejection", (e) => {
  console.error("[casper] unhandled rejection:", e);
  debugLog("UNHANDLED REJECTION: " + (e && e.stack ? e.stack : String(e)));
});
process.on("uncaughtException", (e) => {
  console.error("[casper] uncaught exception:", e);
  debugLog("UNCAUGHT EXCEPTION: " + (e && e.stack ? e.stack : String(e)));
});

function debugLog(msg) {
  if (!process.env.CASPER_DEBUG) return;
  try {
    fs.appendFileSync(path.join(app.getPath("temp"), "casper-main-debug.log"), new Date().toISOString() + " " + msg + "\n");
  } catch (_) {}
}

function isPortUp() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, (res) => {
      // Any HTTP response means the server process is listening —
      // a 503 just means the model server is down, not that the app is down.
      resolve(true);
      res.destroy();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(900, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortUp()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  if (await isPortUp()) return true;

  // Packaged app: no external `node` binary on the user's machine, so run the
  // bundled Express server in-process (inside Electron's Node). The DB is stored
  // in userData (writable, survives updates).
  if (app.isPackaged) {
    process.env.CASPER_DB_PATH = path.join(app.getPath("userData"), "data.db");
    process.env.NODE_ENV = "production";
    const entry = path.join(app.getAppPath(), "dist", "index.cjs");
    debugLog("packaged: requiring " + entry);
    try {
      require(entry);
      debugLog("require returned OK");
    } catch (e) {
      debugLog("REQUIRE THREW: " + (e && e.stack ? e.stack : String(e)));
      console.error("[casper] failed to start in-process server:", e);
      return false;
    }
    return waitForPort();
  }

  // Dev / unpacked: spawn the server so logs stream to this terminal and code
  // edits reload without restarting Electron.
  const useTsx = !fs.existsSync(path.join(ROOT, "dist", "index.cjs"));
  const cmd = useTsx ? "npx" : "node";
  const args = useTsx ? ["tsx", "server/index.ts"] : ["dist/index.cjs"];
  debugLog("dev: spawning " + cmd + " " + args.join(" "));
  serverProc = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
    stdio: "inherit",
  });
  serverProc.on("error", (e) => console.error("[casper] failed to spawn server:", e));
  serverProc.on("exit", (code) => {
    if (code !== 0) console.error(`[casper] server exited with code ${code}`);
  });
  return waitForPort();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Haunted Browser",
    backgroundColor: "#0a0918",
    icon: path.join(__dirname, "..", "build-resources", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadURL(URL);

  // Block the top-level shell window from navigating away from the app.
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== URL && !url.startsWith(`${URL}/`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Open external _blank links from the shell in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url !== "about:blank") {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  setupAutoUpdater(win);
}

// ---- Auto-update (electron-updater) ----
// Only active in a packaged build with a publish provider configured.
let updaterInitialized = false;
function setupAutoUpdater(win) {
  if (!app.isPackaged) return; // dev mode is not supported by electron-updater
  if (updaterInitialized) return; // avoid duplicate listeners/IPC handlers on window recreate
  updaterInitialized = true;
  let autoUpdater = null;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (e) {
    debugLog("electron-updater require threw: " + (e && e.message));
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (type, payload) => {
    try {
      win.webContents.send("casper:update-event", { type, ...payload });
    } catch (_) {
      /* window gone */
    }
  };

  autoUpdater.on("checking-for-update", () => send("checking", {}));
  autoUpdater.on("update-available", (info) => send("available", { version: info && info.version }));
  autoUpdater.on("update-not-available", (info) => send("up-to-date", { version: info && info.version }));
  autoUpdater.on("download-progress", (p) => send("progress", { percent: p && p.percent }));
  autoUpdater.on("update-downloaded", (info) => send("downloaded", { version: info && info.version }));
  autoUpdater.on("error", (err) => send("error", { message: String((err && err.message) || err) }));

  ipcMain.on("casper:check-updates", () => {
    if (!autoUpdater) return;
    Promise.resolve(autoUpdater.checkForUpdates()).catch((e) => send("error", { message: String(e && e.message) }));
  });
  ipcMain.on("casper:quit-and-install", () => {
    if (!autoUpdater) return;
    try {
      autoUpdater.quitAndInstall();
    } catch (_) {
      /* ignore */
    }
  });

  // Auto-check on launch only once a real release channel is configured — i.e. the
  // publish URL in app-update.yml is no longer the placeholder. Manual "Check for
  // updates" in Settings works regardless.
  const channelConfigured = (() => {
    try {
      const yml = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
      return !/example\.com|YOUR_/i.test(yml);
    } catch {
      return false;
    }
  })();
  if (channelConfigured) {
    setTimeout(() => {
      Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
    }, 5000);
  } else {
    debugLog("auto-check skipped: publish URL is still the placeholder");
  }
}

app.whenReady().then(async () => {
  debugLog("app ready, ensuring server");
  wireWebContentsShortcuts();
  const ok = await ensureServer();
  if (!ok) {
    console.error(`[casper] could not reach the app server at ${URL}`);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---- Browser keyboard shortcuts (work even while a <webview> page has focus) ----
// The shell renderer's keydown can't see keys typed inside the webview guest, so we
// intercept them here on the guest's own webContents BEFORE the page receives them.
// Matched combos are swallowed (preventDefault) and forwarded to the shell window as
// `casper:shortcut` IPC; the React layer decides what each action does.
let shortcutsWired = false;
function wireWebContentsShortcuts() {
  if (shortcutsWired) return;
  shortcutsWired = true;
  app.on("web-contents-created", (_e, contents) => {
    // Only the <webview> guest pages (not the shell window itself).
    const type = contents.getType();
    if (process.env.CASPER_DEBUG_KEYS) console.error(`[keys] web-contents-created type=${type}`);
    if (type !== "webview") return;
    contents.on("before-input-event", (event, input) => {
      if (!input || input.type !== "keyDown") return;
      const command = !!(input.control || input.meta);
      const shift = !!input.shift;
      const alt = !!input.alt;
      const key = input.key;
      const code = input.code;
      let action = null;
      if (process.env.CASPER_DEBUG_KEYS) console.error(`[keys] type=${input.type} key=${key} code=${code} ctrl=${command} shift=${shift} alt=${alt}`);

      // Zoom keys come in several guises across keyboards (= / + / Equal / Add, etc.).
      const isZoomIn = ["=", "+", "Equal", "Add"].includes(key) || code === "Equal" || code === "NumpadAdd";
      const isZoomOut = ["-", "Minus", "Subtract"].includes(key) || code === "Minus" || code === "NumpadSubtract";
      const isZoomReset = ["0", "Digit0", "Numpad0"].includes(key);

      if (command && key === "t" && !shift) action = "new-tab";
      else if (command && key === "w" && !shift) action = "close-tab";
      else if (command && key === "l" && !shift) action = "focus-address";
      else if (command && key === "r" && !shift) action = "reload";
      else if (command && key === "f" && !shift) action = "find";
      else if (command && shift && key === "Tab") action = "prev-tab";
      else if (command && !shift && key === "Tab") action = "next-tab";
      else if (alt && !shift && key === "ArrowLeft") action = "back";
      else if (alt && !shift && key === "ArrowRight") action = "forward";
      else if (command && isZoomIn) action = "zoom-in";
      else if (command && isZoomOut) action = "zoom-out";
      else if (command && isZoomReset) action = "zoom-reset";

      if (!action) return;
      event.preventDefault();
      if (process.env.CASPER_DEBUG_KEYS) console.error(`[keys] intercepted action=${action}`);
      const host = contents.hostWebContents;
      const win = host ? BrowserWindow.fromWebContents(host) : mainWindow;
      if (win && !win.isDestroyed()) win.webContents.send("casper:shortcut", { action });
    });
  });
}

app.on("window-all-closed", () => {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
    serverProc = null;
  }
  if (process.platform !== "darwin") app.quit();
});
