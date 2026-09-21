const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const shouldRun = process.env.RUN_BROWSER_E2E === '1';
const chromium = shouldRun ? require('playwright').chromium : null;

const extensionPath = path.resolve(__dirname, '..');

// Regression guard: Chrome gives every browser tab its own side panel document and
// keeps the iframes of a hidden document alive (the whole Harness page plus any AI
// site). Left alone, that grows without bound until a panel renderer is killed --
// and Chrome answers a dead panel renderer by removing the side panel outright,
// which is the "sidebar closed by itself" bug. A hidden document must park its
// frames and rebuild them when it is shown again.
const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script>window.__DSH_BOOT__ = {};</script></head>
<body><div id="composer" data-composer-input contenteditable="true" role="textbox"></div></body></html>`;

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
  process.stdout.write('SKIP: set RUN_BROWSER_E2E=1 to run the parked side panel frames test\n');
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

    const panelTab = await context.newPage();
    await panelTab.goto(fixture.url);
    const otherTab = await context.newPage();
    await otherTab.goto(fixture.url);
    await panelTab.bringToFront();

    const launcher = await context.newPage();
    await launcher.goto(`chrome-extension://${extensionId}/privacy-policy.html`);
    const panelTabId = await launcher.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url: url + '*' });
      return tabs[0] && tabs[0].id;
    }, fixture.url);
    await launcher.evaluate(async (harnessUrl) => {
      // Harness ships hidden by default; this test exercises its frame lifecycle.
      await chrome.storage.local.set({
        'deepseek-sidebar-harness-url': harnessUrl,
        'deepseek-sidebar-visibility': { harness: true }
      });
    }, fixture.url);
    await launcher.evaluate(async ({ tabId }) => {
      document.title = 'Park Target';
      const button = document.createElement('button');
      button.id = 'e2e-open-side-panel';
      button.addEventListener('click', () => chrome.sidePanel.setOptions({
        tabId,
        enabled: true,
        path: 'sidepanel.html'
      }).then(() => chrome.sidePanel.open({ tabId })));
      document.body.appendChild(button);
    }, { tabId: panelTabId });
    await launcher.bringToFront();
    await launcher.locator('#e2e-open-side-panel').click();
    await panelTab.bringToFront();

    const cdp = await context.newCDPSession(launcher);
    const target = await waitForSidePanelTarget(cdp, extensionId);
    const panel = await attachToChromeTarget(cdp, target.targetId);

    await waitFor(() => panel.evaluate(() => document.visibilityState === 'visible'),
      'the side panel document never became visible');
    await waitFor(() => panel.evaluate(() =>
      document.querySelectorAll('.webview-frame').length > 0),
      'the side panel never created its app frame');

    // Focus another tab: this document becomes hidden, exactly like a real tab switch.
    await otherTab.bringToFront();
    await waitFor(() => panel.evaluate(() => document.visibilityState === 'hidden'),
      'the side panel document did not become hidden after switching tabs');

    const parked = await panel.evaluate(() => parkPanelFrames());
    assert.equal(parked, true, 'a hidden side panel document must be able to park its frames');
    const whileParked = await panel.evaluate(() => ({
      frames: document.querySelectorAll('.webview-frame').length,
      groups: frameGroups.size
    }));
    assert.equal(whileParked.frames, 0, 'parked panel kept its iframes alive');
    assert.equal(whileParked.groups, 0, 'parked panel kept its frame group');

    // Coming back must rebuild the frame instead of leaving an empty panel.
    await panelTab.bringToFront();
    await waitFor(() => panel.evaluate(() => document.visibilityState === 'visible'),
      'the side panel document never became visible again');
    await waitFor(() => panel.evaluate(() => document.querySelectorAll('.webview-frame').length > 0),
      'the shown side panel did not rebuild its app frame');
    const restored = await panel.evaluate(() => {
      const frame = document.querySelector('.webview-frame');
      return { src: frame ? frame.getAttribute('src') || frame.src : '', groups: frameGroups.size };
    });
    assert.match(restored.src, /^http:\/\/127\.0\.0\.1:/, 'the rebuilt frame did not point at the Harness page');
    assert.ok(restored.groups >= 1, 'the rebuilt panel did not register its frame group');
  } finally {
    await context.close();
    await new Promise(resolve => fixture.server.close(resolve));
  }
})();
