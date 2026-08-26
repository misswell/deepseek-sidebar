importScripts('harness-protocol.js', 'harness-bridge-client.js');

const PAGE_BRIDGE_FILE = 'page-bridge.js';
const HARNESS_HOST_BRIDGE_FILE = 'harness-host-bridge.js';
const HARNESS_BRIDGE_SOURCE = 'deepseek-sidebar-harness-bridge';
const HARNESS_URL_KEY = 'deepseek-sidebar-harness-url';
const HARNESS_TOKEN_KEY = 'deepseek-sidebar-harness-token';
const harnessHostTabPromises = new Map();
const harnessBridgePorts = new Set();
let harnessBridgeClient = null;
let harnessBridgeUrl = '';
let harnessBridgeError = '';
let harnessTargetTabId = null;

function harnessBridgeStatus() {
  return {
    source: HARNESS_BRIDGE_SOURCE,
    type: 'status',
    state: harnessBridgeClient ? harnessBridgeClient.state : 'stopped',
    connected: Boolean(harnessBridgeClient && harnessBridgeClient.connected),
    url: harnessBridgeUrl,
    error: harnessBridgeError,
    caps: harnessBridgeClient ? harnessBridgeClient.caps : null,
    targetTabId: harnessTargetTabId
  };
}

function broadcastHarnessBridgeStatus() {
  const status = harnessBridgeStatus();
  harnessBridgePorts.forEach(port => {
    try { port.postMessage(status); } catch (error) {}
  });
  try {
    chrome.runtime.sendMessage(status, () => { void chrome.runtime.lastError; });
  } catch (error) {}
}

chrome.action.onClicked.addListener((tab) => {
  if (tab && typeof tab.id === 'number') {
    const target = typeof tab.windowId === 'number'
      ? { windowId: tab.windowId }
      : { tabId: tab.id };
    try {
      Promise.resolve(chrome.sidePanel.open(target)).catch(() => {});
    } catch (error) {}
  }
});

function sendPageCommand(tabId, message, sendResponse) {
  chrome.scripting.executeScript(
    { target: { tabId, frameIds: [0] }, files: [PAGE_BRIDGE_FILE] },
    () => {
      const injectionError = chrome.runtime.lastError;
      if (injectionError) {
        sendResponse({ ok: false, error: injectionError.message });
        return;
      }
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
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

function sendPageCommandAsync(tabId, message) {
  return new Promise((resolve, reject) => {
    sendPageCommand(tabId, message, response => {
      if (!response || response.ok !== true) {
        reject(new Error(response && response.error ? response.error : '页面没有返回结果'));
        return;
      }
      resolve(response.value);
    });
  });
}

function makeHarnessBridgeError(code, message) {
  const ErrorType = DeepSeekHarnessBridgeClient && DeepSeekHarnessBridgeClient.Error;
  const error = ErrorType ? new ErrorType(code, message) : new Error(message);
  error.code = code;
  return error;
}

function fetchBridgeConfig(baseUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  return fetch(DeepSeekHarnessProtocol.harnessBridgeConfigUrl(baseUrl), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: controller.signal
  }).then(async response => {
    if (!response.ok) return null;
    let body;
    try { body = await response.json(); } catch (error) { return null; }
    return body && typeof body.wsUrl === 'string' ? body.wsUrl : null;
  }).catch(() => null).finally(() => clearTimeout(timeoutId));
}

async function resolveHarnessBridgeUrl(baseUrl) {
  const normalized = DeepSeekHarnessProtocol.normalizeHarnessUrl(baseUrl);
  const discovered = await fetchBridgeConfig(normalized);
  const candidate = discovered || DeepSeekHarnessProtocol.harnessBridgeWebSocketUrl(normalized);
  let url;
  try { url = new URL(candidate); } catch (error) {
    throw new Error('Harness bridge 地址无效');
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('Harness bridge 只支持 ws 或 wss 地址');
  }
  url.hash = '';
  return { url: url.toString().replace(/\/$/, ''), discovered: Boolean(discovered) };
}

function createHarnessBridgeClient() {
  if (harnessBridgeClient) return harnessBridgeClient;
  harnessBridgeClient = new DeepSeekHarnessBridgeClient({
    onStateChange: state => {
      if (state === 'connected') harnessBridgeError = '';
      else if (harnessBridgeClient && harnessBridgeClient.lastError) {
        harnessBridgeError = harnessBridgeClient.lastError;
      }
      broadcastHarnessBridgeStatus();
    },
    onHelloOk: caps => {
      harnessBridgeError = '';
      broadcastHarnessBridgeStatus();
      void caps;
    },
    onFrame: frame => {
      if (frame && frame.t === 'error') harnessBridgeError = frame.message;
      const status = harnessBridgeStatus();
      status.frame = frame;
      harnessBridgePorts.forEach(port => {
        try { port.postMessage(status); } catch (error) {}
      });
    },
    onToolCall: (frame, signal) => handleHarnessToolCall(frame, signal)
  });
  return harnessBridgeClient;
}

async function startHarnessBridge(baseUrl, token) {
  const resolved = await resolveHarnessBridgeUrl(baseUrl);
  // Starting a new bridge lease must not inherit a page from an older task.
  unbindHarnessTarget();
  const client = createHarnessBridgeClient();
  harnessBridgeUrl = resolved.url;
  harnessBridgeError = resolved.discovered ? '' : '未发现 /ext/bridge-config，正在尝试标准 bridge 地址';
  client.start(resolved.url, token || '');
  return harnessBridgeStatus();
}

function stopHarnessBridge() {
  harnessBridgeUrl = '';
  harnessBridgeError = '';
  unbindHarnessTarget();
  if (harnessBridgeClient) harnessBridgeClient.stop();
  broadcastHarnessBridgeStatus();
}

function nativeContentBudget() {
  const caps = harnessBridgeClient && harnessBridgeClient.caps;
  return {
    maxChars: caps && Number.isInteger(caps.snapshotMaxChars)
      ? caps.snapshotMaxChars : DeepSeekHarnessProtocol.DEFAULT_SNAPSHOT_MAX_CHARS,
    maxItems: caps && Number.isInteger(caps.maxInteractiveItems)
      ? caps.maxInteractiveItems : DeepSeekHarnessProtocol.DEFAULT_MAX_INTERACTIVE_ITEMS,
    maxForms: 30
  };
}

function sendNativePageAction(tabId, frameId, action, signal, budgetOverride, documentId) {
  const targetFrameId = Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
  const budget = budgetOverride || nativeContentBudget();
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeAbort = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (removeAbort) removeAbort();
      callback(value);
    };
    const onAbort = () => finish(reject, makeHarnessBridgeError('bridge-closed', '浏览器工具已取消'));
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', onAbort);
    }

    chrome.scripting.executeScript(
      { target: { tabId, frameIds: [targetFrameId] }, files: [PAGE_BRIDGE_FILE] },
      () => {
        const injectionError = chrome.runtime.lastError;
        if (injectionError) {
          finish(reject, makeHarnessBridgeError('content-unavailable', injectionError.message));
          return;
        }
        if (signal && signal.aborted) return;
        const messageTarget = typeof documentId === 'string' && documentId
          ? { documentId } : { frameId: targetFrameId };
        chrome.tabs.sendMessage(tabId, {
          type: 'DSH_ACTION',
          action: action && action.name ? action.name : action,
          args: action && action.args ? action.args : {},
          budget
        }, messageTarget, response => {
          const messageError = chrome.runtime.lastError;
          if (messageError) {
            finish(reject, makeHarnessBridgeError('content-unavailable', messageError.message));
            return;
          }
          if (!response || response.ok !== true) {
            finish(reject, makeHarnessBridgeError(
              response && response.error && response.error.code ? response.error.code : 'action-failed',
              response && response.error && response.error.message ? response.error.message : '页面没有返回结果'
            ));
            return;
          }
          finish(resolve, response.result || { text: '' });
        });
      }
    );
  });
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, tab => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab || null);
    });
  });
}

function fallbackTabFrame(tabId, tabUrl) {
  return { tabId, frameId: 0, parentFrameId: -1, url: tabUrl || '' };
}

function sortTabFrames(frames) {
  const parents = new Map(frames.map(frame => [frame.frameId, frame.parentFrameId]));
  const depths = new Map();
  const depthOf = frameId => {
    if (depths.has(frameId)) return depths.get(frameId);
    const visited = new Set();
    let depth = 0;
    let parent = parents.has(frameId) ? parents.get(frameId) : -1;
    while (parent !== -1 && !visited.has(parent)) {
      visited.add(parent);
      depth += 1;
      parent = parents.has(parent) ? parents.get(parent) : -1;
    }
    depths.set(frameId, depth);
    return depth;
  };
  return [...frames].sort((a, b) => depthOf(a.frameId) - depthOf(b.frameId) || a.frameId - b.frameId);
}

function listTabFrames(tabId, tabUrl) {
  const fallback = [fallbackTabFrame(tabId, tabUrl)];
  if (!chrome.webNavigation || typeof chrome.webNavigation.getAllFrames !== 'function') {
    return Promise.resolve(fallback);
  }
  return new Promise(resolve => {
    try {
      chrome.webNavigation.getAllFrames({ tabId }, frames => {
        const error = chrome.runtime.lastError;
        if (error || !Array.isArray(frames) || !frames.length) {
          resolve(fallback);
          return;
        }
        const normalized = frames
          .filter(frame => frame && Number.isInteger(frame.frameId) && frame.frameId >= 0)
          .map(frame => ({
            tabId,
            frameId: frame.frameId,
            parentFrameId: Number.isInteger(frame.parentFrameId) ? frame.parentFrameId : -1,
            documentId: typeof frame.documentId === 'string' ? frame.documentId : undefined,
            url: typeof frame.url === 'string' ? frame.url : ''
          }));
        const hasMain = normalized.some(frame => frame.frameId === 0);
        resolve(sortTabFrames(hasMain ? normalized : fallback.concat(normalized)));
      });
    } catch (error) {
      resolve(fallback);
    }
  });
}

function frameOrigin(frame) {
  try { return new URL(frame.url || '').origin; } catch (error) { return frame.url || '(unknown)'; }
}

function frameHeader(frame) {
  return '\n--- iframe frame=' + frame.frameId + ' parent=' + frame.parentFrameId +
    ' origin=' + frameOrigin(frame) + ' ---';
}

function clipNativeSnapshotText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.78);
  return text.slice(0, head) + '\n…（页面内容已截断）…\n' + text.slice(-Math.floor(maxLength * 0.22));
}

function allocateNativeFrameBudgets(frames, total) {
  if (frames.length <= 1) return new Map([[frames[0] && frames[0].frameId || 0, total]]);
  const main = frames.find(frame => frame.frameId === 0) || frames[0];
  const children = frames.filter(frame => frame !== main);
  const mainChars = Math.max(500, Math.floor(total.maxChars * 0.8));
  const mainItems = Math.max(1, Math.floor(total.maxItems * 0.8));
  const remainingChars = Math.max(0, total.maxChars - mainChars);
  const remainingItems = Math.max(0, total.maxItems - mainItems);
  const childChars = Math.max(500, Math.floor(remainingChars / Math.max(1, children.length)));
  const childItems = Math.max(1, Math.floor(remainingItems / Math.max(1, children.length)));
  return new Map([
    [main.frameId, { maxChars: mainChars, maxItems: mainItems, maxForms: total.maxForms }],
    ...children.map(frame => [frame.frameId, {
      maxChars: childChars,
      maxItems: childItems,
      maxForms: total.maxForms
    }])
  ]);
}

async function sendNativeSnapshot(tab, action, signal) {
  const frames = await listTabFrames(tab.id, tab.url);
  const totalBudget = nativeContentBudget();
  const budgets = allocateNativeFrameBudgets(frames, totalBudget);
  const settled = await Promise.allSettled(frames.map(frame => sendNativePageAction(
    tab.id,
    frame.frameId,
    { name: 'browser_snapshot', args: action && action.args ? action.args : {} },
    signal,
    budgets.get(frame.frameId) || totalBudget,
    frame.documentId
  )));
  if (signal && signal.aborted) throw makeHarnessBridgeError('bridge-closed', '浏览器工具已取消');

  const sections = [];
  settled.forEach((outcome, index) => {
    const frame = frames[index];
    if (outcome.status === 'fulfilled') {
      const result = outcome.value || {};
      if (frame.frameId === 0) sections.push(result.text || '');
      else sections.push(frameHeader(frame), result.text || '(iframe 没有可读取内容)');
      return;
    }
    if (frame.frameId === 0) throw outcome.reason;
    const message = outcome.reason && outcome.reason.message
      ? outcome.reason.message : 'iframe 不可读取';
    sections.push(frameHeader(frame), '(' + message + ')');
  });
  return { text: clipNativeSnapshotText(sections.filter(Boolean).join('\n'), totalBudget.maxChars) };
}

function debuggerAttach(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, '1.3', () => {
      const error = chrome.runtime.lastError;
      if (error) reject(makeHarnessBridgeError('action-failed', error.message));
      else resolve();
    });
  });
}

function debuggerSendCommand(debuggee, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params || {}, result => {
      const error = chrome.runtime.lastError;
      if (error) reject(makeHarnessBridgeError('action-failed', error.message));
      else resolve(result || {});
    });
  });
}

function debuggerDetach(debuggee) {
  return new Promise(resolve => {
    try {
      chrome.debugger.detach(debuggee, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (error) {
      resolve();
    }
  });
}

async function executeHarnessCdp(args, signal) {
  const method = args && (args.method || args.command);
  if (typeof method !== 'string' || !method.trim()) {
    throw makeHarnessBridgeError('bad-args', 'DevTools 调用缺少 method');
  }
  if (signal && signal.aborted) throw makeHarnessBridgeError('bridge-closed', 'DevTools 调用已取消');
  const tab = await getControlledWebTab();
  if (!tab || typeof tab.id !== 'number' || !isHttpUrl(tab.url)) {
    throw makeHarnessBridgeError('no-active-tab', '当前标签页不支持 DevTools 操作');
  }
  const debuggee = { tabId: tab.id };
  await debuggerAttach(debuggee);
  try {
    if (signal && signal.aborted) throw makeHarnessBridgeError('bridge-closed', 'DevTools 调用已取消');
    const result = await debuggerSendCommand(debuggee, method.trim(),
      args.params && typeof args.params === 'object' ? args.params : {});
    return { text: JSON.stringify({ method: method.trim(), result }, null, 2) };
  } finally {
    await debuggerDetach(debuggee);
  }
}

async function handleHarnessToolCall(frame, signal) {
  const name = frame && frame.name;
  if (name === 'browser_cdp' || name === 'tab_cdp_call' || name === 'browser_devtools') {
    return await executeHarnessCdp(frame.args || {}, signal);
  }
  if (!DeepSeekHarnessProtocol.BRIDGE_TOOL_NAMES.includes(name)) {
    throw makeHarnessBridgeError('bad-args', '不支持的浏览器工具：' + String(name || ''));
  }
  const tab = await getControlledWebTab();
  if (!tab || typeof tab.id !== 'number' || !isHttpUrl(tab.url)) {
    throw makeHarnessBridgeError('no-active-tab', '当前标签页不支持网页操作');
  }
  const args = frame.args && typeof frame.args === 'object' ? frame.args : {};
  if (name === 'browser_snapshot') return await sendNativeSnapshot(tab, { name, args }, signal);
  const frameId = Number.isInteger(args.frame) && args.frame >= 0 ? args.frame : 0;
  const frames = await listTabFrames(tab.id, tab.url);
  if (!frames.some(item => item.frameId === frameId)) {
    throw makeHarnessBridgeError('content-unavailable',
      'frame ' + frameId + ' 不存在或已导航，请先重新读取 browser_snapshot');
  }
  const targetFrame = frames.find(item => item.frameId === frameId);
  return await sendNativePageAction(tab.id, frameId, { name, args }, signal, undefined,
    targetFrame && targetFrame.documentId);
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

async function getControlledWebTab() {
  if (!Number.isInteger(harnessTargetTabId)) {
    throw makeHarnessBridgeError('no-active-tab', '当前没有绑定的受控标签页，请从侧边栏重新启动任务');
  }
  let tab;
  try {
    tab = await getTab(harnessTargetTabId);
  } catch (error) {
    harnessTargetTabId = null;
    broadcastHarnessBridgeStatus();
    throw makeHarnessBridgeError('no-active-tab', '受控标签页已关闭，请重新启动任务');
  }
  if (!tab || typeof tab.id !== 'number' || !isHttpUrl(tab.url)) {
    throw makeHarnessBridgeError('no-active-tab', '受控标签页已不再是普通网页，请重新读取页面');
  }
  return tab;
}

async function bindHarnessTarget(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error('受控标签页无效');
  }
  const tab = await getTab(id);
  if (!tab || typeof tab.id !== 'number' || !isHttpUrl(tab.url)) {
    throw new Error('只能绑定普通 http/https 网页');
  }
  harnessTargetTabId = id;
  broadcastHarnessBridgeStatus();
  return { tabId: id, url: tab.url || '', title: tab.title || '' };
}

function unbindHarnessTarget() {
  harnessTargetTabId = null;
  broadcastHarnessBridgeStatus();
  return { tabId: null };
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

async function proxyHarnessProbe(message) {
  let base;
  try {
    base = new URL(message.baseUrl);
  } catch (error) {
    throw new Error('Harness 地址无效');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Harness 地址只能使用 http 或 https');
  }
  const tabId = await ensureHarnessHostTab(base.toString());
  const response = await sendTabMessage(tabId, {
    source: 'deepseek-sidebar-harness-host-page',
    command: 'probe'
  });
  if (!response || response.ok !== true) {
    throw new Error(response && response.error ? response.error : 'Harness 宿主页面没有返回结果');
  }
  return response.value;
}

function handleHarnessBridgeCommand(message, sendResponse) {
  if (!message || message.source !== HARNESS_BRIDGE_SOURCE) return false;
  const command = message.command;
  if (command === 'status') {
    sendResponse({ ok: true, value: harnessBridgeStatus() });
    return false;
  }
  if (command === 'resolve') {
    Promise.resolve()
      .then(() => resolveHarnessBridgeUrl(message.baseUrl))
      .then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (command === 'start') {
    Promise.resolve().then(async () => {
      let baseUrl = message.baseUrl;
      let token = message.token;
      if (!baseUrl || !token) {
        const stored = await new Promise(resolve => {
          chrome.storage.local.get([HARNESS_URL_KEY, HARNESS_TOKEN_KEY], resolve);
        });
        if (!baseUrl) baseUrl = stored[HARNESS_URL_KEY];
        if (!token) token = stored[HARNESS_TOKEN_KEY] || '';
      }
      return await startHarnessBridge(baseUrl, token);
    }).then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (command === 'stop') {
    stopHarnessBridge();
    sendResponse({ ok: true, value: harnessBridgeStatus() });
    return false;
  }
  if (command === 'bind') {
    Promise.resolve()
      .then(() => bindHarnessTarget(message.tabId))
      .then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (command === 'unbind') {
    sendResponse({ ok: true, value: unbindHarnessTarget() });
    return false;
  }
  if (command === 'rpc') {
    const client = harnessBridgeClient;
    if (!client || !client.connected) {
      sendResponse({ ok: false, error: '没有连接到 Harness 浏览器 bridge' });
      return false;
    }
    client.request(message.method, message.payload || {}, {
      timeoutMs: Number.isFinite(message.timeoutMs) ? message.timeoutMs : undefined
    }).then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
    return true;
  }
  sendResponse({ ok: false, error: '未知 Harness bridge 命令' });
  return false;
}

chrome.runtime.onConnect.addListener(port => {
  if (!port || port.name !== HARNESS_BRIDGE_SOURCE) return;
  harnessBridgePorts.add(port);
  try { port.postMessage(harnessBridgeStatus()); } catch (error) {}
  port.onMessage.addListener(message => {
    const requestId = message && message.requestId;
    handleHarnessBridgeCommand(message, response => {
      try {
        port.postMessage({
          source: HARNESS_BRIDGE_SOURCE,
          type: 'response',
          requestId,
          ...response
        });
      } catch (error) {}
    });
  });
  port.onDisconnect.addListener(() => {
    harnessBridgePorts.delete(port);
    // A task is owned by the visible side panel. If the panel disappears,
    // fail closed instead of allowing a still-running Harness session to keep
    // controlling the last page indefinitely.
    if (harnessBridgePorts.size === 0 && harnessTargetTabId !== null) {
      unbindHarnessTarget();
    }
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (harnessTargetTabId !== tabId) return;
  unbindHarnessTarget();
  harnessBridgeError = '受控标签页已关闭';
  broadcastHarnessBridgeStatus();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.source === HARNESS_BRIDGE_SOURCE) {
    return handleHarnessBridgeCommand(message, sendResponse);
  }
  if (message && message.source === 'deepseek-sidebar-harness-host') {
    if (!['rpc', 'probe'].includes(message.command)) {
      sendResponse({ ok: false, error: '未知 Harness 宿主命令' });
      return false;
    }
    if (message.command === 'probe') {
      proxyHarnessProbe(message)
        .then(value => sendResponse({ ok: true, value }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
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
