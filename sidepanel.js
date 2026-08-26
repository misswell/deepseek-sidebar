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
const harnessBridgeStatus = document.getElementById('harness-bridge-status');
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
const HARNESS_TOKEN_KEY = 'deepseek-sidebar-harness-token';
const HARNESS_SESSION_KEY = 'deepseek-sidebar-harness-session';
const TAB_STATE_KEY = 'deepseek-sidebar-tab-states';
const HARNESS_BRIDGE_SOURCE = 'deepseek-sidebar-harness-bridge';
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
let currentTabId = null;
let currentWindowId = null;
let currentPageText = '';
let currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
let currentHarnessToken = '';
let currentHarnessSessionId = '';
let currentHarnessSnapshot = null;
let harnessRunning = false;
let harnessAbortController = null;
let nativeHarnessBridge = { state: 'stopped', connected: false, caps: null, error: '' };
let harnessBridgePort = null;
let pickingTabId = null;
let pickCancelled = false;
let pickWaitResolver = null;
let pickPendingNavigation = false;
let harnessRunningTabId = null;
let tabPanelStates = new Map();
let persistedTabStates = {};
let tabStateStorageWrite = Promise.resolve();
let tabLifecycleReady = false;
let pendingActiveTab = null;
let tabActivationQueue = Promise.resolve();
const appSwitcher = document.getElementById('appSwitcher');
const configBtn = document.getElementById('config-btn');
let appButtons = [];  // populated dynamically by renderAppButtons()
let appVisibility = {};  // { appId: true/false }
let appOrder = [];  // ordered array of app ids
const frameGroups = new Map();
const loadedAppGroups = new Map();

function numericTabId(tabId) {
  const key = DeepSeekSidebarTabState.tabKey(tabId);
  return key === null ? null : Number(key);
}

function isCurrentPanelTab(tabId) {
  const id = numericTabId(tabId);
  return id !== null && id === currentTabId;
}

function createPanelState(tabId, stableState) {
  const normalized = DeepSeekSidebarTabState.normalizeState(stableState);
  return {
    tabId: numericTabId(tabId),
    app: normalized.app,
    zoom: normalized.zoom,
    harnessSessionId: normalized.harnessSessionId,
    pageText: '',
    pageReader: {
      hidden: true,
      expanded: false,
      title: '当前页面内容',
      meta: '',
      status: ''
    },
    harnessSnapshot: null,
    harnessTask: '',
    harnessAutoRun: true,
    harnessLog: [],
    harnessStatus: { message: '', kind: '' }
  };
}

function getPanelState(tabId) {
  const id = numericTabId(tabId);
  if (id === null) return null;
  if (!tabPanelStates.has(id)) {
    tabPanelStates.set(id, createPanelState(id, DeepSeekSidebarTabState.getTabState(persistedTabStates, id)));
  }
  const state = tabPanelStates.get(id);
  if (!APPS[state.app]) state.app = 'deepseek';
  return state;
}

function firstVisibleApp() {
  const orderedIds = appOrder.length > 0 ? appOrder : APP_META.map(app => app.id);
  return orderedIds.find(id => appVisibility[id] !== false) || 'deepseek';
}

function ensureVisibleApp(tabId) {
  const state = getPanelState(tabId);
  if (!state) return null;
  if (appVisibility[state.app] === false) {
    state.app = firstVisibleApp();
    persistPanelState(tabId);
  }
  return state;
}

function queueTabStateStorageWrite() {
  const snapshot = JSON.parse(JSON.stringify(persistedTabStates));
  tabStateStorageWrite = tabStateStorageWrite
    .catch(() => {})
    .then(() => new Promise(resolve => {
      try {
        chrome.storage.local.set({ [TAB_STATE_KEY]: snapshot }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (error) {
        resolve();
      }
    }));
}

function persistPanelState(tabId) {
  const state = getPanelState(tabId);
  const id = numericTabId(tabId);
  if (!state || id === null) return;
  persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, id, {
    app: state.app,
    zoom: state.zoom,
    harnessSessionId: state.harnessSessionId
  });
  queueTabStateStorageWrite();
}

function readLocalStorage(keys) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(keys, result => {
        void chrome.runtime.lastError;
        resolve(result || {});
      });
    } catch (error) {
      resolve({});
    }
  });
}

function readOpenTabIds() {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({}, tabs => {
        void chrome.runtime.lastError;
        resolve(new Set((tabs || [])
          .map(tab => numericTabId(tab && tab.id))
          .filter(id => id !== null)));
      });
    } catch (error) {
      resolve(null);
    }
  });
}

async function loadPanelStateStore(initialTabId) {
  const result = await readLocalStorage([
    TAB_STATE_KEY,
    APP_KEY,
    ZOOM_KEY,
    HARNESS_SESSION_KEY
  ]);
  persistedTabStates = DeepSeekSidebarTabState.normalizeMap(result[TAB_STATE_KEY]);
  const initialId = numericTabId(initialTabId);
  const initialKey = initialId === null ? null : String(initialId);
  const hasLegacyState = result[APP_KEY] || result[ZOOM_KEY] || result[HARNESS_SESSION_KEY];
  if (initialKey !== null && !persistedTabStates[initialKey] && hasLegacyState) {
    persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, initialId, {
      app: result[APP_KEY],
      zoom: result[ZOOM_KEY],
      harnessSessionId: result[HARNESS_SESSION_KEY]
    });
    queueTabStateStorageWrite();
  }
  const openTabIds = await readOpenTabIds();
  if (openTabIds) {
    let removedStaleState = false;
    Object.keys(persistedTabStates).forEach(tabId => {
      if (!openTabIds.has(Number(tabId))) {
        persistedTabStates = DeepSeekSidebarTabState.removeTabState(persistedTabStates, tabId);
        removedStaleState = true;
      }
    });
    if (removedStaleState) queueTabStateStorageWrite();
  }
  tabPanelStates.clear();
  Object.entries(persistedTabStates).forEach(([tabId, state]) => {
    const id = numericTabId(tabId);
    if (id !== null) tabPanelStates.set(id, createPanelState(id, state));
  });
}

function readHarnessLogEntries() {
  return Array.from(harnessLogList.children)
    .map(item => ({
      message: item.textContent || '',
      kind: item.classList.contains('error') ? 'error'
        : item.classList.contains('action') ? 'action'
          : item.classList.contains('result') ? 'result' : ''
    }))
    .filter(item => item.message && !item.message.startsWith('输入任务后'));
}

function renderHarnessLogEntries(entries) {
  harnessLogList.innerHTML = '';
  const values = Array.isArray(entries) ? entries.filter(item => item && item.message) : [];
  if (!values.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'harness-log-item';
    placeholder.textContent = '输入任务后，Harness 会通过 browser_* 工具按需读取并操作当前页面。';
    harnessLogList.appendChild(placeholder);
    return;
  }
  values.slice(-24).forEach(item => {
    const element = document.createElement('div');
    element.className = 'harness-log-item' + (item.kind ? ' ' + item.kind : '');
    element.textContent = item.message;
    harnessLogList.appendChild(element);
  });
  harnessLogList.lastElementChild && harnessLogList.lastElementChild.scrollIntoView({ block: 'nearest' });
}

function captureCurrentPanelState() {
  const state = getPanelState(currentTabId);
  if (!state) return;
  if (currentApp) state.app = currentApp;
  state.zoom = currentZoom;
  state.harnessSessionId = currentHarnessSessionId || '';
  state.pageText = currentPageText || '';
  state.pageReader = {
    hidden: pageReader.classList.contains('hidden'),
    expanded: pageReader.classList.contains('expanded'),
    title: pageReaderTitle.textContent || '当前页面内容',
    meta: pageReaderMeta.textContent || '',
    status: pageReaderStatus.textContent || ''
  };
  state.harnessSnapshot = currentHarnessSnapshot || null;
  state.harnessTask = harnessTask.value || '';
  state.harnessAutoRun = Boolean(harnessAutoRun.checked);
  state.harnessLog = readHarnessLogEntries();
  state.harnessStatus = {
    message: harnessStatus.textContent || '',
    kind: harnessStatus.classList.contains('error') ? 'error'
      : harnessStatus.classList.contains('success') ? 'success' : ''
  };
}

function restorePanelState(tabId) {
  const state = getPanelState(tabId);
  if (!state) return;
  currentApp = state.app;
  currentZoom = state.zoom;
  currentPageText = state.pageText || '';
  currentHarnessSessionId = state.harnessSessionId || '';
  currentHarnessSnapshot = state.harnessSnapshot || null;
  harnessTask.value = state.harnessTask || '';
  harnessAutoRun.checked = state.harnessAutoRun !== false;
  pageReaderTitle.textContent = state.pageReader.title || '当前页面内容';
  pageReaderMeta.textContent = state.pageReader.meta || '';
  pageReaderContent.value = currentPageText;
  pageReaderStatus.textContent = state.pageReader.status || '';
  pageReader.classList.toggle('hidden', state.pageReader.hidden !== false);
  setPageReaderExpanded(state.pageReader.expanded === true);
  renderHarnessLogEntries(state.harnessLog);
  updateHarnessSnapshotCard(currentHarnessSnapshot, tabId);
  setHarnessStatus(state.harnessStatus.message, state.harnessStatus.kind, tabId);
  zoomLabel.textContent = currentZoom + '%';
}

function frameGroupForTab(tabId, create) {
  const id = numericTabId(tabId);
  if (id === null) return null;
  let group = frameGroups.get(id);
  if (!group && create) {
    group = new Map();
    frameGroups.set(id, group);
  }
  return group || null;
}

function loadedAppsForTab(tabId, create) {
  const id = numericTabId(tabId);
  if (id === null) return null;
  let apps = loadedAppGroups.get(id);
  if (!apps && create) {
    apps = new Set();
    loadedAppGroups.set(id, apps);
  }
  return apps || null;
}

function removeTabFrames(tabId) {
  const id = numericTabId(tabId);
  const group = frameGroupForTab(id, false);
  if (group) group.forEach(frame => frame.remove());
  frameGroups.delete(id);
  loadedAppGroups.delete(id);
}

function scheduleTabActivation(tabId, windowId) {
  tabActivationQueue = tabActivationQueue
    .catch(() => {})
    .then(() => activateTab(tabId, windowId));
  return tabActivationQueue;
}

function activateTab(tabId, windowId) {
  const id = numericTabId(tabId);
  if (id === null) return;
  if (currentTabId === id && (windowId === undefined || currentWindowId === windowId)) return;

  if (pickingTabId !== null && pickingTabId !== id) {
    pickCancelled = true;
    void executeElementPickCancel(pickingTabId);
    if (pickWaitResolver) pickWaitResolver('cancelled');
  }
  if (harnessRunning && harnessRunningTabId !== null && harnessRunningTabId !== id) {
    harnessAbortController && harnessAbortController.abort();
  }

  captureCurrentPanelState();
  if (currentTabId !== null) persistPanelState(currentTabId);
  currentTabId = id;
  if (windowId !== undefined) currentWindowId = windowId;
  restorePanelState(id);
  const state = ensureVisibleApp(id);
  if (state) currentApp = state.app;
  renderAppButtons();
  renderCurrentApp();
}

function forgetTabState(tabId) {
  const id = numericTabId(tabId);
  if (id === null) return;
  if (currentTabId === id) captureCurrentPanelState();
  tabPanelStates.delete(id);
  persistedTabStates = DeepSeekSidebarTabState.removeTabState(persistedTabStates, id);
  removeTabFrames(id);
  queueTabStateStorageWrite();
  if (harnessRunningTabId === id && harnessAbortController) harnessAbortController.abort();
}

function bindTabLifecycleListeners() {
  chrome.tabs.onActivated.addListener(activeInfo => {
    if (!activeInfo || !Number.isSafeInteger(activeInfo.tabId)) return;
    if (!tabLifecycleReady) {
      pendingActiveTab = activeInfo;
      return;
    }
    if (currentWindowId !== null && activeInfo.windowId !== currentWindowId) return;
    scheduleTabActivation(activeInfo.tabId, activeInfo.windowId);
  });

  chrome.tabs.onCreated.addListener(tab => {
    if (!tab || !tab.active || !Number.isSafeInteger(tab.id)) return;
    if (!tabLifecycleReady) {
      pendingActiveTab = { tabId: tab.id, windowId: tab.windowId };
      return;
    }
    if (currentWindowId !== null && tab.windowId !== currentWindowId) return;
    scheduleTabActivation(tab.id, tab.windowId);
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const wasCurrent = currentTabId === tabId;
    forgetTabState(tabId);
    if (!wasCurrent) return;
    currentTabId = null;
    setTimeout(() => {
      queryActiveTab().then(tab => {
        if (!tab || !Number.isSafeInteger(tab.id)) return;
        if (currentWindowId !== null && tab.windowId !== currentWindowId) return;
        scheduleTabActivation(tab.id, tab.windowId);
      }).catch(() => {});
    }, 0);
    void removeInfo;
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const oldId = numericTabId(removedTabId);
    const newId = numericTabId(addedTabId);
    if (oldId === null || newId === null) return;
    const wasCurrent = currentTabId === oldId;
    if (wasCurrent) captureCurrentPanelState();
    if (tabPanelStates.has(oldId) && !tabPanelStates.has(newId)) {
      tabPanelStates.set(newId, tabPanelStates.get(oldId));
      tabPanelStates.get(newId).tabId = newId;
      tabPanelStates.delete(oldId);
    }
    persistedTabStates = DeepSeekSidebarTabState.replaceTabState(persistedTabStates, oldId, newId);
    const oldFrames = frameGroups.get(oldId);
    if (oldFrames && !frameGroups.has(newId)) frameGroups.set(newId, oldFrames);
    const oldLoaded = loadedAppGroups.get(oldId);
    if (oldLoaded && !loadedAppGroups.has(newId)) loadedAppGroups.set(newId, oldLoaded);
    frameGroups.delete(oldId);
    loadedAppGroups.delete(oldId);
    queueTabStateStorageWrite();
    if (wasCurrent) {
      currentTabId = null;
      scheduleTabActivation(newId, currentWindowId);
    }
  });
}

bindTabLifecycleListeners();

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
  if (changes[TAB_STATE_KEY]) {
    persistedTabStates = DeepSeekSidebarTabState.normalizeMap(changes[TAB_STATE_KEY].newValue);
  }
  if (changes[VISIBILITY_KEY]) {
    appVisibility = changes[VISIBILITY_KEY].newValue || {};
    if (currentApp && appVisibility[currentApp] === false) {
      const state = getPanelState(currentTabId);
      if (state) {
        state.app = firstVisibleApp();
        currentApp = state.app;
        persistPanelState(currentTabId);
      }
    }
    renderAppButtons();
    if (currentTabId !== null) renderCurrentApp();
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
    if (currentApp === 'harness') activateHarnessPanel(true, currentTabId);
  }
  if (changes[HARNESS_TOKEN_KEY]) {
    currentHarnessToken = typeof changes[HARNESS_TOKEN_KEY].newValue === 'string'
      ? changes[HARNESS_TOKEN_KEY].newValue : '';
    if (currentApp === 'harness') activateHarnessPanel(true, currentTabId);
  }
});

function applyZoomToFrame(frame, zoom) {
  const scale = (Number.isFinite(zoom) ? zoom : currentZoom) / 100;
  frame.style.transform = 'scale(' + scale + ')';
  frame.style.width = (100 / scale) + '%';
  frame.style.height = (100 / scale) + '%';
}

function hideLoadingIfStillWaiting(appId, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  setTimeout(() => {
    if (isCurrentPanelTab(targetTabId) && currentApp === appId &&
        !(loadedAppsForTab(targetTabId, false) || new Set()).has(appId)) {
      loading.classList.add('hidden');
    }
  }, 8000);
}

function setupFrameLoadState(frame, appId, tabId) {
  frame.addEventListener('load', () => {
    loadedAppsForTab(tabId, true).add(appId);
    if (isCurrentPanelTab(tabId) && currentApp === appId) loading.classList.add('hidden');
  });
}

function getOrCreateFrame(appId, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  const group = frameGroupForTab(targetTabId, true);
  if (!group) return null;
  const existingFrame = group.get(appId);
  if (existingFrame) return existingFrame;

  const app = APPS[appId];
  if (!app || !app.url) return null;
  const frame = document.createElement('iframe');
  frame.className = 'webview-frame hidden';
  frame.dataset.app = appId;
  frame.dataset.tabId = String(targetTabId);
  frame.setAttribute('allow', IFRAME_ALLOW);
  frame.removeAttribute('sandbox');
  setupFrameLoadState(frame, appId, targetTabId);
  const state = getPanelState(targetTabId);
  applyZoomToFrame(frame, state ? state.zoom : currentZoom);
  webviewContainer.appendChild(frame);
  group.set(appId, frame);
  if (appId !== 'harness') frame.src = app.url;
  hideLoadingIfStillWaiting(appId, targetTabId);
  return frame;
}

function setHarnessBridgeStatus(message, state) {
  if (!message) {
    harnessBridgeStatus.textContent = '';
    harnessBridgeStatus.classList.remove('visible', 'error', 'working', 'done');
    return;
  }
  harnessBridgeStatus.textContent = message;
  harnessBridgeStatus.classList.remove('error', 'working', 'done');
  if (state) harnessBridgeStatus.classList.add(state);
  harnessBridgeStatus.classList.add('visible');
  if (state === 'ready' || state === 'done') {
    setTimeout(() => {
      if (harnessBridgeStatus.textContent === message) {
        harnessBridgeStatus.classList.remove('visible');
      }
    }, 2600);
  }
}

async function activateHarnessPanel(forceRefresh, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
  setHarnessBridgeStatus('正在连接原生浏览器工具…', 'working');
  try {
    const started = await sendHarnessBridgeCommand('start', {
      baseUrl: currentHarnessUrl,
      token: currentHarnessToken
    });
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    applyHarnessBridgeStatus(started);
    const connected = await waitForNativeHarnessBridge(forceRefresh ? 600 : 1800);
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    // Do not leave a reconnect loop running when this is an older Harness
    // instance without the browser bridge. The HTTP compatibility path below
    // remains available and the next refresh can try native mode again.
    if (!connected) {
      try {
        const stopped = await sendHarnessBridgeCommand('stop');
        applyHarnessBridgeStatus(stopped);
      } catch (error) {}
    }
    await refreshHarnessPanel(Boolean(forceRefresh), targetTabId);
  } catch (error) {
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    try {
      const stopped = await sendHarnessBridgeCommand('stop');
      applyHarnessBridgeStatus(stopped);
    } catch (stopError) {}
    setHarnessBridgeStatus(error && error.message ? error.message : 'Harness bridge 未启用', 'error');
    await refreshHarnessPanel(true, targetTabId);
  }
}

function hideAllFrames() {
  frameGroups.forEach(group => group.forEach(frame => frame.classList.add('hidden')));
}

function renderCurrentApp() {
  const state = ensureVisibleApp(currentTabId);
  if (!state) return;
  currentApp = state.app;
  if (!APPS[currentApp]) return;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === currentApp));
  hideAllFrames();
  if (currentApp === 'harness') {
    harnessPanel.classList.remove('hidden');
    loading.classList.add('hidden');
    updateHarnessEndpoint();
    harnessRunBtn.textContent = harnessRunningTabId === currentTabId ? '停止任务' : '运行任务';
    harnessRunBtn.disabled = harnessRunning && harnessRunningTabId !== currentTabId;
    harnessRefreshSnapshotBtn.disabled = harnessRunning;
    if (!harnessRunning) activateHarnessPanel(false, currentTabId);
    return;
  }
  harnessPanel.classList.add('hidden');
  const frame = getOrCreateFrame(currentApp, currentTabId);
  const group = frameGroupForTab(currentTabId, false);
  if (!frame || !group) return;
  group.forEach((item, id) => item.classList.toggle('hidden', id !== currentApp));
  group.forEach(item => applyZoomToFrame(item, currentZoom));
  if ((loadedAppsForTab(currentTabId, false) || new Set()).has(currentApp)) loading.classList.add('hidden');
  else {
    loading.classList.remove('hidden');
    hideLoadingIfStillWaiting(currentApp, currentTabId);
  }
}

function switchApp(appId) {
  const app = APPS[appId];
  if (!app) return;
  captureCurrentPanelState();
  currentApp = appId;
  const state = getPanelState(currentTabId);
  if (state) {
    state.app = appId;
    persistPanelState(currentTabId);
  }
  renderCurrentApp();
}

function applyZoom(zoom) {
  currentZoom = DeepSeekSidebarTabState.normalizeZoom(zoom);
  const state = getPanelState(currentTabId);
  if (state) {
    state.zoom = currentZoom;
    persistPanelState(currentTabId);
  }
  const group = frameGroupForTab(currentTabId, false);
  if (group) group.forEach(frame => applyZoomToFrame(frame, currentZoom));
  zoomLabel.textContent = currentZoom + '%';
}

function updateHarnessEndpoint() {
  harnessEndpoint.textContent = currentHarnessUrl;
}

function setHarnessConnectionState(state, label) {
  harnessState.classList.remove('connected', 'error');
  if (state === 'connected' || state === 'error') harnessState.classList.add(state);
  harnessStateLabel.textContent = label;
}

function applyHarnessBridgeStatus(status) {
  if (!status || status.source !== HARNESS_BRIDGE_SOURCE) return;
  nativeHarnessBridge = {
    state: status.state || 'stopped',
    connected: status.connected === true,
    caps: status.caps || null,
    error: status.error || ''
  };
  if (nativeHarnessBridge.connected) {
    setHarnessConnectionState('connected', '原生网页工具已连接');
    setHarnessBridgeStatus('原生网页工具已就绪，模型会直接调用当前页面', 'done');
  } else if (nativeHarnessBridge.state === 'connecting' || nativeHarnessBridge.state === 'reconnecting') {
    setHarnessConnectionState('connecting', '正在连接网页工具…');
    setHarnessBridgeStatus(nativeHarnessBridge.error || '正在连接 Harness 浏览器 bridge…', 'working');
  } else if (nativeHarnessBridge.state === 'stopped' && nativeHarnessBridge.error) {
    setHarnessConnectionState('error', '网页工具未连接');
    setHarnessBridgeStatus(nativeHarnessBridge.error, 'error');
  } else if (nativeHarnessBridge.state === 'stopped') {
    setHarnessConnectionState('connecting', '等待原生网页工具');
  }
}

function sendHarnessBridgeCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const message = {
      source: HARNESS_BRIDGE_SOURCE,
      command,
      ...(payload || {})
    };
    try {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response || response.ok !== true) {
          reject(new Error(response && response.error ? response.error : 'Harness bridge 没有返回结果'));
          return;
        }
        resolve(response.value);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function sendNativeHarnessRpc(request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeAbort = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (removeAbort) removeAbort();
      callback(value);
    };
    const onAbort = () => {
      const error = new Error('任务已停止');
      error.name = 'AbortError';
      finish(reject, error);
    };
    if (request.signal) {
      if (request.signal.aborted) {
        onAbort();
        return;
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => request.signal.removeEventListener('abort', onAbort);
    }
    try {
      chrome.runtime.sendMessage({
        source: HARNESS_BRIDGE_SOURCE,
        command: 'rpc',
        method: request.method,
        payload: request.payload,
        timeoutMs: request.timeoutMs
      }, response => {
        const error = chrome.runtime.lastError;
        if (error) {
          finish(reject, new Error(error.message));
          return;
        }
        if (!response || response.ok !== true) {
          finish(reject, new Error(response && response.error ? response.error : 'Harness bridge RPC 失败'));
          return;
        }
        finish(resolve, response.value);
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function createNativeHarnessClient(options) {
  return new DeepSeekHarnessClient(currentHarnessUrl, {
    ...(options || {}),
    transport: sendNativeHarnessRpc
  });
}

async function waitForNativeHarnessBridge(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 1800);
  while (Date.now() < deadline) {
    try {
      const status = await sendHarnessBridgeCommand('status');
      applyHarnessBridgeStatus(status);
      if (status && status.connected) return true;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  return Boolean(nativeHarnessBridge.connected);
}

function connectHarnessBridgePort() {
  try {
    harnessBridgePort = chrome.runtime.connect({ name: HARNESS_BRIDGE_SOURCE });
    harnessBridgePort.onMessage.addListener(applyHarnessBridgeStatus);
    harnessBridgePort.onDisconnect.addListener(() => { harnessBridgePort = null; });
  } catch (error) {
    harnessBridgePort = null;
  }
}

connectHarnessBridgePort();

function setHarnessStatus(message, kind, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  const state = getPanelState(targetTabId);
  if (state) state.harnessStatus = { message: message || '', kind: kind || '' };
  if (!isCurrentPanelTab(targetTabId)) return;
  harnessStatus.textContent = message || '';
  harnessStatus.classList.remove('error', 'success');
  if (kind) harnessStatus.classList.add(kind);
}

function appendHarnessLog(message, kind, tabId) {
  if (!message) return;
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  const state = getPanelState(targetTabId);
  if (!state) return;
  state.harnessLog = [...(Array.isArray(state.harnessLog) ? state.harnessLog : []), {
    message: String(message),
    kind: kind || ''
  }].slice(-24);
  if (isCurrentPanelTab(targetTabId)) renderHarnessLogEntries(state.harnessLog);
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

function updateHarnessSnapshotCard(snapshot, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  const state = getPanelState(targetTabId);
  if (state) state.harnessSnapshot = snapshot || null;
  if (!isCurrentPanelTab(targetTabId)) return;
  currentHarnessSnapshot = snapshot || null;
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

async function refreshHarnessConnection(silent, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return null;
  try {
    const client = createHarnessClient({ timeoutMs: 6000 });
    const info = await client.describe();
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return null;
    const model = info && (info.model || info.provider);
    setHarnessConnectionState('connected', nativeHarnessBridge.connected
      ? '原生网页工具已连接'
      : model ? '兼容模式 · ' + model : '兼容模式已连接');
    if (!silent) setHarnessStatus('本地 Harness 已连接。', 'success', targetTabId);
    return info;
  } catch (error) {
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return null;
    setHarnessConnectionState('error', '连接失败');
    if (!silent) setHarnessStatus(error && error.message ? error.message : '无法连接 Harness', 'error', targetTabId);
    return null;
  }
}

async function refreshHarnessPanel(silent, tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
  updateHarnessEndpoint();
  if (nativeHarnessBridge.connected) {
    try {
      const tab = await queryTabById(targetTabId);
      if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
      if (unsupportedAutomationUrl(tab.url)) {
        updateHarnessSnapshotCard(null, targetTabId);
        harnessPageTitle.textContent = '此页面不允许扩展读取';
        harnessSnapshotMeta.textContent = '请切换到普通 http/https 网页';
        if (!silent) setHarnessStatus('当前 Chrome 系统页面不能被网页代理访问。', 'error', targetTabId);
        return;
      }
      if (!(await ensureAutomationPermission(tab))) {
        updateHarnessSnapshotCard(null, targetTabId);
        harnessPageTitle.textContent = '等待网页访问权限';
        harnessSnapshotMeta.textContent = '运行任务时可以再次授权';
        return;
      }
      const snapshot = await getHarnessPageSnapshot(tab.id);
      if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
      updateHarnessSnapshotCard(snapshot, targetTabId);
      if (!silent) setHarnessStatus('原生网页工具已连接，页面快照已更新。', 'success', targetTabId);
    } catch (error) {
      if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
      updateHarnessSnapshotCard(null, targetTabId);
      harnessPageTitle.textContent = '无法读取当前页面';
      harnessSnapshotMeta.textContent = '点击刷新或运行任务重试';
      if (!silent) setHarnessStatus(error && error.message ? error.message : '无法读取当前页面', 'error', targetTabId);
    }
    return;
  }
  const connection = await refreshHarnessConnection(silent, targetTabId);
  if (!connection) return;
  try {
    if (!(await ensureHarnessServerPermission())) {
      throw new Error('需要允许扩展访问 Harness 服务地址。');
    }
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    const tab = await queryTabById(targetTabId);
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    if (unsupportedAutomationUrl(tab.url)) {
      updateHarnessSnapshotCard(null, targetTabId);
      harnessPageTitle.textContent = '此页面不允许扩展读取';
      harnessSnapshotMeta.textContent = '请切换到普通 http/https 网页';
      if (!silent) setHarnessStatus('当前 Chrome 系统页面不能被网页代理访问。', 'error', targetTabId);
      return;
    }
    if (!(await ensureAutomationPermission(tab))) {
      updateHarnessSnapshotCard(null, targetTabId);
      harnessPageTitle.textContent = '等待网页访问权限';
      harnessSnapshotMeta.textContent = '点击“运行任务”时可以再次授权';
      return;
    }
    const snapshot = await getHarnessPageSnapshot(tab.id);
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    updateHarnessSnapshotCard(snapshot, targetTabId);
    if (!silent) setHarnessStatus('页面快照已更新。', 'success', targetTabId);
  } catch (error) {
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
    updateHarnessSnapshotCard(null, targetTabId);
    harnessPageTitle.textContent = '无法读取当前页面';
    harnessSnapshotMeta.textContent = '点击刷新或运行任务重试';
    if (!silent) setHarnessStatus(error && error.message ? error.message : '无法读取当前页面', 'error', targetTabId);
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
  setHarnessStatus('正在停止后续动作…', '', harnessRunningTabId === null ? currentTabId : harnessRunningTabId);
}

function setHarnessSessionForTab(tabId, sessionId) {
  const state = getPanelState(tabId);
  if (!state) return;
  state.harnessSessionId = typeof sessionId === 'string' ? sessionId : '';
  if (isCurrentPanelTab(tabId)) currentHarnessSessionId = state.harnessSessionId;
  persistPanelState(tabId);
}

async function runNativeHarnessTask(task, signal, tabId) {
  const targetTabId = numericTabId(tabId);
  const client = createNativeHarnessClient({
    maxWaitMs: 90000,
    timeoutMs: 20000
  });
  let sessionId = (getPanelState(targetTabId) || {}).harnessSessionId || '';
  const cancelActiveSession = () => {
    if (!sessionId) return;
    void client.cancel(sessionId, { timeoutMs: 5000 }).catch(() => {});
  };
  signal.addEventListener('abort', cancelActiveSession, { once: true });
  try {
    await client.describe({ signal });
    appendHarnessLog('原生工具模式：任务只发送给 Harness，页面由 browser_* 工具按需读取；当前标签页已固定。', 'result', targetTabId);
    const response = await client.runPrompt(task, {
      sessionId,
      onSessionId: value => { sessionId = value; },
      signal,
      maxWaitMs: 90000
    });
    setHarnessSessionForTab(targetTabId, response.sessionId);
    if (response.text) appendHarnessLog(response.text, 'result', targetTabId);
    if (isCurrentPanelTab(targetTabId)) setHarnessConnectionState('connected', '原生网页工具已连接');
    setHarnessStatus(response.text || '任务已完成。', 'success', targetTabId);
  } finally {
    signal.removeEventListener('abort', cancelActiveSession);
  }
}

async function runHarnessTask() {
  if (harnessRunning) {
    if (harnessRunningTabId === currentTabId) stopHarnessTask();
    else setHarnessStatus('另一个页面的任务正在运行，请稍候。', 'error', currentTabId);
    return;
  }
  const task = harnessTask.value.trim();
  if (!task) {
    setHarnessStatus('先输入一个网页任务。', 'error');
    harnessTask.focus();
    return;
  }

  const taskTabId = numericTabId(currentTabId);
  if (taskTabId === null) {
    setHarnessStatus('未找到当前标签页。', 'error');
    return;
  }
  harnessRunning = true;
  harnessRunningTabId = taskTabId;
  harnessAbortController = new AbortController();
  const signal = harnessAbortController.signal;
  harnessRunBtn.textContent = '停止任务';
  harnessRunBtn.disabled = false;
  harnessRefreshSnapshotBtn.disabled = true;
  setHarnessStatus(nativeHarnessBridge.connected ? '正在启动原生网页工具…' : '正在读取当前页面…', '', taskTabId);
  const taskState = getPanelState(taskTabId);
  if (taskState) taskState.harnessLog = [];
  renderHarnessLogEntries([]);
  appendHarnessLog('任务：' + task, '', taskTabId);
  let nativeTargetBound = false;

  try {
    if (!(await ensureHarnessServerPermission())) {
      throw new Error('需要允许扩展访问 Harness 服务地址。');
    }
    if (signal.aborted || !isCurrentPanelTab(taskTabId)) throw new Error('任务已停止');
    const tab = await queryTabById(taskTabId);
    if (!(await ensureAutomationPermission(tab))) {
      throw new Error('需要允许扩展访问当前网页，才能读取和操作它。');
    }
    if (signal.aborted || !isCurrentPanelTab(taskTabId)) throw new Error('任务已停止');
    if (nativeHarnessBridge.connected) {
      await sendHarnessBridgeCommand('bind', { tabId: tab.id });
      nativeTargetBound = true;
      await runNativeHarnessTask(task, signal, taskTabId);
      return;
    }
    const snapshot = await getHarnessPageSnapshot(tab.id, signal);
    updateHarnessSnapshotCard(snapshot, taskTabId);
    if (isCurrentPanelTab(taskTabId)) setHarnessConnectionState('connected', '正在规划动作…');

    const client = createHarnessClient({
      maxWaitMs: 90000,
      timeoutMs: 20000
    });
    await client.describe({ signal });

    let sessionId = (getPanelState(taskTabId) || {}).harnessSessionId || '';
    let previousResults = [];
    let lastMessage = '';
    let completed = false;

    for (let round = 0; round < 5; round += 1) {
      if (signal.aborted) throw new Error('任务已停止');
      if (round > 0) {
        const refreshed = await getHarnessPageSnapshot(tab.id, signal);
        updateHarnessSnapshotCard(refreshed, taskTabId);
      }
      const prompt = DeepSeekHarnessProtocol.buildBrowserTaskPrompt({
        task,
        snapshot: (getPanelState(taskTabId) || {}).harnessSnapshot || snapshot,
        continuation: round > 0,
        previousResults
      });
      appendHarnessLog('第 ' + (round + 1) + ' 轮：请求 Harness 规划…', '', taskTabId);
      const response = await client.runPrompt(prompt, { sessionId, signal, maxWaitMs: 90000 });
      sessionId = response.sessionId;
      setHarnessSessionForTab(taskTabId, sessionId);

      const parsed = DeepSeekHarnessProtocol.parseBrowserActionResponse(response.text);
      lastMessage = parsed.message || '';
      if (lastMessage) appendHarnessLog(lastMessage, 'result', taskTabId);
      if (!parsed.actions.length) {
        completed = parsed.done;
        if (!parsed.message) appendHarnessLog('Harness 没有返回可执行动作。', 'result', taskTabId);
        break;
      }

      appendHarnessLog('模型提议 ' + parsed.actions.length + ' 个动作：' +
        parsed.actions.map(DeepSeekHarnessProtocol.actionLabel).join('、'), '', taskTabId);
      if (!harnessAutoRun.checked) {
        appendHarnessLog(JSON.stringify(parsed.actions, null, 2), 'result', taskTabId);
        setHarnessStatus('动作已生成，但“自动执行模型动作”处于关闭状态。', '', taskTabId);
        break;
      }

      previousResults = [];
      for (const action of parsed.actions) {
        if (signal.aborted) throw new Error('任务已停止');
        appendHarnessLog('执行：' + DeepSeekHarnessProtocol.actionLabel(action), 'action', taskTabId);
        try {
          const result = await executeHarnessAction(tab.id, action);
          previousResults.push({ action, ok: true, result: result || null });
          await waitForHarnessAction(action);
        } catch (error) {
          previousResults.push({ action, ok: false, error: error.message });
          appendHarnessLog('动作失败：' + error.message, 'error', taskTabId);
          throw error;
        }
      }

      if (parsed.done) {
        completed = true;
        break;
      }
      setHarnessStatus('动作已执行，正在读取页面变化…', '', taskTabId);
    }

    if (isCurrentPanelTab(taskTabId)) setHarnessConnectionState('connected', '已连接');
    setHarnessStatus(completed ? (lastMessage || '任务已完成。') : '已执行本轮动作，可继续描述下一步。', 'success', taskTabId);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (signal.aborted || message === '任务已停止') {
      appendHarnessLog('任务已停止。', 'result', taskTabId);
      setHarnessStatus('任务已停止。', '', taskTabId);
    } else {
      appendHarnessLog(message, 'error', taskTabId);
      if (isCurrentPanelTab(taskTabId)) setHarnessConnectionState('error', '需要检查连接');
      setHarnessStatus(message, 'error', taskTabId);
    }
  } finally {
    if (nativeTargetBound) {
      try { await sendHarnessBridgeCommand('unbind'); } catch (error) {}
    }
    harnessRunning = false;
    harnessAbortController = null;
    harnessRunningTabId = null;
    if (isCurrentPanelTab(taskTabId)) {
      harnessRunBtn.textContent = '运行任务';
      harnessRefreshSnapshotBtn.disabled = false;
    }
    if (currentApp === 'harness' && currentTabId !== null) {
      harnessRunBtn.disabled = false;
      harnessRunBtn.textContent = '运行任务';
      harnessRefreshSnapshotBtn.disabled = false;
      activateHarnessPanel(false, currentTabId);
    }
  }
}

function queryTabById(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, tab => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!tab || typeof tab.id !== 'number') {
        reject(new Error('未找到当前标签页'));
        return;
      }
      resolve(tab);
    });
  });
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

      if (!isCurrentPanelTab(pickingTabId)) {
        pickCancelled = true;
        break;
      }

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
    activateHarnessPanel(true, currentTabId);
    return;
  }
  const frame = frameGroupForTab(currentTabId, false)?.get(currentApp);
  if (!frame) return;
  loadedAppsForTab(currentTabId, true).delete(currentApp);
  loading.classList.remove('hidden');
  frame.src = frame.src;
  hideLoadingIfStillWaiting(currentApp, currentTabId);
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
harnessTask.addEventListener('input', () => {
  const state = getPanelState(currentTabId);
  if (state) state.harnessTask = harnessTask.value;
});
harnessAutoRun.addEventListener('change', () => {
  const state = getPanelState(currentTabId);
  if (state) state.harnessAutoRun = harnessAutoRun.checked;
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + ZOOM_STEP); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - ZOOM_STEP); }
});

setTimeout(() => loading.classList.add('hidden'), 8000);

// Restore saved state (last, in case storage API fails)
(async () => {
  await loadAppVisibility();
  renderAppButtons();
  let initialTab = null;
  try {
    initialTab = await queryActiveTab();
    currentWindowId = initialTab.windowId;
  } catch (e) {
    initialTab = null;
  }
  const result = await readLocalStorage([HARNESS_URL_KEY, HARNESS_TOKEN_KEY]);
  try {
    currentHarnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(result[HARNESS_URL_KEY]);
  } catch (e) {
    currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
  }
  currentHarnessToken = typeof result[HARNESS_TOKEN_KEY] === 'string'
    ? result[HARNESS_TOKEN_KEY] : '';
  await loadPanelStateStore(initialTab && initialTab.id);
  updateHarnessEndpoint();
  tabLifecycleReady = true;
  const pending = pendingActiveTab;
  pendingActiveTab = null;
  if (pending && (currentWindowId === null || pending.windowId === currentWindowId)) {
    await scheduleTabActivation(pending.tabId, pending.windowId);
  } else if (initialTab && Number.isSafeInteger(initialTab.id)) {
    await scheduleTabActivation(initialTab.id, initialTab.windowId);
  }
})();
