# Haunted Browser — Local Run

Run Haunted Browser on your own machine, powered by your local **LM Studio** model server.

## Prerequisites

1. **Node.js 20+** — <https://nodejs.org> (verify: `node -v`)
2. **LM Studio** — <https://lmstudio.ai>
   - Open LM Studio → **Local Server** tab
   - Click **Start Server** (defaults to port **1234**)
   - Load a chat model (e.g. Llama 3.2, Qwen, Mistral) — any GGUF model from the catalog works
   - Confirm the server page shows the model as loaded

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5000> in any browser.

## Connect Casper to your model

1. Click the **Casper** pill (top-right) to open the assistant panel.
2. Click the gear icon → **Settings**.
3. Model server URL should already be `http://localhost:1234` (LM Studio default).
4. Click **Test connection** — it should flip to **Live** and list your loaded model.
5. Pick a model from the dropdown, then **Save & haunt**.

Casper now streams real answers from your local model. No data leaves your machine.

## What works locally vs the hosted preview

| Feature | Hosted preview | Local run |
|---|---|---|
| Casper chat | Demo mode only | **Live** (your LM Studio model) |
| Browse any site | iframe embeddable-only | iframe embeddable-only (still sandboxed by the browser) |
| History / bookmarks | Saved in the sandbox DB | Saved in a local SQLite file (`data.db`) |

> Note: even locally, this is a **web app in a browser tab**. Many sites (Google, GitHub, YouTube)
> send `X-Frame-Options` / CSP headers that forbid being embedded in an iframe — those show
> Casper's friendly "can't embed" fallback card. The Electron desktop port (next phase) removes
> that limit entirely by using a real `<webview>` / Chromium instance for every site.

## Ollama alternative

If you use Ollama instead: `ollama serve` (default `http://localhost:11434`),
then set the model server URL to `http://localhost:11434` in Settings.

## Electron desktop build (real browsing of any site)

The web app browses via an iframe, so sites that send `X-Frame-Options` / CSP headers
(Google, GitHub, YouTube, DuckDuckGo) can't embed and show a fallback card. The Electron
desktop build fixes this: every site loads natively in a real Chromium `<webview>`, with no
embed limits — and Casper can read the current page's text to summarize/explain it.

### Run the desktop app

```bash
npm install
npm run electron
```

This launches the Haunted Browser window. It auto-starts the local backend (port 5000) if it
isn't already running, then loads the app. Point it at your LM Studio in Settings →
**Test connection** → pick a model → **Save & haunt**.

### Dev mode (hot reload)

```bash
npm run electron:dev
```

Runs the Vite dev server and Electron together, so frontend changes hot-reload.

### Keyboard shortcuts

Shortcuts work whether focus is in the address bar, the shell, or **inside a web page**.
When a page has focus, the main process intercepts the key via `before-input-event` before
the page ever sees it, so a site can't swallow your browser controls.

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+L` | Focus address bar |
| `Ctrl+R` / `F5` | Reload page |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Alt+←` / `Alt+→` | Back / forward |
| `Ctrl+F` | Find in page |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset (per tab) |
| `Esc` | Close find bar |

### Find in page

`Ctrl+F` opens a find bar across the top of the page. Type to search live; matches are
highlighted with a count (`N / total`). `Enter` / `Shift+Enter` jump to the next / previous
match, `Esc` closes the bar. Each tab keeps its own find state.

### Per-tab zoom

`Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom the active page in, out, and back to 100%. Zoom is
remembered per tab (range 50%–300%), so a zoomed news site stays zoomed when you switch
away and back.

### Real tab titles, favicons & loading state

As you browse, each tab shows the live page title and site favicon, with a small spinner
while a page is loading. Fallback favicons are used for sites that don't publish one.

### How Casper reads pages

When a page finishes loading, the desktop build runs a small read-only script inside the
webview (via `<webview>.executeJavaScript`) to take a safe snapshot: URL, title, description,
the user's text selection, and up to 30k chars of body text. When you ask Casper to
**Summarize page** / **Explain page** / **Key points**, that snapshot is injected as context so
Casper reasons about what you're actually viewing. Context is cleared on each navigation and
only accepted when its URL matches the active tab, so a page action never injects a stale
page. No page content is sent anywhere except your local LM Studio.

### Packaging (installers)

Build a distributable installer with electron-builder (already configured):

```bash
npm run dist:win     # Windows NSIS installer (.exe) — run on Windows
npm run dist:linux  # Linux AppImage — run on Linux
npm run dist:mac     # macOS .dmg — run on macOS
```

**Cross-building the Windows installer on Linux:** `dist:win` also works on Linux
if Wine is installed — electron-builder runs the NSIS compiler through Wine. On a
debian/Ubuntu host:

```bash
sudo apt-get install -y --no-install-recommends wine64 wine   # provides the `wine` cmd
export WINEPREFIX=$HOME/.wine WINEDEBUG=-all XDG_RUNTIME_DIR=/tmp/xdgrun
# initialize the prefix once (first run is slow):
wine wineboot --init
# then build:
npm run dist:win
```

No code-signing is performed by default (the build logs "signing is skipped"), which is
fine for a local or personal prototype. Windows SmartScreen and macOS Gatekeeper may warn
on first launch. Follow [CODE_SIGNING.md](CODE_SIGNING.md) to configure Windows Authenticode
signing, macOS Developer ID signing and notarization, GitHub Actions secrets, and artifact
verification.

Output lands in `release/` (e.g. `release/Haunted Browser Setup 1.0.0.exe`).
The build bundles the React client + Express server into a single app, rebuilds
`better-sqlite3` for Electron, and unpacks it from the asar so the native binary loads.
The database is stored in the OS per-user data dir (`userData`), so bookmarks and
history survive updates and aren't written inside the install folder.

A Casper ghost icon is included at `build-resources/icon.png` / `icon.ico`. To swap it,
replace those files (PNG must be >= 512x512) and re-run `npm run dist`.

### Auto-update

The packaged app checks for updates on launch (and via Settings → Updates →
Check for updates) using `electron-updater`. When a new version is found it
downloads in the background and installs on the next restart (or immediately via
the "Restart to update" button). This only runs in a packaged build — in dev
mode (`npm run electron`) it's disabled.

Updates use the project's **GitHub Releases** channel. Pushing a version tag
builds and publishes separate Windows x64, Linux x64, macOS Intel, and macOS
Apple Silicon installers through `.github/workflows/release.yml`.

```bash
npm version patch
git push origin main --follow-tags
```

The workflow runs each build on its native operating system, publishes the
installers and update metadata to the matching GitHub release, and uses
architecture-specific filenames.

To use a generic static update host instead, replace the `publish` block in
`package.json` with:

```json
"publish": { "provider": "generic", "url": "https://downloads.example.com/haunted-browser/" }
```

Then build locally and upload each installer plus its generated `latest*.yml`
metadata file to that URL.

Notes:
- `better-sqlite3` ships Electron-compatible prebuilt binaries, so no C++ build tools are
  required on the user's machine in most cases.
- The optional `bufferutil` dependency was removed (it's not needed; `ws` falls back to pure JS).
- `electron-builder` and `electron-updater` are dev/production dependencies respectively —
  they won't be installed for end users who just run the built installer.
- Auto-update checks use the public GitHub Releases feed. Signed and verified installers are
  recommended before distributing Haunted Browser beyond development testing. Follow
  [CODE_SIGNING.md](CODE_SIGNING.md) for both Windows and macOS.

## Troubleshooting

- **"Not reachable — running in demo mode"**: LM Studio's server isn't started, no model is loaded,
  or the port differs. Re-check the Local Server tab.
- **"Bad Request"**: a model wasn't selected. Pick one from the dropdown (Casper auto-resolves the
  loaded model, but a firewall or wrong port can prevent the model list from loading).
- **Port 5000 in use**: another process holds 5000. Stop it, or it'll auto-retry the next port.
- **`better-sqlite3` build error on Windows**: ensure Node 20+ and run `npm install` again;
  prebuilt binaries are fetched automatically — no compiler needed.
