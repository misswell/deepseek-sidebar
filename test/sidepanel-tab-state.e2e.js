const assert = require('node:assert/strict');
const path = require('node:path');
const shouldRun = process.env.RUN_BROWSER_E2E === '1';
const chromium = shouldRun ? require('playwright').chromium : null;

const extensionPath = path.resolve(__dirname, '..');

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
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
  };
}

async function waitForPanelState(panel, app, zoom) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const matches = await panel.evaluate(
      ({ app, zoom }) => {
      const active = document.querySelector('.app-btn.active');
      const label = document.querySelector('#zoom-label');
      return active?.dataset.app === app && label?.textContent === `${zoom}%`;
      },
      { app, zoom }
    );
    if (matches) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const actual = await panel.evaluate(() => ({
    app: document.querySelector('.app-btn.active')?.dataset.app,
    zoom: document.querySelector('#zoom-label')?.textContent
  }));
  assert.fail(`Expected ${app}/${zoom}%, received ${actual.app}/${actual.zoom}`);
}

async function waitForPanelToTrackActiveTab(panel) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const synced = await panel.evaluate(() => new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        resolve(Boolean(tabs[0] && tabs[0].id === currentTabId));
      });
    }));
    if (synced) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Side panel did not track the active Chrome tab');
}

function clickPanel(panel, selector, times = 1) {
  return panel.evaluate(({ selector, times }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    for (let i = 0; i < times; i += 1) element.click();
  }, { selector, times });
}

async function waitForStoredState(panel, title, app, zoom) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const stored = await panel.evaluate(({ title, app, zoom }) => new Promise(resolve => {
      chrome.tabs.query({}, tabs => {
        const tab = tabs.find(item => item.title === title);
        if (!tab) return resolve(false);
        chrome.storage.local.get(`deepseek-sidebar-tab-state:${tab.id}`, values => {
          const state = values[`deepseek-sidebar-tab-state:${tab.id}`];
          resolve(state?.app === app && state?.zoom === zoom);
        });
      });
    }), { title, app, zoom });
    if (stored) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const debug = await panel.evaluate(() => new Promise(resolve => {
    chrome.tabs.query({}, tabs => chrome.storage.local.get(null, values => resolve({
      tabs: tabs.map(tab => ({ id: tab.id, title: tab.title })),
      states: Object.fromEntries(Object.entries(values).filter(([key]) =>
        key.startsWith('deepseek-sidebar-tab-state:'))),
      runtime: {
        currentTabId,
        currentApp,
        currentZoom,
        persistedTabStates,
        panelStates: Array.from(tabPanelStates.entries())
      }
    })));
  }));
  assert.fail(`Stored state was not isolated for ${title}: ${JSON.stringify(debug)}`);
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

if (!shouldRun) {
  process.stdout.write('SKIP: set RUN_BROWSER_E2E=1 to run the Chrome side panel test\n');
} else (async () => {
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
    await launcher.evaluate(() => {
      document.title = 'Tab A';
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
    await launcher.locator('#e2e-open-side-panel').click();
    const cdp = await context.newCDPSession(launcher);
    const panelATarget = await waitForSidePanelTarget(cdp, extensionId);
    const panelA = await attachToChromeTarget(cdp, panelATarget.targetId);

    await waitForPanelToTrackActiveTab(panelA);
    await clickPanel(panelA, '.app-btn[data-app="chatgpt"]');
    await clickPanel(panelA, '#zoom-out', 2);
    await waitForPanelState(panelA, 'chatgpt', 80);

    const tabB = await context.newPage();
    await tabB.goto('data:text/html,<title>Tab B</title><h1>B</h1>');
    await launcher.waitForFunction(() => new Promise(resolve => {
      chrome.tabs.query({}, async tabs => {
        const tab = tabs.find(item => item.title === 'Tab B');
        if (!tab) return resolve(false);
        const options = await chrome.sidePanel.getOptions({ tabId: tab.id });
        resolve(options.path === 'sidepanel.html');
      });
    }));
    await tabB.bringToFront();
    const panelBTarget = await waitForSidePanelTarget(cdp, extensionId);
    const panelB = await attachToChromeTarget(cdp, panelBTarget.targetId);
    await waitForPanelToTrackActiveTab(panelB);
    await waitForPanelState(panelB, 'harness', 100);
    await clickPanel(panelB, '.app-btn[data-app="qianwen"]');
    await clickPanel(panelB, '#zoom-in', 4);
    await waitForPanelState(panelB, 'qianwen', 140);

    await launcher.bringToFront();
    await waitForPanelState(panelA, 'chatgpt', 80);
    await tabB.bringToFront();
    await waitForPanelState(panelB, 'qianwen', 140);
    await waitForStoredState(panelB, 'Tab A', 'chatgpt', 80);
    await waitForStoredState(panelB, 'Tab B', 'qianwen', 140);

    assert.equal(await panelB.evaluate(() => document.querySelector('#zoom-label')?.textContent), '140%');
    process.stdout.write('PASS: per-tab app and zoom survived active-tab switching\n');
  } finally {
    await context.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
