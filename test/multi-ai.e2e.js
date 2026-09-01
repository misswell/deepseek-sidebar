const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const shouldRun = process.env.RUN_MULTI_AI_E2E === '1';
const chromium = shouldRun ? require('playwright').chromium : null;
const extensionPath = path.resolve(__dirname, '..');

if (!shouldRun) {
  process.stdout.write('SKIP: set RUN_MULTI_AI_E2E=1 to run the multi AI browser test\n');
} else (async () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/multi-ai-target.html'));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
  const context = await chromium.launchPersistentContext('', {
    executablePath: chromium.executablePath(),
    headless: false,
    viewport: { width: 1440, height: 900 },
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
    await page.goto(`chrome-extension://${extensionId}/multi-ai.html`);
    await page.waitForSelector('.ai-panel');
    assert.equal(await page.locator('.ai-panel').count(), 3);
    assert.equal(await page.locator('.app-choice[aria-pressed="true"]').count(), 3);

    await page.locator('.app-choice[data-app="gemini"]').click();
    assert.equal(await page.locator('.ai-panel').count(), 4);
    await page.locator('.app-choice[data-app="gemini"]').click();
    assert.equal(await page.locator('.ai-panel').count(), 3);

    await page.locator('#prompt').fill('比较三个方案并给出结论');
    assert.equal(await page.locator('#prompt').inputValue(), '比较三个方案并给出结论');

    await worker.evaluate(url => {
      const originalById = DeepSeekSidebarApps.byId;
      DeepSeekSidebarApps.byId = id => id === 'chatgpt'
        ? { id, name: 'Fake AI', multi: true }
        : originalById(id);
      DeepSeekSidebarApps.matchesFrame = (id, value) => id === 'chatgpt' && value.startsWith(url);
    }, fixtureUrl);
    await page.evaluate(url => {
      const frame = document.createElement('iframe');
      frame.id = 'e2e-fake-ai';
      frame.src = url;
      document.body.appendChild(frame);
    }, fixtureUrl);
    const fakeFrame = page.frameLocator('#e2e-fake-ai');
    await fakeFrame.locator('textarea').waitFor();
    const dispatch = await page.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendMessage({
        source: 'deepseek-sidebar-multi-ai',
        command: 'prompt',
        prompt: '同一个测试问题',
        appIds: ['chatgpt']
      }, resolve);
    }));
    assert.equal(dispatch.ok, true);
    assert.equal(dispatch.value.results[0].ok, true);
    await fakeFrame.locator('#answer').waitFor({ state: 'visible' });
    assert.equal(await fakeFrame.locator('#answer').textContent(), '同一个测试问题');
    await page.evaluate(() => document.getElementById('e2e-fake-ai').remove());

    await page.screenshot({
      path: path.join(extensionPath, 'output/playwright/multi-ai-1440x900.png'),
      fullPage: true
    });
    process.stdout.write('PASS: multi AI workspace rendered, switched panels and submitted one prompt\n');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
