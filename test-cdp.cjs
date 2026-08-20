// CDP smoke test for Haunted Browser: shortcuts, find-in-page, zoom, tab title/favicon.
// Launches Electron on Xvfb, connects over CDP, exercises features, prints PASS/FAIL.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = 9222;
const DISPLAY = ':99';
const ROOT = '/home/user/workspace/casper-browser';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Send a REAL X11 keypress to the Haunted Browser window. Unlike CDP-injected
// keys, this traverses Chromium's input pipeline and triggers Electron's
// before-input-event — the only way to verify webview-focused shortcuts.
function xdotoolKey(keys) {
  try {
    const wid = execSync('xdotool search --name "Haunted Browser" 2>/dev/null | head -1', {
      env: { ...process.env, DISPLAY }, timeout: 5000,
    }).toString().trim();
    if (!wid) return false;
    execSync(`xdotool key --window ${wid} ${keys}`, { env: { ...process.env, DISPLAY }, timeout: 5000 });
    return true;
  } catch { return false; }
}

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  // Pre-start the app server (Electron's ensureServer can also do this, but be explicit).
  const server = spawn('node', ['dist/index.cjs'], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:5000/api/status'); if (r.ok) break; } catch {}
    await sleep(500);
  }

  const electron = spawn('./node_modules/.bin/electron', ['.', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, env: { ...process.env, DISPLAY, NODE_ENV: 'production', CASPER_DEBUG_KEYS: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const keyLog = [];
  electron.stderr.on('data', (d) => { const s = d.toString(); keyLog.push(s); if (process.env.TEST_VERBOSE) process.stderr.write(s); });

  const up = await waitForCdp();
  if (!up) { console.log('FAIL: CDP never came up'); process.exit(1); }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];

  // Wait for the shell page.
  let shell = ctx.pages().find(p => p.url().includes('127.0.0.1:5000'));
  for (let i = 0; i < 40 && !shell; i++) {
    await sleep(500);
    shell = ctx.pages().find(p => p.url().includes('127.0.0.1:5000'));
  }
  if (!shell) { console.log('FAIL: no shell page'); process.exit(1); }
  await shell.waitForLoadState('domcontentloaded');
  await sleep(800);

  const tabCount = async () => await shell.locator('[role=tab]').count();

  // --- 1. Shell-focused Ctrl+T opens a new tab ---
  const before = await tabCount();
  await shell.keyboard.press('Control+t');
  await sleep(400);
  check('Ctrl+T (shell focus) opens new tab', await tabCount() === before + 1, `tabs ${before}->${await tabCount()}`);
  // focus the new tab's address bar to type
  await shell.locator('[data-testid=input-address]').last().click();
  await sleep(150);

  // --- 2. Ctrl+L focuses the address bar ---
  // click into the page chrome first (not the address input) so focus isn't already there
  await shell.locator('[role=tab]').first().click();
  await sleep(100);
  await shell.keyboard.press('Control+l');
  await sleep(200);
  const focusedTestId = await shell.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  check('Ctrl+L focuses address bar', focusedTestId === 'input-address', `focused=${focusedTestId}`);

  // --- 3. Navigate to example.com via the address bar ---
  await shell.locator('[data-testid=input-address]').fill('example.com');
  await shell.keyboard.press('Enter');
  // wait for the webview guest page to appear
  let guest = null;
  for (let i = 0; i < 60; i++) {
    guest = ctx.pages().find(p => /example\.com/i.test(p.url()) && !p.url().includes('127.0.0.1:5000'));
    if (guest) break;
    await sleep(500);
  }
  check('Navigated to example.com (webview guest appeared)', !!guest, guest ? guest.url() : 'no guest');
  if (guest) {
    try { await guest.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
    await sleep(800);
  }

  // --- 4. Tab title updated from the live page ---
  if (guest) {
    // The active tab's title text should now reflect the page (example.com -> "Example Domain")
    const tabTexts = await shell.locator('[role=tab]').allTextContents();
    const activeTab = tabTexts[0]; // first tab is the one we navigated
    check('Tab title reflects page', /example/i.test(activeTab), `activeTab="${activeTab}"`);
  }

  // --- 5. Find-in-page (Ctrl+F) from shell focus ---
  await shell.keyboard.press('Control+f');
  await sleep(300);
  check('Ctrl+F opens find bar', await shell.locator('[data-testid=input-find]').count() === 1);
  const findInput = shell.locator('[data-testid=input-find]');
  await findInput.click();
  // Direct call with the FIND INPUT focused (webview unfocused) — the realistic
  // production scenario where the user is typing into the find bar.
  await shell.evaluate(() => {
    const wv = document.querySelector('webview');
    window.__manualFind = { found: 0, hasFind: typeof wv?.findInPage };
    wv.addEventListener('found-in-page', (e) => {
      const r = (e && e.result) ? e.result : e;
      window.__manualFind.found++;
      window.__manualFind.last = { matches: r?.matches, req: r?.requestId, idx: r?.activeMatchOrdinal };
    });
    try { window.__manualFind.req = wv.findInPage('Example'); } catch (err) { window.__manualFind.err = String(err); }
  });
  await sleep(1000);
  const manual = await shell.evaluate(() => window.__manualFind);
  console.log('MANUAL FIND (find-input focused):', JSON.stringify(manual));
  // Now type into the find input and check the production count display.
  await findInput.pressSequentially('Example', { delay: 40 });
  await sleep(1000);
  const dbg = await shell.evaluate(() => window.__findDebug || {});
  const countText = await shell.locator('[data-testid=text-find-count]').textContent();
  check('Find-in-page returns match count', /\d+\s*\/\s*\d+/.test(countText || '') && !/0\s*\/\s*0/.test(countText || ''), `count="${countText}" debug=${JSON.stringify(dbg)} manual=${JSON.stringify(manual)}`);
  // close find bar
  await shell.keyboard.press('Escape');
  await sleep(200);

  // --- 6. Zoom (Ctrl+=) changes page scale ---
  if (guest) {
    const rectBefore = await guest.evaluate(() => {
      const h = document.querySelector('h1');
      return h ? { w: h.getBoundingClientRect().width, hgt: h.getBoundingClientRect().height } : { w: 0, hgt: 0 };
    });
    await shell.keyboard.press('Control+=');
    await shell.keyboard.press('Control+=');
    await sleep(400);
    const rectAfter = await guest.evaluate(() => {
      const h = document.querySelector('h1');
      return h ? { w: h.getBoundingClientRect().width, hgt: h.getBoundingClientRect().height } : { w: 0, hgt: 0 };
    });
    check('Ctrl+= zoom changes page scale', Math.abs(rectAfter.w - rectBefore.w) > 1 || Math.abs(rectAfter.hgt - rectBefore.hgt) > 1, `before=${JSON.stringify(rectBefore)} after=${JSON.stringify(rectAfter)}`);
    await shell.keyboard.press('Control+0');
    await sleep(200);
  }

  // --- 7. CRITICAL: shortcut while focus is INSIDE the webview page ---
  // Use a REAL keypress (xdotool) so it traverses the input pipeline and triggers
  // the main process before-input-event on the guest webContents. CDP-injected keys
  // bypass before-input-event, so they can't test this path.
  if (guest) {
    await guest.click('body');
    await sleep(400);
    const tabsBeforeGuest = await tabCount();
    const sent = xdotoolKey('ctrl+t');
    await sleep(700);
    const tabsAfterGuest = await tabCount();
    const intercepted = keyLog.some((s) => s.includes('intercepted action=new-tab'));
    check('before-input-event fires for webview-focused Ctrl+T (real key)', intercepted, `sent=${sent} tabs ${tabsBeforeGuest}->${tabsAfterGuest}`);
    check('Ctrl+T from webview focus opens new tab', tabsAfterGuest === tabsBeforeGuest + 1, `tabs ${tabsBeforeGuest}->${tabsAfterGuest}`);
  }

  // --- 8. Ctrl+W closes a tab (refocus shell chrome first) ---
  await shell.locator('[role=tab]').first().click();
  await sleep(200);
  const beforeW = await tabCount();
  await shell.keyboard.press('Control+w');
  await sleep(400);
  check('Ctrl+W closes a tab', await tabCount() === beforeW - 1, `tabs ${beforeW}->${await tabCount()}`);

  // dump key log lines that mention webview/intercepted for diagnosis
  console.log('--- key-log highlights ---');
  console.log(keyLog.join('').split('\n').filter((l) => /web-contents-created type=|intercepted action=|key=/.test(l)).slice(0, 12).join('\n') || '(none)');

  await browser.close();
  electron.kill();
  server.kill();

  const failed = results.filter(r => !r.ok);
  console.log('\n=== SUMMARY ===');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  -', f.name, f.extra)); process.exit(1); }
  console.log('ALL PASSED');
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
