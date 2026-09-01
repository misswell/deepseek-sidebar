const test = require('node:test');
const assert = require('node:assert/strict');

const context = require('../sidepanel-context.js');

test('creates Codex-style tab-scoped side panel options', () => {
  assert.deepEqual(context.panelOptionsForTab(42), {
    tabId: 42,
    enabled: true,
    path: 'sidepanel.html'
  });
  assert.equal(context.panelOptionsForTab('invalid'), null);
});

test('uses an independent storage key for every browser tab', () => {
  assert.equal(context.stateStorageKey(42), 'deepseek-sidebar-tab-state:42');
  assert.equal(context.tabIdFromStateStorageKey('deepseek-sidebar-tab-state:42'), 42);
  assert.equal(context.tabIdFromStateStorageKey('deepseek-sidebar-tab-states'), null);
});

test('binds each side panel document to its owning Chrome tab', () => {
  const contexts = [
    { documentId: 'panel-a', tabId: 11, windowId: 7 },
    { documentId: 'panel-b', tabId: 22, windowId: 7 }
  ];
  assert.deepEqual(context.contextForDocument(contexts, 'panel-b'), {
    tabId: 22,
    windowId: 7
  });
  assert.equal(context.contextForDocument(contexts, 'missing'), null);
});
