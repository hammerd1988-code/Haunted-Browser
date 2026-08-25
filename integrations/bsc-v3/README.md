# Haunted Browser → BSC-V3

This folder is a drop-in replacement for Blood Sweat Code's screenshot-based
**Ghost Browser** co-browse panel. It ports Haunted Browser's chrome (tabs,
address bar, bookmarks, new-tab page, Casper sidebar) into Casper's Architect
surface and wires chat to BSC's existing `sendCasperCommand` loop — the same
Casper that already has browser tools, memory, and missions.

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

## What the user sees

Opening the globe button on Casper no longer shows a 3 FPS screenshot stream.
It opens **Haunted Browser**:

- Tab strip, toolbar, DuckDuckGo search, bookmarks (localStorage per user)
- Casper sitting in a side panel with page-aware actions (summarize / explain / key points)
- Casper replies go through `/api/casper/command` on the `control_center` surface, so he keeps his tool loop
- In the **Blood Sweat Code desktop app**, pages load in a real Chromium `<webview>` (no iframe embed blocks). Casper can read the live page text.
- In a regular browser, pages load in an iframe. Sites that send `X-Frame-Options` / restrictive `frame-ancestors` get Haunted's blocked-embed overlay (open externally or ask Casper). A header-only probe at `GET /api/casper/browser/probe` is SSRF-guarded via `assertPublicHttpUrl`.

The Architect feature flag stays `ghost_browser` so existing entitlements keep working. Labels now say **Haunted Browser**.

## Tests included in the patch

```bash
npx vitest run src/components/haunted/HauntedBrowser.test.tsx casperEmbedProbe.test.ts
```
