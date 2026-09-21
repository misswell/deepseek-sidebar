const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const shouldRun = process.env.RUN_BROWSER_E2E === '1';
const chromium = shouldRun ? require('playwright').chromium : null;

const extensionPath = path.resolve(__dirname, '..');

// A minimal stand-in for the real Harness page: its composer is the same
// Lexical-shaped contenteditable the sidebar has to fill.
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<script>window.__DSH_BOOT__ = {};</script></head>
<body>
  <div id="composer" data-composer-input contenteditable="true" role="textbox"
       aria-multiline="true" style="min-height:44px;border:1px solid #888;width:420px"></div>
  <div id="decoy" contenteditable="true" style="min-height:44px;border:1px solid #ddd;width:420px"></div>
  <script>
    const composer = document.getElementById('composer');
    const report = () => {
      try { fetch('/filled?text=' + encodeURIComponent(composer.innerText)); } catch (error) {}
    };
    // The sidebar fills through DOM events; observe them and report the result.
    composer.addEventListener('input', report);
    composer.addEventListener('change', report);
    new MutationObserver(report).observe(composer, { childList: true, subtree: true, characterData: true });
  </script>
</body></html>`;

function startFixtureServer() {
  const fills = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/filled') fills.push(url.searchParams.get('text') || '');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_HTML);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, fills, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
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
  process.stdout.write('SKIP: set RUN_BROWSER_E2E=1 to run the side panel fill test\n');
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

    const launcher = await context.newPage();
    await launcher.goto(`chrome-extension://${extensionId}/privacy-policy.html`);
    await launcher.evaluate(async (harnessUrl) => {
      // Harness ships hidden by default; this test exercises its fill path.
      await chrome.storage.local.set({
        'deepseek-sidebar-harness-url': harnessUrl,
        'deepseek-sidebar-visibility': { harness: true }
      });
    }, fixture.url);
    await launcher.evaluate(() => {
      document.title = 'Fill Target';
      const button = document.createElement('button');
      button.id = 'e2e-open-side-panel';
      button.addEventListener('click', () => chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab) return;
        chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled: true,
          path: 'sidepanel.html'
        }).then(() => chrome.sidePanel.open({ tabId: tab.id }));
      }));
      document.body.appendChild(button);
    });
    await launcher.bringToFront();
    await launcher.locator('#e2e-open-side-panel').click();

    const cdp = await context.newCDPSession(launcher);
    const panelTarget = await waitForSidePanelTarget(cdp, extensionId);
    const panel = await attachToChromeTarget(cdp, panelTarget.targetId);

    await waitFor(() => panel.evaluate(() => {
      try {
        return currentApp === 'harness' &&
          Boolean(frameGroupForTab(currentTabId, false)?.get('harness')) &&
          Boolean(loadedAppsForTab(currentTabId, false)?.has('harness'));
      } catch (error) {
        // The panel script may not have evaluated its declarations yet.
        return false;
      }
    }), 'Side panel did not render the Harness app frame');

    // The page bridge is injected at document_idle; retry briefly until the
    // frame answers, exactly like a user picking after the page has loaded.
    await waitFor(async () => {
      await panel.evaluate(() => fillCurrentAppInput('E2E-FILL-CHECK'));
      return fixture.fills.includes('E2E-FILL-CHECK');
    }, `Harness composer never received the picked text (fills: ${JSON.stringify(fixture.fills)})`);

    const status = await panel.evaluate(() => document.getElementById('page-reader-status').textContent);
    assert.match(status, /已填充到输入框/);
  } finally {
    await context.close();
    await new Promise(resolve => fixture.server.close(resolve));
  }
})();
