const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../harness-protocol.js');
const HarnessClient = require('../harness-client.js');

test('normalizes Harness URLs without changing the host or port', () => {
  assert.equal(protocol.normalizeHarnessUrl('http://127.0.0.1:3080/'), 'http://127.0.0.1:3080');
  assert.equal(protocol.normalizeHarnessUrl('https://example.test/harness///'), 'https://example.test/harness');
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
