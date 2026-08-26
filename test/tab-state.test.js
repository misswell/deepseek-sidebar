const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../tab-state.js');

test('normalizes tab state and rejects invalid tab identifiers', () => {
  assert.equal(state.tabKey(12), '12');
  assert.equal(state.tabKey('12'), '12');
  assert.equal(state.tabKey(null), null);
  assert.equal(state.tabKey(''), null);
  assert.equal(state.tabKey(-1), null);
  assert.equal(state.tabKey('not-a-tab'), null);
  assert.deepEqual(state.normalizeState({ zoom: 999, harnessSessionId: 42 }), {
    app: 'harness',
    zoom: 200,
    harnessSessionId: '',
    frameUrls: {}
  });
});

test('keeps application, zoom and Harness session independent per tab', () => {
  let map = state.setTabState({}, 11, { app: 'chatgpt', zoom: 80, harnessSessionId: 'session-a' });
  map = state.setTabState(map, 22, { app: 'harness', zoom: 140, harnessSessionId: 'session-b' });

  assert.deepEqual(state.getTabState(map, 11), {
    app: 'chatgpt',
    zoom: 80,
    harnessSessionId: 'session-a',
    frameUrls: {}
  });
  assert.deepEqual(state.getTabState(map, 22), {
    app: 'harness',
    zoom: 140,
    harnessSessionId: 'session-b',
    frameUrls: {}
  });
});

test('preserves a separate conversation route for each tab and app', () => {
  let map = state.setFrameUrl({}, 11, 'harness', 'http://127.0.0.1:3080/conversations/a');
  map = state.setFrameUrl(map, 22, 'harness', 'http://127.0.0.1:3080/conversations/b');
  map = state.setFrameUrl(map, 11, 'chatgpt', 'https://chatgpt.com/c/demo');

  assert.equal(state.getFrameUrl(map, 11, 'harness'), 'http://127.0.0.1:3080/conversations/a');
  assert.equal(state.getFrameUrl(map, 22, 'harness'), 'http://127.0.0.1:3080/conversations/b');
  assert.equal(state.getFrameUrl(map, 11, 'chatgpt'), 'https://chatgpt.com/c/demo');
  assert.equal(state.getFrameUrl(map, 22, 'chatgpt'), '');
});

test('removes closed tabs and migrates state when Chrome replaces a tab', () => {
  let map = state.setTabState({}, 11, { app: 'kimi' });
  map = state.replaceTabState(map, 11, 33);
  assert.equal(state.getTabState(map, 11), null);
  assert.deepEqual(state.getTabState(map, 33), {
    app: 'kimi',
    zoom: 100,
    harnessSessionId: '',
    frameUrls: {}
  });

  map = state.removeTabState(map, 33);
  assert.equal(state.getTabState(map, 33), null);
});
