# Haunted Browser → BSC-V3

This folder is a drop-in replacement for Blood Sweat Code's screenshot-based
**Ghost Browser** co-browse panel. It ports Haunted Browser's chrome (tabs,
address bar, bookmarks, new-tab page, Casper sidebar) into Casper's Architect
surface and wires chat to BSC's existing `sendCasperCommand` loop — the same
Casper that already has browser tools, memory, missions, and provider routing.

This agent could not push a branch to `hammerd1988-code/BSC-V3` (GitHub 403 for
the Cursor bot). Apply the patch on a BSC-V3 checkout instead:

```bash
cd /path/to/BSC-V3
git checkout -b cursor/haunted-browser-casper-01be
git am /path/to/Haunted-Browser/integrations/bsc-v3/0001-replace-ghost-browser-with-haunted-browser.patch
git push -u origin cursor/haunted-browser-casper-01be
```

`git apply` also works if you do not want a mailbox commit:

```bash
git apply --index 0001-replace-ghost-browser-with-haunted-browser.patch
git commit -m "Replace Ghost Browser with Haunted Browser for Casper."
```

## Target architecture (BSC-V3 + Supabase + Railway)

Do **not** deploy Haunted Browser as its own user-facing Railway service, and do
**not** point the Casper panel at Local Coder from the browser. The intended
shape is:

```
Supabase Auth + Postgres
        ↓
BSC-V3 API on Railway
        ↓
Local Coder on Railway (server-side secrets)
        ↑
Haunted Browser UI in BSC-V3 / Electron
```

| Piece | Role |
| --- | --- |
| Haunted Browser | Frontend chrome + Casper side panel inside BSC |
| BSC `/api/casper/command` | Auth, `ghost_browser` entitlement, tools, memory, missions |
| Local Coder on Railway | Upstream OpenAI-compatible model behind BSC, not the React client |
| Supabase | Users, JWTs, subscription tiers. Bookmarks stay in `localStorage` for v1 |

Put Local Coder connection details on the **BSC-V3 Railway service**, never in
the React client and never in public Supabase settings:

```
LOCAL_CODER_BASE_URL=https://<local-coder>/v1
LOCAL_CODER_API_KEY=<secret>
LOCAL_CODER_MODEL=<model-id>
```

The Architect feature flag stays `ghost_browser` so existing entitlements keep
working. Labels now say **Haunted Browser**.

## How Casper chat actually runs

```
CasperPanel
  → HauntedBrowser.sendToCasper
  → sendCasperCommand({ surface: 'control_center' })
  → BSC /api/casper/command
```

The panel does **not** call `getDesktopBridge().casper.run()` / `bsc:casper:run`.
Those IPC channels are the desktop Casper **CLI sidecar** (build/push/scrape).
Desktop IPC that Haunted Browser *does* use:

```
focused <webview> key
  → Electron main `before-input-event`
  → `bsc:browser:shortcut`
  → `window.bscDesktop.browser.onShortcut`
  → HauntedBrowser.dispatchShortcut
```

## What the user sees

Opening the globe button on Casper no longer shows a 3 FPS screenshot stream.
It opens **Haunted Browser**:

- Tab strip, toolbar, DuckDuckGo search, bookmarks (`localStorage` per user)
- Casper sitting in a side panel with page-aware actions (summarize / explain / key points)
- **Desktop page reading is opt-in.** First use of a page-aware action shows a
  consent dialog. The panel shows “Will send page text” vs “sharing off (URL only)”
  and a Share page toggle. Excerpts are capped at 12,000 characters of page text
  and 1,500 of selection; snapshots are not persisted.
- In the **Blood Sweat Code desktop app**, pages load in a real Chromium `<webview>`
  (no iframe embed blocks). After consent, Casper can use live page text.
- In a regular browser, pages load in an iframe. Casper gets URL-level context
  only. Sites that send `X-Frame-Options` / restrictive `frame-ancestors` get
  Haunted's blocked-embed overlay. A header-only probe at
  `GET /api/casper/browser/probe` is SSRF-guarded via `assertPublicHttpUrl`.

## Tests included in the patch

```bash
npx vitest run \
  src/components/haunted/HauntedBrowser.test.tsx \
  src/components/haunted/pageContext.test.ts \
  src/components/haunted/pageReading.test.ts \
  casperEmbedProbe.test.ts
```
