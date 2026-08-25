const PAGE_BRIDGE_FILE = 'page-bridge.js';
const HARNESS_HOST_BRIDGE_FILE = 'harness-host-bridge.js';
const harnessHostTabPromises = new Map();

chrome.action.onClicked.addListener((tab) => {
  if (tab && typeof tab.id === 'number') {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

function sendPageCommand(tabId, message, sendResponse) {
  chrome.scripting.executeScript(
    { target: { tabId }, files: [PAGE_BRIDGE_FILE] },
    () => {
      const injectionError = chrome.runtime.lastError;
      if (injectionError) {
        sendResponse({ ok: false, error: injectionError.message });
        return;
      }
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const messageError = chrome.runtime.lastError;
        if (messageError) {
          sendResponse({ ok: false, error: messageError.message });
          return;
        }
        sendResponse(response || { ok: false, error: '页面没有返回结果' });
      });
    }
  );
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function executeBrowserLevelAction(tabId, action, sendResponse) {
  const type = action && action.type;
  if (type === 'navigate') {
    if (!isHttpUrl(action.url)) {
      sendResponse({ ok: false, error: '只允许导航到 http/https 页面' });
      return;
    }
    chrome.tabs.update(tabId, { url: action.url }, (tab) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : {
        ok: true,
        value: { ok: true, type, url: tab && tab.url ? tab.url : action.url }
      });
    });
    return;
  }
  if (type === 'back' || type === 'forward') {
    const method = type === 'back' ? chrome.tabs.goBack : chrome.tabs.goForward;
    method.call(chrome.tabs, tabId, () => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : {
        ok: true,
        value: { ok: true, type }
      });
    });
    return;
  }
  if (type === 'reload') {
    chrome.tabs.reload(tabId, {}, () => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : {
        ok: true,
        value: { ok: true, type }
      });
    });
    return;
  }
  sendPageCommand(tabId, {
    source: 'deepseek-sidebar-harness-page',
    command: 'execute',
    action
  }, sendResponse);
}

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, tabs => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, tab => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function waitForTabReady(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, tab) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve(tab);
    };
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && changeInfo.status === 'complete') finish(null, tab);
    };
    const timeoutId = setTimeout(() => finish(new Error('Harness 页面加载超时')), 20000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, tab => {
      const error = chrome.runtime.lastError;
      if (error) {
        finish(new Error(error.message));
      } else if (tab && tab.status === 'complete') {
        finish(null, tab);
      }
    });
  });
}

function injectHarnessHostBridge(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: [HARNESS_HOST_BRIDGE_FILE] },
      () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      }
    );
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function ensureHarnessHostTab(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new Error('Harness 地址无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Harness 地址只能使用 http 或 https');
  url.hash = '';
  url.search = '';
  const key = url.origin + url.pathname.replace(/\/+$/, '');
  if (harnessHostTabPromises.has(key)) return await harnessHostTabPromises.get(key);

  const pending = (async () => {
    const pattern = url.origin + '/*';
    const tabs = await queryTabs({ url: [pattern] });
    const requestedPath = url.pathname.replace(/\/+$/, '') || '/';
    let tab = tabs.find(item => {
      if (!item.url) return false;
      try {
        const itemUrl = new URL(item.url);
        return itemUrl.origin === url.origin &&
          (requestedPath === '/' || itemUrl.pathname === requestedPath ||
            itemUrl.pathname.startsWith(requestedPath + '/'));
      } catch (error) {
        return false;
      }
    });
    if (!tab && requestedPath === '/') tab = tabs[0];
    if (!tab) tab = await createTab({ url: url.toString(), active: false });
    if (!tab || typeof tab.id !== 'number') throw new Error('无法创建 Harness 宿主页面');
    await waitForTabReady(tab.id);
    await injectHarnessHostBridge(tab.id);
    return tab.id;
  })();
  harnessHostTabPromises.set(key, pending);
  try {
    return await pending;
  } finally {
    harnessHostTabPromises.delete(key);
  }
}

async function proxyHarnessRpc(message) {
  const base = new URL(message.baseUrl);
  const method = String(message.method || '').replace(/^\/+|\/+$/g, '');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      !method || method.includes('..')) {
    throw new Error('Harness RPC 参数无效');
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const apiPath = basePath + '/api/' + method;
  const tabId = await ensureHarnessHostTab(base.toString());
  let response;
  try {
    response = await sendTabMessage(tabId, {
      source: 'deepseek-sidebar-harness-host-page',
      command: 'rpc',
      apiPath,
      envelope: {
        type: 'client-request',
        rpcId: 'extension-' + Date.now() + '-' + Math.random().toString(16).slice(2),
        method,
        payload: message.payload || {}
      }
    });
  } catch (error) {
    await injectHarnessHostBridge(tabId);
    response = await sendTabMessage(tabId, {
      source: 'deepseek-sidebar-harness-host-page',
      command: 'rpc',
      apiPath,
      envelope: {
        type: 'client-request',
        rpcId: 'extension-retry-' + Date.now(),
        method,
        payload: message.payload || {}
      }
    });
  }
  if (!response || response.ok !== true) {
    throw new Error(response && response.error ? response.error : 'Harness 宿主页面没有返回结果');
  }
  return response.value;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.source === 'deepseek-sidebar-harness-host') {
    if (message.command !== 'rpc') {
      sendResponse({ ok: false, error: '未知 Harness 宿主命令' });
      return false;
    }
    proxyHarnessRpc(message)
      .then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (!message || message.source !== 'deepseek-sidebar-harness') return undefined;
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId) || tabId < 0) {
    sendResponse({ ok: false, error: '当前标签页无效' });
    return false;
  }

  if (message.command === 'snapshot') {
    sendPageCommand(tabId, {
      source: 'deepseek-sidebar-harness-page',
      command: 'snapshot'
    }, sendResponse);
    return true;
  }
  if (message.command === 'execute') {
    executeBrowserLevelAction(tabId, message.action || {}, sendResponse);
    return true;
  }

  sendResponse({ ok: false, error: '未知后台命令' });
  return false;
});
