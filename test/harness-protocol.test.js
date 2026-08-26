const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const manifest = require('../manifest.json');
const protocol = require('../harness-protocol.js');
const tabState = require('../tab-state.js');
const HarnessClient = require('../harness-client.js');
const HarnessBridgeClient = require('../harness-bridge-client.js');

test('grants the browser operator required access to ordinary web pages', () => {
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.equal(manifest.optional_host_permissions, undefined);
});

test('normalizes Harness URLs without changing the host or port', () => {
  assert.equal(protocol.DEFAULT_HARNESS_URL, 'http://127.0.0.1:3080');
  assert.equal(protocol.normalizeHarnessUrl('http://127.0.0.1:3080/'), 'http://127.0.0.1:3080');
  assert.equal(protocol.normalizeHarnessUrl('https://example.test/harness///'), 'https://example.test/harness');
  assert.equal(protocol.isLocalHarnessDiscoveryTarget('http://127.0.0.1:3080/'), true);
  assert.equal(protocol.isLocalHarnessDiscoveryTarget('http://localhost:3080/'), true);
  assert.equal(protocol.isLocalHarnessDiscoveryTarget('http://127.0.0.1:3081/'), false);
  assert.equal(protocol.localHarnessCandidateUrls('http://127.0.0.1:3080/').length, 20);
  assert.throws(() => protocol.normalizeHarnessUrl('javascript:alert(1)'), /http 或 https/);
});

test('builds the Harness RPC envelope and API URL', () => {
  assert.deepEqual(protocol.createRpcEnvelope('host.describe', {}, 'rpc-test'), {
    type: 'client-request',
    rpcId: 'rpc-test',
    method: 'host.describe',
    payload: {}
  });
  assert.equal(protocol.harnessApiUrl('http://127.0.0.1:3080/', 'session.prompt'),
    'http://127.0.0.1:3080/api/session.prompt');
  assert.equal(protocol.harnessApiUrl('https://example.test/harness/', 'host.describe'),
    'https://example.test/harness/api/host.describe');
});

test('parses structured browser actions from JSON or a fenced response', () => {
  const parsed = protocol.parseBrowserActionResponse([
    '按计划执行：',
    '```json',
    JSON.stringify({
      done: false,
      message: '开始搜索',
      actions: [
        { type: 'click', selector: 'button.search' },
        { type: 'type', selector: 'input[name=q]', text: 'Harness' },
        { type: 'unknown', selector: '#ignored' }
      ]
    }),
    '```'
  ].join('\n'));

  assert.equal(parsed.done, false);
  assert.equal(parsed.message, '开始搜索');
  assert.deepEqual(parsed.actions.map(action => action.type), ['click', 'fill']);
  assert.equal(parsed.actions[1].value, 'Harness');
});

test('extracts only new assistant text from session history', () => {
  const text = protocol.extractAssistantText([
    { event: { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: 'old' }] } } } },
    { event: { type: 'assistant/message', seq: 7, data: { message: { content: [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: '{"actions":[]}' }
    ] } } } }
  ], 5);
  assert.equal(text, '{"actions":[]}');
});

test('builds a prompt that carries the current page snapshot', () => {
  const prompt = protocol.buildBrowserTaskPrompt({
    task: '点击搜索按钮',
    snapshot: { title: '测试页', url: 'https://example.test', text: '搜索', interactive: [] }
  });
  assert.match(prompt, /只能控制用户明确指定的当前 Chrome 标签页/);
  assert.match(prompt, /测试页/);
  assert.match(prompt, /点击搜索按钮/);
});

test('client posts the verified Harness RPC shape', async () => {
  let call;
  const client = new HarnessClient('http://127.0.0.1:3080', {
    fetchImpl: async (url, options) => {
      call = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { ok: true, value: { model: 'test-model' } } })
      };
    }
  });
  const result = await client.describe();
  assert.deepEqual(result, { model: 'test-model' });
  assert.equal(call.url, 'http://127.0.0.1:3080/api/host.describe');
  const body = JSON.parse(call.options.body);
  assert.equal(body.type, 'client-request');
  assert.equal(body.method, 'host.describe');
  assert.deepEqual(body.payload, {});
});

test('client can cancel an active Harness session through the same RPC transport', async () => {
  let call;
  const client = new HarnessClient('http://127.0.0.1:3080', {
    fetchImpl: async (url, options) => {
      call = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { ok: true, value: { accepted: true } } })
      };
    }
  });
  assert.deepEqual(await client.cancel('session-1'), { accepted: true });
  assert.equal(call.url, 'http://127.0.0.1:3080/api/session.cancel');
  assert.equal(JSON.parse(call.options.body).payload.sessionId, 'session-1');
});

test('builds bridge URLs and parses server browser-tool frames', () => {
  assert.equal(protocol.harnessBridgeConfigUrl('http://127.0.0.1:3080/'),
    'http://127.0.0.1:3080/ext/bridge-config');
  assert.equal(protocol.harnessBridgeWebSocketUrl('http://127.0.0.1:3080/'),
    'ws://127.0.0.1:3080/ext/bridge');
  assert.equal(protocol.harnessBridgeWebSocketUrl('https://example.test/harness'),
    'wss://example.test/harness/ext/bridge');

  const frame = protocol.parseBridgeFrame(JSON.stringify({
    t: 'tool.call',
    id: 'tool-1',
    name: 'browser_snapshot',
    args: { delta: true },
    expiresAt: Date.now() + 10_000
  }));
  assert.deepEqual(frame && {
    t: frame.t,
    id: frame.id,
    name: frame.name,
    args: frame.args
  }, {
    t: 'tool.call',
    id: 'tool-1',
    name: 'browser_snapshot',
    args: { delta: true }
  });
  assert.equal(protocol.isServerBridgeFrame(frame), true);
  assert.equal(protocol.parseBridgeFrame('{not-json}'), undefined);
});

test('bridge client performs hello, RPC, ping and tool result exchange', async () => {
  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type, listener, options) {
      const entries = this.listeners.get(type) || [];
      entries.push({ listener, once: Boolean(options && options.once) });
      this.listeners.set(type, entries);
    }

    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || [])
        .filter(entry => entry.listener !== listener));
    }

    emit(type, event) {
      const entries = [...(this.listeners.get(type) || [])];
      entries.forEach(entry => {
        if (entry.once) this.removeEventListener(type, entry.listener);
        entry.listener(event || {});
      });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    }

    receive(frame) {
      this.emit('message', { data: JSON.stringify(frame) });
    }

    send(value) {
      this.sent.push(JSON.parse(value));
    }

    close() {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.emit('close', { code: 1000 });
    }
  }

  const states = [];
  let toolCall;
  const client = new HarnessBridgeClient({
    WebSocketImpl: FakeWebSocket,
    reconnect: false,
    onStateChange: state => states.push(state),
    onToolCall: async frame => {
      toolCall = frame;
      return { text: '页面快照' };
    }
  });

  client.start('ws://127.0.0.1:3080/ext/bridge', 'token');
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(socket.sent[0], {
    t: 'hello',
    token: 'token',
    caps: {
      textOnly: true,
      snapshotMaxChars: protocol.DEFAULT_SNAPSHOT_MAX_CHARS,
      maxInteractiveItems: protocol.DEFAULT_MAX_INTERACTIVE_ITEMS
    }
  });

  socket.receive({
    t: 'hello.ok',
    caps: {
      textOnly: true,
      snapshotMaxChars: 32000,
      maxInteractiveItems: 60
    }
  });
  assert.equal(client.connected, true);
  assert.equal(states.includes('connected'), true);

  const rpcResult = client.request('session.history', { sessionId: 'session-1' });
  const rpcFrame = socket.sent.at(-1);
  assert.equal(rpcFrame.t, 'rpc');
  assert.equal(rpcFrame.method, 'session.history');
  socket.receive({ t: 'rpc.result', id: rpcFrame.id, ok: true, result: { events: [] } });
  assert.deepEqual(await rpcResult, { events: [] });

  socket.receive({ t: 'ping' });
  assert.deepEqual(socket.sent.at(-1), { t: 'pong' });

  socket.receive({
    t: 'tool.call',
    id: 'tool-1',
    name: 'browser_snapshot',
    args: {},
    expiresAt: Date.now() + 10_000
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(toolCall.name, 'browser_snapshot');
  assert.deepEqual(socket.sent.at(-1), {
    t: 'tool.result',
    id: 'tool-1',
    ok: true,
    result: { text: '页面快照' }
  });

  client.stop();
  assert.equal(client.state, 'stopped');
});

test('bridge connection probe rejects a socket that never completes hello.ok', async () => {
  class SilentWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = SilentWebSocket.CONNECTING;
      this.listeners = new Map();
      SilentWebSocket.instances.push(this);
    }

    addEventListener(type, listener) {
      const entries = this.listeners.get(type) || [];
      entries.push(listener);
      this.listeners.set(type, entries);
    }

    emit(type, event) {
      (this.listeners.get(type) || []).slice().forEach(listener => listener(event || {}));
    }

    open() {
      this.readyState = SilentWebSocket.OPEN;
      this.emit('open');
    }

    send() {}

    close() {
      this.readyState = SilentWebSocket.CLOSED;
      this.emit('close', { code: 1000, reason: '' });
    }
  }

  const pending = HarnessBridgeClient.probe({
    url: 'ws://127.0.0.1:3080/ext/bridge',
    token: '',
    timeoutMs: 30,
    WebSocketImpl: SilentWebSocket
  });
  SilentWebSocket.instances[0].open();

  await assert.rejects(pending, error => {
    assert.equal(error.code, 'bridge-unavailable');
    assert.match(error.message, /握手|连接/);
    return true;
  });
});

test('settings health check separates the Harness page from the authenticated bridge', () => {
  const config = fs.readFileSync(path.join(ROOT_DIR, 'config.js'), 'utf8');
  const background = fs.readFileSync(path.join(ROOT_DIR, 'background.js'), 'utf8');
  assert.match(config, /command:\s*['"]test['"]/);
  assert.match(config, /Promise\.allSettled/);
  assert.match(config, /DSH 页面正常/);
  assert.match(background, /command === ['"]test['"]/);
  assert.match(background, /DeepSeekHarnessBridgeClient\.probe/);
});

test('settings page explains and highlights a missing DSH browser bridge', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'config.html'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT_DIR, 'config.js'), 'utf8');
  assert.match(html, /先安装 DSH 浏览器 bridge/);
  assert.match(html, /scripts\/install-dsh-bridge\.sh/);
  assert.match(html, /id="harnessInstallAlert"/);
  assert.match(html, /hello\.ok 握手成功/);
  assert.match(config, /infoOk && !bridgeOk/);
  assert.match(config, /bridgeNeedsInstall/);
  assert.match(config, /检查 bridge token 和服务状态/);
  assert.match(config, /showHarnessInstallAlert/);
  assert.match(config, /HARNESS_INSTALL_COMMAND/);
});

test('loads a page bridge instead of input-filling content scripts', () => {
  assert.ok(manifest.permissions.includes('debugger'));
  const scripts = manifest.content_scripts.flatMap(item => item.js || []);
  assert.ok(scripts.includes('page-bridge.js'));
  assert.ok(scripts.includes('frame-route-bridge.js'));
  assert.equal(scripts.includes('ai-input-fill.js'), false);
  assert.equal(scripts.includes('harness-embedded-bridge.js'), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'ai-input-fill.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'harness-embedded-bridge.js')), false);

  const pageBridge = fs.readFileSync(path.join(ROOT_DIR, 'page-bridge.js'), 'utf8');
  assert.match(pageBridge, /__deepseekSidebarPageBridgeInstalled\) return/);
  assert.match(pageBridge, /requestSubmit\(\)/);
  assert.doesNotMatch(pageBridge, /form\.dispatchEvent\(new Event\(['"]submit['"]\)/);

  const routeBridge = fs.readFileSync(path.join(ROOT_DIR, 'frame-route-bridge.js'), 'utf8');
  assert.match(routeBridge, /deepseek-sidebar-frame-route/);
  assert.match(routeBridge, /deepseek-sidebar-frame-route-init/);
  assert.match(routeBridge, /event\.source !== window\.parent/);
  assert.match(routeBridge, /historyApi\.pushState/);
  const routeScript = manifest.content_scripts.find(item => (item.js || []).includes('frame-route-bridge.js'));
  assert.equal(routeScript && routeScript.world, 'MAIN');
});

test('uses the real local Harness page while keeping browser tools outside the input path', () => {
  const sidepanel = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.html'), 'utf8');
  const sidepanelScript = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.js'), 'utf8');
  assert.match(sidepanel, /harness-page-frame/);
  assert.doesNotMatch(sidepanel, /id="harness-panel"/);
  assert.doesNotMatch(sidepanel, /id="harness-task"/);
  assert.doesNotMatch(sidepanel, /harness-client\.js/);
  assert.doesNotMatch(sidepanelScript, /buildBrowserTaskPrompt/);
  assert.doesNotMatch(sidepanelScript, /DeepSeekHarnessClient/);
});

test('routes the side panel state by browser tab like the Codex side panel', () => {
  const sidepanel = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.js'), 'utf8');
  const background = fs.readFileSync(path.join(ROOT_DIR, 'background.js'), 'utf8');
  assert.match(sidepanel, /deepseek-sidebar-tab-states/);
  assert.match(sidepanel, /chrome\.tabs\.onActivated/);
  assert.match(sidepanel, /chrome\.tabs\.onRemoved/);
  assert.match(sidepanel, /chrome\.tabs\.onReplaced/);
  assert.match(sidepanel, /frameGroupForTab/);
  assert.match(fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.html'), 'utf8'), /tab-state\.js/);
  assert.match(background, /chrome\.sidePanel\.open\(target\)/);
  assert.match(background, /\{ windowId: tab\.windowId \}/);
  assert.match(background, /harness-discovery\.js/);
  assert.match(sidepanel, /resolveConfiguredHarnessUrl/);
});

test('opens the real local Harness conversation page and restores its route per tab', () => {
  assert.equal(tabState.DEFAULT_APP, 'harness');
  const state = tabState.normalizeState({
    app: 'harness',
    frameUrls: { harness: 'http://127.0.0.1:3080/conversations/demo' }
  });
  assert.equal(state.frameUrls.harness, 'http://127.0.0.1:3080/conversations/demo');

  const sidepanel = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel.html'), 'utf8');
  assert.match(sidepanel, /frameUrls/);
  assert.match(sidepanel, /frame\.src = frameUrl/);
  assert.match(sidepanel, /deepseek-sidebar-frame-route/);
  assert.match(sidepanel, /FRAME_ROUTE_INIT_SOURCE/);
  assert.doesNotMatch(sidepanel, /runHarnessTask/);
  assert.match(html, /harness-page-frame/);
});

test('exposes the bridge tool surface and token setting', () => {
  assert.deepEqual(protocol.BRIDGE_TOOL_NAMES.slice(0, 11), [
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_press',
    'browser_scroll',
    'browser_navigate',
    'browser_back',
    'browser_forward',
    'browser_reload',
    'browser_get_text',
    'browser_wait'
  ]);
  const config = fs.readFileSync(path.join(ROOT_DIR, 'config.html'), 'utf8');
  assert.match(config, /id="harnessToken"/);
  assert.match(fs.readFileSync(path.join(ROOT_DIR, 'config.js'), 'utf8'), /deepseek-sidebar-harness-token/);
});
