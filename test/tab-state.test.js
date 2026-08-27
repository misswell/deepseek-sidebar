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

test('reconciles the active tab when a tab activation event was missed', async () => {
  let currentTabId = 11;
  let activeTab = { id: 11, windowId: 7 };
  let map = state.setTabState({}, 11, { app: 'chatgpt', zoom: 80 });
  map = state.setTabState(map, 22, { app: 'harness', zoom: 140 });
  let displayedState = state.getTabState(map, currentTabId);
  const activated = [];
  const synchronizer = state.createActiveTabSynchronizer({
    getCurrentTabId: () => currentTabId,
    getActiveTab: async () => activeTab,
    onActivate: async tab => {
      activated.push(tab.id);
      currentTabId = tab.id;
      displayedState = state.getTabState(map, currentTabId);
    }
  });

  assert.equal(await synchronizer.reconcile(), false);

  activeTab = { id: 22, windowId: 7 };
  assert.equal(await synchronizer.reconcile(), true);
  assert.deepEqual(activated, [22]);
  assert.deepEqual(displayedState, {
    app: 'harness',
    zoom: 140,
    harnessSessionId: '',
    frameUrls: {}
  });

  assert.equal(await synchronizer.reconcile(), false);
  assert.deepEqual(activated, [22]);
});
