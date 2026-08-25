const webviewContainer = document.getElementById('webview-container');
const loading = document.getElementById('loading');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const reloadBtn = document.getElementById('refresh');
const zoomLabel = document.getElementById('zoom-label');
const pickElementBtn = document.getElementById('pick-element');
const pageReader = document.getElementById('page-reader');
const pageReaderTitle = document.getElementById('page-reader-title');
const pageReaderMeta = document.getElementById('page-reader-meta');
const pageReaderContent = document.getElementById('page-reader-content');
const pageReaderStatus = document.getElementById('page-reader-status');
const togglePageReaderBtn = document.getElementById('toggle-page-reader');
const copyPageContentBtn = document.getElementById('copy-page-content');
const closePageReaderBtn = document.getElementById('close-page-reader');
const harnessPanel = document.getElementById('harness-panel');
const harnessState = document.getElementById('harness-state');
const harnessStateLabel = document.getElementById('harness-state-label');
const harnessEndpoint = document.getElementById('harness-endpoint');
const harnessOpenBtn = document.getElementById('harness-open');
const harnessRefreshSnapshotBtn = document.getElementById('harness-refresh-snapshot');
const harnessPageTitle = document.getElementById('harness-page-title');
const harnessPageUrl = document.getElementById('harness-page-url');
const harnessSnapshotMeta = document.getElementById('harness-snapshot-meta');
const harnessTask = document.getElementById('harness-task');
const harnessAutoRun = document.getElementById('harness-auto-run');
const harnessRunBtn = document.getElementById('harness-run');
const harnessStatus = document.getElementById('harness-status');
const harnessLogList = document.getElementById('harness-log-list');

const ZOOM_KEY = 'deepseek-sidebar-zoom';
const APP_KEY = 'deepseek-sidebar-app';
const VISIBILITY_KEY = 'deepseek-sidebar-visibility';
const ORDER_KEY = 'deepseek-sidebar-order';
const HARNESS_URL_KEY = 'deepseek-sidebar-harness-url';
const HARNESS_SESSION_KEY = 'deepseek-sidebar-harness-session';
const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
const IFRAME_ALLOW = [
  'clipboard-read',
  'clipboard-write',
  'autoplay',
  'accelerometer',
  'gyroscope',
  'magnetometer'
].join('; ');

const APPS = {
  harness: { harness: true },
  deepseek: { url: 'https://chat.deepseek.com/' },
  zhipu: { url: 'https://chat.z.ai/' },
  qianwen: { url: 'https://www.qianwen.com/' },
  kimi: { url: 'https://www.kimi.com/' },
  chatgpt: { url: 'https://chatgpt.com/' },
  gemini: { url: 'https://gemini.google.com/app' },
  youdao: { url: 'https://dict.youdao.com/m/' }
};

// App metadata for dynamic button rendering — order matters
const APP_META = [
  { id: 'harness', name: 'DeepSeek Harness', icon: 'icons/icon-deep.png' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'icons/deepseek.png' },
  { id: 'zhipu', name: '智谱', icon: 'icons/zhipu.svg' },
  { id: 'qianwen', name: '千问', icon: 'icons/qianwen.png' },
  { id: 'kimi', name: 'Kimi', icon: 'icons/kimi.svg' },
  { id: 'chatgpt', name: 'ChatGPT', icon: 'icons/chatgpt.png' },
  { id: 'gemini', name: 'Gemini', icon: 'icons/gemini.png' },
  { id: 'youdao', name: '有道词典', icon: 'icons/youdao.svg' }
];

let currentZoom = 100;
let currentApp = null;
let currentPageText = '';
let currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
let currentHarnessSessionId = '';
let currentHarnessSnapshot = null;
let harnessRunning = false;
let harnessAbortController = null;
let lastFillRequestId = 0;
let pickingTabId = null;
let pickCancelled = false;
let pickWaitResolver = null;
let pickPendingNavigation = false;
const appSwitcher = document.getElementById('appSwitcher');
const configBtn = document.getElementById('config-btn');
let appButtons = [];  // populated dynamically by renderAppButtons()
let appVisibility = {};  // { appId: true/false }
let appOrder = [];  // ordered array of app ids
const frames = new Map();
const loadedApps = new Set();

function renderAppButtons() {
  appSwitcher.innerHTML = '';
  appButtons = [];
  // Build ordered list: use appOrder, append any new apps not in saved order
  let orderedMeta = [];
  if (appOrder.length > 0) {
    appOrder.forEach(id => {
      const meta = APP_META.find(a => a.id === id);
      if (meta) orderedMeta.push(meta);
    });
    APP_META.forEach(app => {
      if (!appOrder.includes(app.id)) orderedMeta.push(app);
    });
  } else {
    orderedMeta = [...APP_META];
  }
  orderedMeta.forEach(app => {
    if (appVisibility[app.id] === false) return;  // hidden apps
    const btn = document.createElement('button');
    btn.className = 'app-btn';
    btn.dataset.app = app.id;
    btn.title = app.name;
    const img = document.createElement('img');
    img.src = app.icon;
    img.alt = app.name;
    btn.appendChild(img);
    btn.addEventListener('click', () => switchApp(app.id));
    appSwitcher.appendChild(btn);
    appButtons.push(btn);
  });
  // Re-apply active state
  if (currentApp) {
    appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === currentApp));
  }
}

function loadAppVisibility() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([VISIBILITY_KEY, ORDER_KEY], (result) => {
        const saved = result[VISIBILITY_KEY];
        if (saved && typeof saved === 'object') {
          appVisibility = saved;
        } else {
          APP_META.forEach(app => { appVisibility[app.id] = true; });
        }
        APP_META.forEach(app => {
          if (typeof appVisibility[app.id] !== 'boolean') appVisibility[app.id] = true;
        });
        const savedOrder = result[ORDER_KEY];
        if (Array.isArray(savedOrder)) {
          appOrder = savedOrder.filter(id => APP_META.some(a => a.id === id));
          APP_META.forEach(app => {
            if (!appOrder.includes(app.id)) appOrder.push(app.id);
          });
        } else {
          appOrder = APP_META.map(a => a.id);
        }
        resolve();
      });
    } catch (e) {
      APP_META.forEach(app => { appVisibility[app.id] = true; });
      appOrder = APP_META.map(a => a.id);
      resolve();
    }
  });
}

// Listen for visibility/order changes from config page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[VISIBILITY_KEY]) {
    appVisibility = changes[VISIBILITY_KEY].newValue || {};
    renderAppButtons();
  }
  if (changes[ORDER_KEY]) {
    const savedOrder = changes[ORDER_KEY].newValue;
    if (Array.isArray(savedOrder)) {
      appOrder = savedOrder.filter(id => APP_META.some(a => a.id === id));
      APP_META.forEach(app => {
        if (!appOrder.includes(app.id)) appOrder.push(app.id);
      });
    }
    renderAppButtons();
  }
  if (changes[HARNESS_URL_KEY]) {
    try {
      currentHarnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(changes[HARNESS_URL_KEY].newValue);
    } catch (e) {
      currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
    }
    updateHarnessEndpoint();
    if (currentApp === 'harness') refreshHarnessConnection(true);
  }
  if (changes[HARNESS_SESSION_KEY]) {
    currentHarnessSessionId = changes[HARNESS_SESSION_KEY].newValue || '';
  }
});

function applyZoomToFrame(frame) {
  const scale = currentZoom / 100;
  frame.style.transform = 'scale(' + scale + ')';
  frame.style.width = (100 / scale) + '%';
  frame.style.height = (100 / scale) + '%';
}

function hideLoadingIfStillWaiting(appId) {
  setTimeout(() => {
    if (currentApp === appId && !loadedApps.has(appId)) {
      loading.classList.add('hidden');
    }
  }, 8000);
}

function setupFrameLoadState(frame, appId) {
  frame.addEventListener('load', () => {
    loadedApps.add(appId);
    if (currentApp === appId) loading.classList.add('hidden');
  });
}

function getOrCreateFrame(appId) {
  if (appId === 'harness') return null;
  const existingFrame = frames.get(appId);
  if (existingFrame) return existingFrame;

  const app = APPS[appId];
  const frame = document.createElement('iframe');
  frame.className = 'webview-frame hidden';
  frame.dataset.app = appId;
  frame.setAttribute('allow', IFRAME_ALLOW);
  frame.removeAttribute('sandbox');
  setupFrameLoadState(frame, appId);
  applyZoomToFrame(frame);
  webviewContainer.appendChild(frame);
  frames.set(appId, frame);
  frame.src = app.url;
  hideLoadingIfStillWaiting(appId);
  return frame;
}

function switchApp(appId) {
  const app = APPS[appId];
  if (!app) return;
  currentApp = appId;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === appId));
  if (appId === 'harness') {
    frames.forEach(item => item.classList.add('hidden'));
    harnessPanel.classList.remove('hidden');
    loading.classList.add('hidden');
    updateHarnessEndpoint();
    refreshHarnessPanel(true);
    try { chrome.storage.local.set({ [APP_KEY]: appId }); } catch (e) {}
    return;
  }
  harnessPanel.classList.add('hidden');
  getOrCreateFrame(appId);
  frames.forEach((item, id) => item.classList.toggle('hidden', id !== appId));
  if (loadedApps.has(appId)) loading.classList.add('hidden');
  else {
    loading.classList.remove('hidden');
    hideLoadingIfStillWaiting(appId);
  }
  applyZoom(currentZoom);
  try { chrome.storage.local.set({ [APP_KEY]: appId }); } catch (e) {}
}

function applyZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  frames.forEach(applyZoomToFrame);
  zoomLabel.textContent = currentZoom + '%';
  try { chrome.storage.local.set({ [ZOOM_KEY]: currentZoom }); } catch (e) {}
}

function updateHarnessEndpoint() {
  harnessEndpoint.textContent = currentHarnessUrl;
}

function setHarnessConnectionState(state, label) {
  harnessState.classList.remove('connected', 'error');
  if (state === 'connected' || state === 'error') harnessState.classList.add(state);
  harnessStateLabel.textContent = label;
}

function setHarnessStatus(message, kind) {
  harnessStatus.textContent = message || '';
  harnessStatus.classList.remove('error', 'success');
  if (kind) harnessStatus.classList.add(kind);
}

function appendHarnessLog(message, kind) {
  if (!message) return;
  if (harnessLogList.children.length === 1 &&
      harnessLogList.firstElementChild.textContent.startsWith('输入任务后')) {
    harnessLogList.innerHTML = '';
  }
  const item = document.createElement('div');
  item.className = 'harness-log-item' + (kind ? ' ' + kind : '');
  item.textContent = message;
  harnessLogList.appendChild(item);
  while (harnessLogList.children.length > 24) harnessLogList.firstElementChild.remove();
  item.scrollIntoView({ block: 'nearest' });
}

function permissionContains(origins) {
  return new Promise(resolve => {
    try {
      chrome.permissions.contains({ origins }, granted => {
        void chrome.runtime.lastError;
        resolve(Boolean(granted));
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function requestOriginPermission(origin) {
  return new Promise(resolve => {
    try {
      chrome.permissions.request({ origins: [origin] }, granted => {
        void chrome.runtime.lastError;
        resolve(Boolean(granted));
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function unsupportedAutomationUrl(url) {
  return !url || /^(chrome|chrome-extension|edge|about|view-source):/i.test(url) ||
    /^https?:\/\/chrome\.google\.com\/webstore/i.test(url);
}

async function ensureAutomationPermission(tab) {
  if (!tab || unsupportedAutomationUrl(tab.url)) return false;
  let origin;
  try {
    const url = new URL(tab.url);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return false;
    if (url.protocol === 'file:') origin = 'file:///*';
    else origin = url.origin + '/*';
  } catch (error) {
    return false;
  }
  if (await permissionContains([origin])) return true;
  return await requestOriginPermission(origin);
}

function sendHarnessPageCommand(tabId, command, action) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      source: 'deepseek-sidebar-harness',
      tabId,
      command,
      action
    }, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response || response.ok !== true) {
        reject(new Error(response && response.error ? response.error : '浏览器没有返回结果'));
        return;
      }
      resolve(response.value);
    });
  });
}

function createHarnessClient(options) {
  return new DeepSeekHarnessClient(currentHarnessUrl, {
    ...(options || {}),
    transport: DeepSeekHarnessTransport.request
  });
}

async function ensureHarnessServerPermission() {
  const origin = DeepSeekHarnessProtocol.harnessOriginPattern(currentHarnessUrl);
  if (await permissionContains([origin])) return true;
  return await requestOriginPermission(origin);
}

function updateHarnessSnapshotCard(snapshot) {
  currentHarnessSnapshot = snapshot;
  harnessPageTitle.textContent = snapshot && snapshot.title ? snapshot.title : '未命名页面';
  harnessPageUrl.textContent = snapshot && snapshot.url ? snapshot.url : '';
  const interactiveCount = snapshot && Array.isArray(snapshot.interactive) ? snapshot.interactive.length : 0;
  const textLength = snapshot && snapshot.text ? snapshot.text.length : 0;
  harnessSnapshotMeta.textContent = snapshot
    ? interactiveCount + ' 个可交互元素 · ' + textLength + ' 字符可见内容'
    : '';
}

async function getHarnessPageSnapshot(tabId, signal) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal && signal.aborted) throw new Error('任务已停止');
    try {
      return await sendHarnessPageCommand(tabId, 'snapshot');
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 650));
    }
  }
  throw lastError || new Error('无法读取当前页面');
}

async function refreshHarnessConnection(silent) {
  try {
    const client = createHarnessClient({ timeoutMs: 6000 });
    const info = await client.describe();
    const model = info && (info.model || info.provider);
    setHarnessConnectionState('connected', model ? '已连接 · ' + model : '已连接');
    if (!silent) setHarnessStatus('本地 Harness 已连接。', 'success');
    return info;
  } catch (error) {
    setHarnessConnectionState('error', '连接失败');
    if (!silent) setHarnessStatus(error && error.message ? error.message : '无法连接 Harness', 'error');
    return null;
  }
}

async function refreshHarnessPanel(silent) {
  updateHarnessEndpoint();
  const connection = await refreshHarnessConnection(silent);
  if (!connection) return;
  try {
    if (!(await ensureHarnessServerPermission())) {
      throw new Error('需要允许扩展访问 Harness 服务地址。');
    }
    const tab = await queryActiveTab();
    if (unsupportedAutomationUrl(tab.url)) {
      updateHarnessSnapshotCard(null);
      harnessPageTitle.textContent = '此页面不允许扩展读取';
      harnessSnapshotMeta.textContent = '请切换到普通 http/https 网页';
      if (!silent) setHarnessStatus('当前 Chrome 系统页面不能被网页代理访问。', 'error');
      return;
    }
    if (!(await ensureAutomationPermission(tab))) {
      updateHarnessSnapshotCard(null);
      harnessPageTitle.textContent = '等待网页访问权限';
      harnessSnapshotMeta.textContent = '点击“运行任务”时可以再次授权';
      return;
    }
    const snapshot = await getHarnessPageSnapshot(tab.id);
    updateHarnessSnapshotCard(snapshot);
    if (!silent) setHarnessStatus('页面快照已更新。', 'success');
  } catch (error) {
    updateHarnessSnapshotCard(null);
    harnessPageTitle.textContent = '无法读取当前页面';
    harnessSnapshotMeta.textContent = '点击刷新或运行任务重试';
    if (!silent) setHarnessStatus(error && error.message ? error.message : '无法读取当前页面', 'error');
  }
}

function executeHarnessAction(tabId, action) {
  return sendHarnessPageCommand(tabId, 'execute', action);
}

function waitForHarnessAction(action) {
  const delay = action && action.type === 'navigate' ? 1200
    : action && ['back', 'forward', 'reload'].includes(action.type) ? 900
      : action && action.type === 'click' ? 450 : 180;
  return new Promise(resolve => setTimeout(resolve, delay));
}

function stopHarnessTask() {
  if (harnessAbortController) harnessAbortController.abort();
  setHarnessStatus('正在停止后续动作…');
}

async function runHarnessTask() {
  if (harnessRunning) {
    stopHarnessTask();
    return;
  }
  const task = harnessTask.value.trim();
  if (!task) {
    setHarnessStatus('先输入一个网页任务。', 'error');
    harnessTask.focus();
    return;
  }

  harnessRunning = true;
  harnessAbortController = new AbortController();
  const signal = harnessAbortController.signal;
  harnessRunBtn.textContent = '停止任务';
  harnessRunBtn.disabled = false;
  harnessRefreshSnapshotBtn.disabled = true;
  setHarnessStatus('正在读取当前页面…');
  harnessLogList.innerHTML = '';
  appendHarnessLog('任务：' + task);

  try {
    if (!(await ensureHarnessServerPermission())) {
      throw new Error('需要允许扩展访问 Harness 服务地址。');
    }
    const tab = await queryActiveTab();
    if (!(await ensureAutomationPermission(tab))) {
      throw new Error('需要允许扩展访问当前网页，才能读取和操作它。');
    }
    const snapshot = await getHarnessPageSnapshot(tab.id, signal);
    updateHarnessSnapshotCard(snapshot);
    setHarnessConnectionState('connected', '正在规划动作…');

    const client = createHarnessClient({
      maxWaitMs: 90000,
      timeoutMs: 20000
    });
    await client.describe({ signal });

    let sessionId = currentHarnessSessionId || '';
    let previousResults = [];
    let lastMessage = '';
    let completed = false;

    for (let round = 0; round < 5; round += 1) {
      if (signal.aborted) throw new Error('任务已停止');
      if (round > 0) {
        const refreshed = await getHarnessPageSnapshot(tab.id, signal);
        updateHarnessSnapshotCard(refreshed);
      }
      const prompt = DeepSeekHarnessProtocol.buildBrowserTaskPrompt({
        task,
        snapshot: currentHarnessSnapshot || snapshot,
        continuation: round > 0,
        previousResults
      });
      appendHarnessLog('第 ' + (round + 1) + ' 轮：请求 Harness 规划…');
      const response = await client.runPrompt(prompt, { sessionId, signal, maxWaitMs: 90000 });
      sessionId = response.sessionId;
      currentHarnessSessionId = sessionId;
      try { chrome.storage.local.set({ [HARNESS_SESSION_KEY]: sessionId }); } catch (e) {}

      const parsed = DeepSeekHarnessProtocol.parseBrowserActionResponse(response.text);
      lastMessage = parsed.message || '';
      if (lastMessage) appendHarnessLog(lastMessage, 'result');
      if (!parsed.actions.length) {
        completed = parsed.done;
        if (!parsed.message) appendHarnessLog('Harness 没有返回可执行动作。', 'result');
        break;
      }

      appendHarnessLog('模型提议 ' + parsed.actions.length + ' 个动作：' +
        parsed.actions.map(DeepSeekHarnessProtocol.actionLabel).join('、'));
      if (!harnessAutoRun.checked) {
        appendHarnessLog(JSON.stringify(parsed.actions, null, 2), 'result');
        setHarnessStatus('动作已生成，但“自动执行模型动作”处于关闭状态。');
        break;
      }

      previousResults = [];
      for (const action of parsed.actions) {
        if (signal.aborted) throw new Error('任务已停止');
        appendHarnessLog('执行：' + DeepSeekHarnessProtocol.actionLabel(action), 'action');
        try {
          const result = await executeHarnessAction(tab.id, action);
          previousResults.push({ action, ok: true, result: result || null });
          await waitForHarnessAction(action);
        } catch (error) {
          previousResults.push({ action, ok: false, error: error.message });
          appendHarnessLog('动作失败：' + error.message, 'error');
          throw error;
        }
      }

      if (parsed.done) {
        completed = true;
        break;
      }
      setHarnessStatus('动作已执行，正在读取页面变化…');
    }

    setHarnessConnectionState('connected', '已连接');
    setHarnessStatus(completed ? (lastMessage || '任务已完成。') : '已执行本轮动作，可继续描述下一步。', 'success');
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (signal.aborted || message === '任务已停止') {
      appendHarnessLog('任务已停止。', 'result');
      setHarnessStatus('任务已停止。');
    } else {
      appendHarnessLog(message, 'error');
      setHarnessConnectionState('error', '需要检查连接');
      setHarnessStatus(message, 'error');
    }
  } finally {
    harnessRunning = false;
    harnessAbortController = null;
    harnessRunBtn.textContent = '运行任务';
    harnessRefreshSnapshotBtn.disabled = false;
  }
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!tabs || !tabs[0] || typeof tabs[0].id !== 'number') {
        reject(new Error('未找到当前标签页'));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function hasHostPermissionFor(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    try {
      chrome.permissions.contains({ origins: [url] }, (granted) => {
        void chrome.runtime.lastError;
        resolve(!!granted);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

function requestAllUrlsPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
        void chrome.runtime.lastError;
        resolve(!!granted);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

async function ensurePickPermission(tab) {
  if (!tab || !tab.url) return true;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://') || tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome.google.com/webstore') ||
      tab.url.startsWith('https://chrome.google.com/webstore')) {
    return false;
  }

  const origin = (() => {
    try { return new URL(tab.url).origin + '/*'; } catch { return null; }
  })();
  if (!origin) return true;

  if (await hasHostPermissionFor(origin)) return true;
  return await requestAllUrlsPermission();
}

function pickPageElement() {
  if (window.__deepseekSidebarCancelPicker) {
    window.__deepseekSidebarCancelPicker();
  }

  return new Promise((resolve) => {
    const previousCursor = document.documentElement.style.cursor;
    const overlay = document.createElement('div');
    const label = document.createElement('div');
    let currentElement = null;
    let settled = false;

    overlay.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:0',
      'height:0',
      'border:2px solid #4a6cf7',
      'background:rgba(74,108,247,0.12)',
      'box-shadow:0 0 0 99999px rgba(15,23,42,0.08)',
      'z-index:2147483646',
      'pointer-events:none',
      'transition:transform 0.04s,width 0.04s,height 0.04s'
    ].join(';');

    label.style.cssText = [
      'position:fixed',
      'left:10px',
      'top:10px',
      'max-width:calc(100vw - 20px)',
      'padding:6px 8px',
      'border-radius:4px',
      'background:#111827',
      'color:#fff',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif',
      'z-index:2147483647',
      'pointer-events:none',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis'
    ].join(';');
    label.textContent = '移动鼠标选择元素，左键确认，右键取消';

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(label);
    document.documentElement.style.cursor = 'crosshair';

    function cssEscape(value) {
      if (window.CSS && CSS.escape) return CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    function getElementSelector(element) {
      if (element.id) return '#' + cssEscape(element.id);

      const parts = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
        let part = node.localName;
        if (node.classList && node.classList.length) {
          part += '.' + Array.from(node.classList).slice(0, 3).map(cssEscape).join('.');
        }

        const parent = node.parentElement;
        if (parent) {
          const sameTagSiblings = Array.from(parent.children).filter((child) => child.localName === node.localName);
          if (sameTagSiblings.length > 1) {
            part += ':nth-of-type(' + (sameTagSiblings.indexOf(node) + 1) + ')';
          }
        }

        parts.unshift(part);
        if (parts.length >= 6) break;
        node = parent;
      }

      return parts.join(' > ');
    }

    function describeElement(element) {
      const selector = getElementSelector(element);
      const text = (element.innerText || element.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
      return {
        title: document.title || '未命名页面',
        url: location.href,
        tagName: element.tagName.toLowerCase(),
        selector,
        text,
        html: element.outerHTML || ''
      };
    }

    function cleanup() {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onCancelPointer, true);
      window.removeEventListener('mousedown', onCancelPointer, true);
      window.removeEventListener('pointerdown', onCancelPointer, true);
      removeCancelListeners();
      document.documentElement.style.cursor = previousCursor;
      overlay.remove();
      label.remove();
      delete window.__deepseekSidebarCancelPicker;
    }

    function settle(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function updateOverlay(element) {
      const rect = element.getBoundingClientRect();
      overlay.style.transform = 'translate(' + rect.left + 'px,' + rect.top + 'px)';
      overlay.style.width = Math.max(0, rect.width) + 'px';
      overlay.style.height = Math.max(0, rect.height) + 'px';
      label.textContent = element.tagName.toLowerCase() + '  ' + getElementSelector(element);

      const labelTop = rect.top > 36 ? rect.top - 34 : rect.bottom + 8;
      label.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
      label.style.top = Math.max(8, Math.min(labelTop, window.innerHeight - 36)) + 'px';
    }

    function onMouseMove(event) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element || element === currentElement || element === overlay || element === label) return;
      currentElement = element;
      updateOverlay(element);
    }

    function onClick(event) {
      if (!currentElement) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      settle(describeElement(currentElement));
    }

    function onCancelPointer(event) {
      if (event.type !== 'contextmenu' && event.button !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      settle({ cancelled: true });
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape' && event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      settle({ cancelled: true });
    }

    function addCancelListeners() {
      [window, document, document.documentElement, document.body].forEach((target) => {
        if (!target) return;
        target.addEventListener('keydown', onKeyDown, true);
        target.addEventListener('keyup', onKeyDown, true);
      });
    }

    function removeCancelListeners() {
      [window, document, document.documentElement, document.body].forEach((target) => {
        if (!target) return;
        target.removeEventListener('keydown', onKeyDown, true);
        target.removeEventListener('keyup', onKeyDown, true);
      });
    }

    window.__deepseekSidebarCancelPicker = () => settle({ cancelled: true });
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onCancelPointer, true);
    window.addEventListener('mousedown', onCancelPointer, true);
    window.addEventListener('pointerdown', onCancelPointer, true);
    addCancelListeners();
  });
}

function cancelPageElementPick() {
  if (window.__deepseekSidebarCancelPicker) {
    window.__deepseekSidebarCancelPicker();
  }
}

function executeElementPick(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, func: pickPageElement },
      (results) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        const result = results && results[0] && results[0].result;
        if (!result) {
          reject(new Error('无法选择页面元素'));
          return;
        }
        resolve(result);
      }
    );
  });
}

function executeElementPickCancel(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        { target: { tabId }, func: cancelPageElementPick },
        () => {
          // ignore lastError; injection may fail on chrome:// or navigation
          void chrome.runtime.lastError;
          resolve();
        }
      );
    } catch (e) {
      resolve();
    }
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    if (pickPendingNavigation) {
      pickPendingNavigation = false;
      resolve('complete');
      return;
    }
    pickWaitResolver = (reason) => {
      pickWaitResolver = null;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(reason);
    };
    function onUpdated(updatedId, changeInfo) {
      if (updatedId !== tabId) return;
      if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
      pickWaitResolver && pickWaitResolver('complete');
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function setPageReaderExpanded(expanded) {
  pageReader.classList.toggle('expanded', expanded);
  togglePageReaderBtn.textContent = expanded ? '▾' : '▤';
  togglePageReaderBtn.title = expanded ? '收起' : '展开';
}

function openPageReader(expanded) {
  setPageReaderExpanded(Boolean(expanded));
  pageReader.classList.remove('hidden');
}

function showSelectedElement(result) {
  currentPageText = result.text || result.html || '';
  pageReaderTitle.textContent = result.tagName ? '已选择 <' + result.tagName + '>' : '已选择页面元素';
  pageReaderMeta.textContent = [result.selector, result.url].filter(Boolean).join(' · ');
  pageReaderContent.value = currentPageText;
  pageReaderStatus.textContent = currentPageText
    ? currentPageText.length + ' 字符 · HTML ' + (result.html ? result.html.length : 0) + ' 字符'
    : '该元素没有可见文本';
  openPageReader(false);
}

function fillCurrentAppInput(text) {
  if (!text) {
    pageReaderStatus.textContent = '该元素没有可填充的文本';
    return;
  }

  const frame = frames.get(currentApp);
  if (!frame || !frame.contentWindow) {
    pageReaderStatus.textContent = '当前 AI 页面尚未加载，无法填充输入框';
    return;
  }

  lastFillRequestId++;
  const requestId = lastFillRequestId;
  frame.contentWindow.postMessage({
    source: 'deepseek-sidebar',
    type: 'fill-input',
    requestId,
    text
  }, '*');

  pageReaderStatus.textContent = pageReaderStatus.textContent + ' · 正在填充输入框...';

  setTimeout(() => {
    if (requestId === lastFillRequestId && pageReaderStatus.textContent.includes('正在填充输入框')) {
      pageReaderStatus.textContent = pageReaderStatus.textContent.replace(' · 正在填充输入框...', ' · 未收到输入框响应');
    }
  }, 1200);
}

function showPageReaderError(message) {
  currentPageText = '';
  pageReaderTitle.textContent = '选择页面元素';
  pageReaderMeta.textContent = '';
  pageReaderContent.value = '';
  pageReaderStatus.textContent = message;
  openPageReader(false);
}

async function pickCurrentPageElement() {
  if (pickingTabId !== null) {
    if (pickCancelled) {
      return;
    }
    pickCancelled = true;
    await executeElementPickCancel(pickingTabId);
    if (pickWaitResolver) pickWaitResolver('cancelled');
    pageReaderStatus.textContent = '已取消选择';
    return;
  }

  openPageReader(false);
  pageReaderTitle.textContent = '选择页面元素';
  pageReaderMeta.textContent = '';
  pageReaderContent.value = '';
  pageReaderStatus.textContent = '请在当前页面移动鼠标选择元素，左键确认，右键取消';

  let tab;
  try {
    tab = await queryActiveTab();
  } catch (e) {
    showPageReaderError(e && e.message ? e.message : '选择失败');
    return;
  }

  const granted = await ensurePickPermission(tab);
  if (!granted) {
    showPageReaderError('需要在弹出的权限提示中允许访问网站，否则跳转后无法选择元素。');
    return;
  }

  pickingTabId = tab.id;
  pickCancelled = false;
  pickPendingNavigation = false;
  pickWaitResolver = null;

  const onNavigation = (updatedTabId, changeInfo) => {
    if (updatedTabId !== pickingTabId) return;
    if (
      changeInfo.status !== 'loading' &&
      changeInfo.status !== 'complete' &&
      !changeInfo.url
    ) return;
    pickPendingNavigation = true;
    if (pickWaitResolver) pickWaitResolver('navigation');
  };
  chrome.tabs.onUpdated.addListener(onNavigation);

  try {
    while (!pickCancelled) {
      let result;
      const pickPromise = executeElementPick(pickingTabId);
      result = await Promise.race([
        pickPromise.then((value) => ({ kind: 'result', value })).catch((error) => ({ kind: 'error', error })),
        new Promise((resolve) => {
          if (pickPendingNavigation) {
            pickPendingNavigation = false;
            resolve({ kind: 'navigation' });
            return;
          }
          pickWaitResolver = (reason) => {
            pickWaitResolver = null;
            resolve({ kind: reason === 'cancelled' ? 'cancelled' : 'navigation' });
          };
        })
      ]);

      if (result.kind === 'cancelled' || pickCancelled) {
        pageReaderStatus.textContent = '已取消选择';
        await executeElementPickCancel(pickingTabId);
        break;
      }

      if (result.kind === 'navigation') {
        pageReaderStatus.textContent = '页面已跳转，等待加载后继续选择...';
        await waitForTabComplete(pickingTabId);
        if (pickCancelled) {
          pageReaderStatus.textContent = '已取消选择';
          break;
        }
        try {
          const refreshedTab = await queryActiveTab();
          if (!(await ensurePickPermission(refreshedTab))) {
            showPageReaderError('跳转到新页面，权限不足，请重新点击选择按钮并授权');
            break;
          }
        } catch (e) {
          showPageReaderError(e && e.message ? e.message : '权限检查失败');
          break;
        }
        pageReaderStatus.textContent = '请在当前页面移动鼠标选择元素，左键确认，右键取消';
        continue;
      }

      if (result.kind === 'error') {
        if (pickCancelled) break;
        pageReaderStatus.textContent = '页面已跳转，等待加载后继续选择...';
        await waitForTabComplete(pickingTabId);
        if (pickCancelled) {
          pageReaderStatus.textContent = '已取消选择';
          break;
        }
        try {
          const refreshedTab = await queryActiveTab();
          if (!(await ensurePickPermission(refreshedTab))) {
            showPageReaderError('跳转到新页面，权限不足，请重新点击选择按钮并授权');
            break;
          }
        } catch (e) {
          showPageReaderError(e && e.message ? e.message : '权限检查失败');
          break;
        }
        pageReaderStatus.textContent = '请在当前页面移动鼠标选择元素，左键确认，右键取消';
        continue;
      }

      const value = result.value;
      if (!value || value.cancelled) {
        pageReaderStatus.textContent = '已取消选择';
        break;
      }

      showSelectedElement(value);
      fillCurrentAppInput(currentPageText);
      break;
    }
  } finally {
    chrome.tabs.onUpdated.removeListener(onNavigation);
    pickingTabId = null;
    pickCancelled = false;
    pickPendingNavigation = false;
    pickWaitResolver = null;
  }
}

async function copyCurrentPageText() {
  if (!currentPageText) {
    pageReaderStatus.textContent = '没有可复制的页面内容';
    return;
  }

  try {
    await navigator.clipboard.writeText(currentPageText);
    pageReaderStatus.textContent = '已复制';
  } catch (e) {
    pageReaderContent.focus();
    pageReaderContent.select();
    document.execCommand('copy');
    pageReaderStatus.textContent = '已复制';
  }
}

// Bind all event listeners first (before any potentially failing async/storage calls)
zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
pickElementBtn.addEventListener('click', pickCurrentPageElement);
togglePageReaderBtn.addEventListener('click', () => setPageReaderExpanded(!pageReader.classList.contains('expanded')));
copyPageContentBtn.addEventListener('click', copyCurrentPageText);
closePageReaderBtn.addEventListener('click', () => {
  pageReader.classList.add('hidden');
  setPageReaderExpanded(false);
});
configBtn.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('config.html'));
  }
});
reloadBtn.addEventListener('click', () => {
  if (currentApp === 'harness') {
    refreshHarnessPanel(false);
    return;
  }
  const frame = frames.get(currentApp);
  if (!frame) return;
  loadedApps.delete(currentApp);
  loading.classList.remove('hidden');
  frame.src = frame.src;
  hideLoadingIfStillWaiting(currentApp);
});
zoomLabel.addEventListener('dblclick', () => applyZoom(100));
harnessOpenBtn.addEventListener('click', () => {
  try {
    chrome.tabs.create({ url: currentHarnessUrl });
  } catch (error) {
    setHarnessStatus('无法打开 Harness 页面。', 'error');
  }
});
harnessRefreshSnapshotBtn.addEventListener('click', () => refreshHarnessPanel(false));
harnessRunBtn.addEventListener('click', runHarnessTask);
harnessTask.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    runHarnessTask();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + ZOOM_STEP); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - ZOOM_STEP); }
});

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.source !== 'deepseek-sidebar' || data.type !== 'fill-input-result') return;
  const frame = frames.get(currentApp);
  if (!frame || event.source !== frame.contentWindow) return;
  if (data.requestId !== lastFillRequestId) return;

  pageReaderStatus.textContent = pageReaderStatus.textContent.replace(
    ' · 正在填充输入框...',
    data.ok ? ' · 已填充输入框' : ' · 未找到输入框'
  );
});

setTimeout(() => loading.classList.add('hidden'), 8000);

// Restore saved state (last, in case storage API fails)
(async () => {
  await loadAppVisibility();
  renderAppButtons();
  let savedApp = 'deepseek';
  let savedZoom = 100;
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get([ZOOM_KEY, APP_KEY, HARNESS_URL_KEY, HARNESS_SESSION_KEY], resolve);
    });
    savedApp = result[APP_KEY] || 'deepseek';
    savedZoom = result[ZOOM_KEY] || 100;
    currentHarnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(result[HARNESS_URL_KEY]);
    currentHarnessSessionId = result[HARNESS_SESSION_KEY] || '';
  } catch (e) {
    // use defaults
    currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
  }
  updateHarnessEndpoint();
  // If saved app is hidden, fall back to first visible app
  if (appVisibility[savedApp] === false) {
    const orderedIds = appOrder.length > 0 ? appOrder : APP_META.map(a => a.id);
    const firstVisibleId = orderedIds.find(id => appVisibility[id] !== false);
    savedApp = firstVisibleId || 'deepseek';
  }
  switchApp(savedApp);
  applyZoom(savedZoom);
})();
