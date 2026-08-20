# Haunted Browser

Haunted Browser is an Electron-based desktop browser with Casper, a spooky and memorable AI assistant powered by your own local LM Studio model.

Casper can chat about the page you are viewing, summarize it, explain it, and pull out key points without sending page content to a hosted AI service.

## Highlights

- Real Chromium browsing through Electron `<webview>` tabs
- Local AI through LM Studio's OpenAI-compatible API
- Dynamic Casper persona with time-of-day flavor, rotating moods, quirks, and page awareness
- Page-context actions for summaries, explanations, and key points
- Real page titles, favicons, and loading indicators
- Find in page with live match counts
- Independent zoom level for every tab
- Browser shortcuts that continue working while a web page has focus
- Local SQLite persistence for history and bookmarks
- Electron Builder packaging for Windows, Linux, and macOS
- Auto-update support ready for a configurable release channel

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+T` | Open a new tab |
| `Ctrl+W` | Close the active tab |
| `Ctrl+L` | Focus the address bar |
| `Ctrl+R` or `F5` | Reload the page |
| `Ctrl+Tab` | Select the next tab |
| `Ctrl+Shift+Tab` | Select the previous tab |
| `Alt+Left` | Go back |
| `Alt+Right` | Go forward |
| `Ctrl+F` | Find in page |
| `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Reset zoom |
| `Escape` | Close the find bar |

## Prerequisites

- Node.js 20 or newer
- [LM Studio](https://lmstudio.ai/) with a chat model loaded

## Quick Start

1. In LM Studio, open the Local Server screen and start the server. The default address is `http://localhost:1234`.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start Haunted Browser:

   ```bash
   npm run electron
   ```

4. Open Casper, select Settings, test the LM Studio connection, choose the loaded model, and save.

For development with frontend hot reload:

```bash
npm run electron:dev
```

For the browser-only web interface:

```bash
npm run dev
```

Then open `http://localhost:5000`.

## Build

```bash
npm run build
npm run dist:win
npm run dist:linux
npm run dist:mac
```

Platform installers are written to `release/`. Cross-building the Windows NSIS installer on Linux requires both Wine packages that provide `wine64` and `wine`.

The installers are unsigned by default. Windows SmartScreen may therefore show a warning until releases are signed with an Authenticode certificate.

## Local AI and Privacy

Haunted Browser defaults to LM Studio at `http://localhost:1234`. Casper sends chat history and the explicitly captured active-page context only to the model endpoint configured in Settings.

Local data is stored in SQLite. Database files, environment files, dependencies, build output, and packaged installers are excluded from Git.

## Auto-Updates

The packaged app includes `electron-updater`. Before distributing releases, replace the placeholder update URL in `package.json` with a real generic update host or configure GitHub Releases. Each update must use a new package version and include the generated installer plus update metadata.

## Documentation

See [RUNBOOK.md](RUNBOOK.md) for detailed setup, packaging, update-channel, page-context, and troubleshooting instructions.

## Status

Haunted Browser is an active prototype. The browser feature smoke test covers tab creation and closing, address-bar focus, navigation, live tab titles, find-in-page results, per-tab zoom, and shortcuts while a web page has focus.

## License

Licensed under the [MIT License](LICENSE).
