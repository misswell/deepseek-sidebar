const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const shouldRun = process.env.RUN_BROWSER_E2E === '1';
const chromium = shouldRun ? require('playwright').chromium : null;

const extensionPath = path.resolve(__dirname, '..');

// A fresh install must show the six chat sites: DeepSeek Harness and 有道词典 are
// hidden until the user switches them on in 设置, in the toolbar and in the
// settings page alike. The default app follows the visible set, so a new install
// opens DeepSeek instead of an invisible Harness entry.
const EXPECTED_VISIBLE = ['deepseek', 'zhipu', 'qianwen', 'kimi', 'chatgpt', 'gemini'];
const EXPECTED_HIDDEN = ['harness', 'youdao'];

const FIXTURE_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>fresh install</body></html>';

async function startFixtureServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_HTML);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function attachToChromeTarget(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let commandId = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params })
    }).catch(reject);
  });
  await send('Runtime.enable');
  return {
    async evaluate(fn, arg) {
      const result = await send('Runtime.evaluate', {
        expression: `(${fn})(${JSON.stringify(arg)})`,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error((details.exception && details.exception.description) || details.text);
      }
      return result.result.value;
    }
  };
}

async function waitForSidePanelTarget(cdp, extensionId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(item =>
      !item.attached && item.type === 'page' &&
      item.url === `chrome-extension://${extensionId}/sidepanel.html`
    );
    if (target) return target;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Chrome did not expose the tab-scoped side panel target');
}

async function waitFor(predicate, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

if (!shouldRun) {
  process.stdout.write('SKIP: set RUN_BROWSER_E2E=1 to run the fresh-install default test\n');
} else (async () => {
  const fixture = await startFixtureServer();
  const context = await chromium.launchPersistentContext('', {
    executablePath: chromium.executablePath(),
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto(fixture.url);
    await page.bringToFront();

    const launcher = await context.newPage();
    await launcher.goto(`chrome-extension://${extensionId}/privacy-policy.html`);
    const tabId = await launcher.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url: url + '*' });
      return tabs[0] && tabs[0].id;
    }, fixture.url);
    await launcher.evaluate(async ({ tabId }) => {
      const button = document.createElement('button');
      button.id = 'e2e-open-side-panel';
      button.addEventListener('click', () => chrome.sidePanel.setOptions({
        tabId,
        enabled: true,
        path: 'sidepanel.html'
      }).then(() => chrome.sidePanel.open({ tabId })));
      document.body.appendChild(button);
    }, { tabId });
    await launcher.bringToFront();
    await launcher.locator('#e2e-open-side-panel').click();
    await page.bringToFront();

    const cdp = await context.newCDPSession(launcher);
    const target = await waitForSidePanelTarget(cdp, extensionId);
    const panel = await attachToChromeTarget(cdp, target.targetId);

    // Wait for the DOM first: the target exists while sidepanel.js is still loading.
    await waitFor(() => panel.evaluate(() =>
      document.querySelectorAll('#appSwitcher .app-btn').length > 0),
      'the side panel never rendered its app switcher');

    const toolbar = await panel.evaluate(() => ({
      visible: appButtons.map(button => button.dataset.app),
      currentApp,
      visibility: Object.assign({}, appVisibility),
      frames: Array.from(document.querySelectorAll('.webview-frame'))
        .map(frame => frame.getAttribute('src') || frame.src)
    }));
    assert.deepEqual(toolbar.visible, EXPECTED_VISIBLE, 'the fresh-install toolbar showed the wrong apps');
    assert.equal(toolbar.currentApp, 'deepseek', 'a new install must open a visible app');
    EXPECTED_HIDDEN.forEach(id => {
      assert.equal(toolbar.visibility[id], false, id + ' must stay hidden on a fresh install');
    });
    assert.equal(
      toolbar.frames.some(src => /127\.0\.0\.1|localhost/.test(src)),
      false,
      'a hidden Harness app must not load its frame'
    );

    // The settings page shows the same defaults, so a user can turn them back on.
    await launcher.goto(`chrome-extension://${extensionId}/config.html`);
    await waitFor(() => launcher.evaluate(() =>
      document.querySelectorAll('#appList .app-item').length > 0),
      'the settings page never rendered its app list');
    const settings = await launcher.evaluate(() => ({
      all: Array.from(document.querySelectorAll('#appList .app-item')).map(item => item.dataset.appId),
      checked: Array.from(document.querySelectorAll('#appList .app-item.checked')).map(item => item.dataset.appId)
    }));
    assert.deepEqual(settings.all.slice().sort(), EXPECTED_VISIBLE.concat(EXPECTED_HIDDEN).sort());
    assert.deepEqual(settings.checked, EXPECTED_VISIBLE, 'the settings page did not reflect the shipped defaults');
  } finally {
    await context.close();
    await new Promise(resolve => fixture.server.close(resolve));
  }
})();
