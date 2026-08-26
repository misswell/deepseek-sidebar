const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../harness-protocol.js');
const discovery = require('../harness-discovery.js');

function fakeResponse(overrides) {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => '',
    ...(overrides || {})
  };
}

test('discovers a running DSH instance when default port 3080 is unavailable', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url === 'http://127.0.0.1:3081/ext/bridge-config') {
      return fakeResponse({
        ok: true,
        status: 200,
        json: async () => ({ wsUrl: 'ws://127.0.0.1:3081/ext/bridge' })
      });
    }
    if (url === 'http://127.0.0.1:3081') {
      return fakeResponse({
        ok: true,
        status: 200,
        text: async () => '<title>DeepSeek Harness</title><div id="root"></div>'
      });
    }
    return fakeResponse();
  };

  const result = await discovery.discover(protocol.DEFAULT_HARNESS_URL, {
    fetchImpl,
    timeoutMs: 50
  });

  assert.equal(result.baseUrl, 'http://127.0.0.1:3081');
  assert.equal(result.bridgeUrl, 'ws://127.0.0.1:3081/ext/bridge');
  assert.equal(result.pageDetected, true);
  assert.equal(result.detected, true);
  assert.equal(result.candidates.length, 20);
  assert.ok(calls.includes('http://127.0.0.1:3080'));
  assert.ok(calls.includes('http://127.0.0.1:3080/ext/bridge-config'));
});

test('falls back to a DSH page when its browser bridge is not installed', async () => {
  const fetchImpl = async url => {
    if (url === 'http://127.0.0.1:3082') {
      return fakeResponse({ ok: true, status: 200, text: async () => '<title>DeepSeek Harness</title>' });
    }
    return fakeResponse();
  };

  const result = await discovery.discover(protocol.DEFAULT_HARNESS_URL, {
    fetchImpl,
    timeoutMs: 50
  });

  assert.equal(result.baseUrl, 'http://127.0.0.1:3082');
  assert.equal(result.bridgeUrl, null);
  assert.equal(result.pageDetected, true);
  assert.equal(result.detected, true);
});

test('does not scan other ports for an explicitly configured Harness address', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return fakeResponse({ ok: true, status: 200, text: async () => '<title>DeepSeek Harness</title>' });
  };

  const result = await discovery.discover('http://127.0.0.1:4000', {
    fetchImpl,
    timeoutMs: 50
  });

  assert.deepEqual(result.candidates, ['http://127.0.0.1:4000']);
  assert.equal(result.baseUrl, 'http://127.0.0.1:4000');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.includes(':4000')));
});
