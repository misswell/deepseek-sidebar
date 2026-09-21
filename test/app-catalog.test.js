const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../app-catalog.js');

test('keeps one shared catalog for sidebar, settings and multi AI', () => {
  assert.equal(catalog.byId('chatgpt').url, 'https://chatgpt.com/');
  assert.ok(catalog.multiApps.length >= 2);
  assert.equal(catalog.byId('youdao').multi, false);
});

test('matches AI iframe URLs without accepting lookalike hosts', () => {
  assert.equal(catalog.matchesFrame('qianwen', 'https://qianwen.com/chat/123'), true);
  assert.equal(catalog.matchesFrame('chatgpt', 'https://chatgpt.com/c/123'), true);
  assert.equal(catalog.matchesFrame('chatgpt', 'https://chatgpt.com.evil.example/'), false);
});

test('hides Harness and 有道词典 from the toolbar on a fresh install', () => {
  assert.equal(catalog.visibleByDefault(catalog.byId('harness')), false);
  assert.equal(catalog.visibleByDefault(catalog.byId('youdao')), false);
  const visible = catalog.apps.filter(app => catalog.visibleByDefault(app)).map(app => app.id);
  assert.deepEqual(visible, ['deepseek', 'zhipu', 'qianwen', 'kimi', 'chatgpt', 'gemini']);
  // An app nobody marked hidden is never dropped by accident.
  assert.equal(catalog.visibleByDefault(catalog.byId('nope')), true);
});
