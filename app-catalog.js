(function (root) {
  'use strict';

  const apps = [
    { id: 'harness', name: 'DeepSeek Harness', harness: true, displayUrl: '本地 / 局域网服务', icon: 'icons/icon-deep.png', color: '#8b5cf6', multi: false },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'icons/deepseek.png', color: '#4d6bfe', multi: true },
    { id: 'zhipu', name: '智谱', url: 'https://chat.z.ai/', icon: 'icons/zhipu.svg', color: '#2563eb', multi: true },
    { id: 'qianwen', name: '千问', url: 'https://www.qianwen.com/', icon: 'icons/qianwen.png', color: '#7c3aed', multi: true },
    { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/', icon: 'icons/kimi.svg', color: '#b9c7ff', multi: true },
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'icons/chatgpt.png', color: '#10a37f', multi: true },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', icon: 'icons/gemini.png', color: '#4285f4', multi: true },
    { id: 'youdao', name: '有道词典', url: 'https://dict.youdao.com/m/', icon: 'icons/youdao.svg', color: '#e11d48', multi: false }
  ].map(app => Object.freeze({ ...app }));

  function byId(id) {
    return apps.find(app => app.id === id) || null;
  }

  function matchesFrame(id, value) {
    const app = byId(id);
    if (!app || !app.url || typeof value !== 'string') return false;
    try {
      const expected = new URL(app.url);
      const actual = new URL(value);
      const expectedHost = expected.hostname.replace(/^www\./, '');
      const actualHost = actual.hostname.replace(/^www\./, '');
      return actual.protocol === expected.protocol && actualHost === expectedHost;
    } catch (error) {
      return false;
    }
  }

  const api = {
    apps,
    multiApps: apps.filter(app => app.multi),
    byId,
    matchesFrame
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.DeepSeekSidebarApps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
