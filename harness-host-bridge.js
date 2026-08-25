(function installHarnessHostBridge() {
  'use strict';

  if (window.__deepseekSidebarHarnessHostBridgeInstalled) return;
  window.__deepseekSidebarHarnessHostBridgeInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'deepseek-sidebar-harness-host-page' || message.command !== 'rpc') {
      return undefined;
    }

    Promise.resolve().then(async () => {
      const apiUrl = new URL(message.apiPath || '', location.origin + '/');
      if (apiUrl.origin !== location.origin || apiUrl.pathname.indexOf('/api/') === -1) {
        throw new Error('Harness 宿主页面拒绝了跨源 API 地址');
      }
      const response = await fetch(apiUrl.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.envelope || {}),
        credentials: 'same-origin'
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch (error) {
        throw new Error('Harness 返回了无法解析的响应');
      }
      if (!response.ok) throw new Error('Harness 请求失败（HTTP ' + response.status + '）');
      return body;
    }).then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    return true;
  });
})();
