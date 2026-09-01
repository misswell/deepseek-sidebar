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

const ZOOM_KEY = 'deepseek-sidebar-zoom';
const APP_KEY = 'deepseek-sidebar-app';
const VISIBILITY_KEY = 'deepseek-sidebar-visibility';
const ORDER_KEY = 'deepseek-sidebar-order';
const HARNESS_URL_KEY = 'deepseek-sidebar-harness-url';
const HARNESS_TOKEN_KEY = 'deepseek-sidebar-harness-token';
const HARNESS_SESSION_KEY = 'deepseek-sidebar-harness-session';
const TAB_STATE_KEY = 'deepseek-sidebar-tab-states';
const TAB_STATE_VERSION_KEY = 'deepseek-sidebar-tab-state-version';
const TAB_STATE_VERSION = 3;
const HARNESS_BRIDGE_SOURCE = 'deepseek-sidebar-harness-bridge';
const PANEL_CONTEXT_SOURCE = 'deepseek-sidebar-panel-context';
const FRAME_ROUTE_SOURCE = 'deepseek-sidebar-frame-route';
const FRAME_ROUTE_INIT_SOURCE = 'deepseek-sidebar-frame-route-init';
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
let panelBoundTabId = null;
let currentPageText = '';
let currentHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
let configuredHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
let currentHarnessToken = '';
let nativeHarnessBridge = { state: 'stopped', connected: false, caps: null, error: '' };
let harnessBridgePort = null;
let harnessTargetBoundTabId = null;
let harnessTargetBindingQueue = Promise.resolve();
let harnessActivationSequence = 0;
let pickingTabId = null;
let pickCancelled = false;
let pickWaitResolver = null;
let pickPendingNavigation = false;
let tabPanelStates = new Map();
let persistedTabStates = {};
let tabStateStorageWrite = Promise.resolve();
let tabLifecycleReady = false;
let pendingActiveTab = null;
let tabActivationQueue = Promise.resolve();
let activeTabSyncTimer = null;
const ACTIVE_TAB_SYNC_INTERVAL_MS = 500;
let harnessUrlDiscoveryPromise = null;
let harnessUrlDiscoveryTarget = '';
let lastHarnessUrlDiscoveryAt = 0;
const HARNESS_URL_DISCOVERY_TTL_MS = 3000;
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
    frameUrls: { ...normalized.frameUrls },
    pageText: '',
    pageReader: {
      hidden: true,
      expanded: false,
      title: '当前页面内容',
      meta: '',
      status: ''
    }
  };
}

function getPanelState(tabId) {
  const id = numericTabId(tabId);
  if (id === null) return null;
  if (!tabPanelStates.has(id)) {
    tabPanelStates.set(id, createPanelState(id, DeepSeekSidebarTabState.getTabState(persistedTabStates, id)));
  }
  const state = tabPanelStates.get(id);
  if (!APPS[state.app]) state.app = DeepSeekSidebarTabState.DEFAULT_APP;
  return state;
}

function firstVisibleApp() {
  const orderedIds = appOrder.length > 0 ? appOrder : APP_META.map(app => app.id);
  return orderedIds.find(id => appVisibility[id] !== false) || DeepSeekSidebarTabState.DEFAULT_APP;
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

function queueTabStateStorageWrite(tabId) {
  const id = numericTabId(tabId);
  const key = DeepSeekSidebarContext.stateStorageKey(id);
  const state = DeepSeekSidebarTabState.getTabState(persistedTabStates, id);
  if (!key || !state) return tabStateStorageWrite;
  const snapshot = JSON.parse(JSON.stringify(state));
  tabStateStorageWrite = tabStateStorageWrite
    .catch(() => {})
    .then(() => new Promise(resolve => {
      try {
        chrome.storage.local.set({ [key]: snapshot }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (error) {
        resolve();
      }
    }));
  return tabStateStorageWrite;
}

function removeStoredTabState(tabId) {
  const key = DeepSeekSidebarContext.stateStorageKey(tabId);
  if (!key) return;
  try {
    chrome.storage.local.remove(key, () => { void chrome.runtime.lastError; });
  } catch (error) {}
}

function queueAllTabStateStorageWrites() {
  Object.keys(persistedTabStates).forEach(tabId => queueTabStateStorageWrite(tabId));
  return tabStateStorageWrite;
}

function persistPanelState(tabId) {
  const state = getPanelState(tabId);
  const id = numericTabId(tabId);
  if (!state || id === null) return;
  persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, id, {
    app: state.app,
    zoom: state.zoom,
    harnessSessionId: state.harnessSessionId,
    frameUrls: state.frameUrls
  });
  queueTabStateStorageWrite(id);
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

function resolvePanelContext() {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ source: PANEL_CONTEXT_SOURCE }, response => {
        void chrome.runtime.lastError;
        const value = response && response.ok ? response.value : null;
        const tabId = numericTabId(value && value.tabId);
        resolve(tabId === null ? null : {
          tabId,
          windowId: Number.isSafeInteger(value.windowId) ? value.windowId : null
        });
      });
    } catch (error) {
      resolve(null);
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
  const result = await readLocalStorage(null);
  persistedTabStates = DeepSeekSidebarTabState.normalizeMap(result[TAB_STATE_KEY]);
  Object.entries(result).forEach(([key, value]) => {
    const tabId = DeepSeekSidebarContext.tabIdFromStateStorageKey(key);
    if (tabId !== null) {
      persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, tabId, value);
    }
  });
  const storedTabStateVersion = Number(result[TAB_STATE_VERSION_KEY]) || 0;
  if (storedTabStateVersion < TAB_STATE_VERSION) {
    Object.entries(persistedTabStates).forEach(([tabId, state]) => {
      if (state.app === 'deepseek') {
        persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, tabId, {
          app: DeepSeekSidebarTabState.DEFAULT_APP
        });
      }
    });
  }
  const initialId = numericTabId(initialTabId);
  const initialKey = initialId === null ? null : String(initialId);
  const hasLegacyState = result[APP_KEY] || result[ZOOM_KEY] || result[HARNESS_SESSION_KEY];
  if (initialKey !== null && !persistedTabStates[initialKey] && hasLegacyState) {
    persistedTabStates = DeepSeekSidebarTabState.setTabState(persistedTabStates, initialId, {
      app: storedTabStateVersion < TAB_STATE_VERSION && result[APP_KEY] === 'deepseek'
        ? DeepSeekSidebarTabState.DEFAULT_APP : result[APP_KEY],
      zoom: result[ZOOM_KEY],
      harnessSessionId: result[HARNESS_SESSION_KEY]
    });
  }
  if (storedTabStateVersion < TAB_STATE_VERSION) {
    queueAllTabStateStorageWrites().then(() => {
      try { chrome.storage.local.remove(TAB_STATE_KEY); } catch (error) {}
    });
    try {
      chrome.storage.local.set({ [TAB_STATE_VERSION_KEY]: TAB_STATE_VERSION }, () => {
        void chrome.runtime.lastError;
      });
    } catch (error) {}
  }
  const openTabIds = await readOpenTabIds();
  if (openTabIds) {
    Object.keys(persistedTabStates).forEach(tabId => {
      if (!openTabIds.has(Number(tabId))) {
        persistedTabStates = DeepSeekSidebarTabState.removeTabState(persistedTabStates, tabId);
        removeStoredTabState(tabId);
      }
    });
  }
  tabPanelStates.clear();
  Object.entries(persistedTabStates).forEach(([tabId, state]) => {
    const id = numericTabId(tabId);
    if (id !== null) tabPanelStates.set(id, createPanelState(id, state));
  });
}

function captureCurrentPanelState() {
  const state = getPanelState(currentTabId);
  if (!state) return;
  if (currentApp) state.app = currentApp;
  state.zoom = currentZoom;
  state.pageText = currentPageText || '';
  state.pageReader = {
    hidden: pageReader.classList.contains('hidden'),
    expanded: pageReader.classList.contains('expanded'),
    title: pageReaderTitle.textContent || '当前页面内容',
    meta: pageReaderMeta.textContent || '',
    status: pageReaderStatus.textContent || ''
  };
}

function persistCurrentPanelState() {
  if (currentTabId === null) return;
  captureCurrentPanelState();
  persistPanelState(currentTabId);
}

function restorePanelState(tabId) {
  const state = getPanelState(tabId);
  if (!state) return;
  currentApp = state.app;
  currentZoom = state.zoom;
  currentPageText = state.pageText || '';
  pageReaderTitle.textContent = state.pageReader.title || '当前页面内容';
  pageReaderMeta.textContent = state.pageReader.meta || '';
  pageReaderContent.value = currentPageText;
  pageReaderStatus.textContent = state.pageReader.status || '';
  pageReader.classList.toggle('hidden', state.pageReader.hidden !== false);
  setPageReaderExpanded(state.pageReader.expanded === true);
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

function resetAppFrames(appId) {
  frameGroups.forEach((group, tabId) => {
    const frame = group.get(appId);
    if (frame) frame.remove();
    group.delete(appId);
    const loadedApps = loadedAppGroups.get(tabId);
    if (loadedApps) loadedApps.delete(appId);
  });
  tabPanelStates.forEach(state => {
    if (state.frameUrls && state.frameUrls[appId]) delete state.frameUrls[appId];
  });
  Object.keys(persistedTabStates).forEach(tabId => {
    persistedTabStates = DeepSeekSidebarTabState.setFrameUrl(persistedTabStates, tabId, appId, '');
  });
  queueAllTabStateStorageWrites();
}

function setEffectiveHarnessUrl(url, render) {
  let normalized;
  try {
    normalized = DeepSeekHarnessProtocol.normalizeHarnessUrl(url);
  } catch (error) {
    return false;
  }
  if (normalized === currentHarnessUrl) return false;
  currentHarnessUrl = normalized;
  if (tabLifecycleReady) {
    resetAppFrames('harness');
    if (render !== false && currentApp === 'harness') renderCurrentApp();
  }
  return true;
}

function resolveConfiguredHarnessUrl(options) {
  const config = options || {};
  if (!DeepSeekHarnessProtocol.isLocalHarnessDiscoveryTarget(configuredHarnessUrl)) {
    return Promise.resolve(currentHarnessUrl);
  }
  const now = Date.now();
  if (!config.force && harnessUrlDiscoveryTarget === configuredHarnessUrl &&
      now - lastHarnessUrlDiscoveryAt < HARNESS_URL_DISCOVERY_TTL_MS) {
    return Promise.resolve(currentHarnessUrl);
  }
  if (harnessUrlDiscoveryPromise && harnessUrlDiscoveryTarget === configuredHarnessUrl) {
    return harnessUrlDiscoveryPromise;
  }

  const target = configuredHarnessUrl;
  const request = sendHarnessBridgeCommand('resolve', { baseUrl: target });
  harnessUrlDiscoveryTarget = target;
  harnessUrlDiscoveryPromise = request.then(result => {
    if (target !== configuredHarnessUrl || !result || typeof result.baseUrl !== 'string') {
      return currentHarnessUrl;
    }
    setEffectiveHarnessUrl(result.baseUrl);
    return currentHarnessUrl;
  }).catch(() => currentHarnessUrl).finally(() => {
    if (harnessUrlDiscoveryTarget === target) {
      lastHarnessUrlDiscoveryAt = Date.now();
      harnessUrlDiscoveryPromise = null;
    }
  });
  return harnessUrlDiscoveryPromise;
}

function isHarnessFrameUrl(url) {
  try {
    const base = new URL(currentHarnessUrl);
    const candidate = new URL(url);
    if (candidate.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    return !basePath || candidate.pathname === basePath || candidate.pathname.startsWith(basePath + '/');
  } catch (error) {
    return false;
  }
}

function isAppFrameUrl(appId, url) {
  if (appId === 'harness') return isHarnessFrameUrl(url);
  const app = APPS[appId];
  if (!app || !app.url) return false;
  try {
    const base = new URL(app.url);
    const candidate = new URL(url);
    return candidate.origin === base.origin;
  } catch (error) {
    return false;
  }
}

function frameUrlForApp(appId, tabId) {
  const state = getPanelState(tabId);
  const savedUrl = state && state.frameUrls ? state.frameUrls[appId] : '';
  if (savedUrl && isAppFrameUrl(appId, savedUrl)) return savedUrl;
  if (appId === 'harness') return currentHarnessUrl;
  return APPS[appId] && APPS[appId].url ? APPS[appId].url : '';
}

function persistFrameRoute(tabId, appId, url, frame) {
  const targetTabId = numericTabId(tabId);
  const state = getPanelState(targetTabId);
  const normalizedUrl = DeepSeekSidebarTabState.normalizeFrameUrl(url);
  if (!state || !normalizedUrl || !isAppFrameUrl(appId, normalizedUrl)) return;
  if (state.frameUrls[appId] === normalizedUrl) return;
  state.frameUrls[appId] = normalizedUrl;
  if (frame) frame.dataset.currentUrl = normalizedUrl;
  persistPanelState(targetTabId);
}

function handleFrameRouteMessage(event) {
  const data = event && event.data;
  if (!data || data.source !== FRAME_ROUTE_SOURCE || typeof data.url !== 'string') return;
  for (const [tabId, group] of frameGroups.entries()) {
    for (const [appId, frame] of group.entries()) {
      if (frame.contentWindow !== event.source) continue;
      persistFrameRoute(tabId, appId, data.url, frame);
      return;
    }
  }
}

window.addEventListener('message', handleFrameRouteMessage, true);

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
  const changedTab = currentTabId !== id;

  if (pickingTabId !== null && pickingTabId !== id) {
    pickCancelled = true;
    void executeElementPickCancel(pickingTabId);
    if (pickWaitResolver) pickWaitResolver('cancelled');
  }
  persistCurrentPanelState();
  currentTabId = id;
  if (windowId !== undefined) currentWindowId = windowId;
  restorePanelState(id);
  const state = ensureVisibleApp(id);
  if (state) currentApp = state.app;
  renderAppButtons();
  renderCurrentApp();
  if (changedTab && currentApp === 'harness') void resolveConfiguredHarnessUrl();
}

function forgetTabState(tabId) {
  const id = numericTabId(tabId);
  if (id === null) return;
  if (currentTabId === id) captureCurrentPanelState();
  if (harnessTargetBoundTabId === id) unbindHarnessTarget();
  tabPanelStates.delete(id);
  persistedTabStates = DeepSeekSidebarTabState.removeTabState(persistedTabStates, id);
  removeTabFrames(id);
  removeStoredTabState(id);
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
    if (harnessTargetBoundTabId === oldId) void unbindHarnessTarget();
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
    queueTabStateStorageWrite(newId);
    removeStoredTabState(oldId);
    if (wasCurrent) {
      currentTabId = null;
      scheduleTabActivation(newId, currentWindowId);
    }
  });
}

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
  Object.entries(changes).forEach(([key, change]) => {
    const tabId = DeepSeekSidebarContext.tabIdFromStateStorageKey(key);
    if (tabId === null) return;
    if (change && change.newValue) {
      persistedTabStates = DeepSeekSidebarTabState.setTabState(
        persistedTabStates,
        tabId,
        change.newValue
      );
    } else {
      persistedTabStates = DeepSeekSidebarTabState.removeTabState(persistedTabStates, tabId);
    }
  });
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
    let nextHarnessUrl;
    try {
      nextHarnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(changes[HARNESS_URL_KEY].newValue);
    } catch (e) {
      nextHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
    }
    configuredHarnessUrl = nextHarnessUrl;
    const effectiveUrlChanged = setEffectiveHarnessUrl(nextHarnessUrl);
    if (effectiveUrlChanged && currentApp === 'harness' && !tabLifecycleReady) renderCurrentApp();
    void resolveConfiguredHarnessUrl({ force: true });
  }
  if (changes[HARNESS_TOKEN_KEY]) {
    currentHarnessToken = typeof changes[HARNESS_TOKEN_KEY].newValue === 'string'
      ? changes[HARNESS_TOKEN_KEY].newValue : '';
    if (currentApp === 'harness') activateHarnessBridge(currentTabId);
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
    try {
      frame.contentWindow.postMessage({ source: FRAME_ROUTE_INIT_SOURCE }, '*');
    } catch (error) {}
    loadedAppsForTab(tabId, true).add(appId);
    persistFrameRoute(tabId, appId, frame.dataset.currentUrl || frame.getAttribute('src') || frame.src, frame);
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
  if (!app) return null;
  const frameUrl = frameUrlForApp(appId, targetTabId);
  if (!frameUrl) return null;
  const frame = document.createElement('iframe');
  frame.className = 'webview-frame hidden';
  if (appId === 'harness') frame.classList.add('harness-page-frame');
  frame.dataset.app = appId;
  frame.dataset.tabId = String(targetTabId);
  frame.dataset.currentUrl = frameUrl;
  frame.setAttribute('allow', IFRAME_ALLOW);
  frame.removeAttribute('sandbox');
  setupFrameLoadState(frame, appId, targetTabId);
  const state = getPanelState(targetTabId);
  applyZoomToFrame(frame, state ? state.zoom : currentZoom);
  webviewContainer.appendChild(frame);
  group.set(appId, frame);
  frame.src = frameUrl;
  hideLoadingIfStillWaiting(appId, targetTabId);
  return frame;
}

function queueHarnessTargetOperation(operation) {
  const next = harnessTargetBindingQueue.catch(() => {}).then(operation);
  harnessTargetBindingQueue = next.catch(() => {});
  return next;
}

function bindHarnessTargetForTab(tabId) {
  const targetTabId = numericTabId(tabId);
  if (targetTabId === null) return Promise.resolve(false);
  return queueHarnessTargetOperation(async () => {
    if (!nativeHarnessBridge.connected || !isCurrentPanelTab(targetTabId) || currentApp !== 'harness') {
      return false;
    }
    const tab = await queryTabById(targetTabId);
    if (unsupportedAutomationUrl(tab.url)) {
      throw new Error('当前标签页不是可操作的普通网页');
    }
    if (!(await ensureAutomationPermission(tab))) {
      throw new Error('需要允许扩展访问当前网页，才能让 Harness 操作它。');
    }
    if (!nativeHarnessBridge.connected || !isCurrentPanelTab(targetTabId) || currentApp !== 'harness') {
      return false;
    }
    if (harnessTargetBoundTabId === targetTabId) return true;
    if (harnessTargetBoundTabId !== null) {
      try { await sendHarnessBridgeCommand('unbind'); } catch (error) {}
      harnessTargetBoundTabId = null;
    }
    if (!nativeHarnessBridge.connected || !isCurrentPanelTab(targetTabId) || currentApp !== 'harness') {
      return false;
    }
    await sendHarnessBridgeCommand('bind', { tabId: targetTabId });
    if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') {
      try { await sendHarnessBridgeCommand('unbind'); } catch (error) {}
      harnessTargetBoundTabId = null;
      return false;
    }
    harnessTargetBoundTabId = targetTabId;
    return true;
  });
}

function unbindHarnessTarget() {
  const hadBoundTarget = harnessTargetBoundTabId !== null;
  harnessTargetBoundTabId = null;
  return queueHarnessTargetOperation(async () => {
    if (!hadBoundTarget && !nativeHarnessBridge.connected) return false;
    try { await sendHarnessBridgeCommand('unbind'); } catch (error) {}
    return true;
  });
}

async function activateHarnessBridge(tabId) {
  const targetTabId = numericTabId(tabId === undefined ? currentTabId : tabId);
  if (!isCurrentPanelTab(targetTabId) || currentApp !== 'harness') return;
  const activation = ++harnessActivationSequence;
  const isActive = () => activation === harnessActivationSequence &&
    isCurrentPanelTab(targetTabId) && currentApp === 'harness';
  try {
    const started = await sendHarnessBridgeCommand('start', {
      baseUrl: currentHarnessUrl,
      token: currentHarnessToken
    });
    if (!isActive()) return;
    const effectiveUrlChanged = started && typeof started.baseUrl === 'string'
      ? setEffectiveHarnessUrl(started.baseUrl, false) : false;
    applyHarnessBridgeStatus(started);
    if (effectiveUrlChanged && isActive()) {
      hideAllFrames();
      renderFrameApp('harness', targetTabId);
    }
    const connected = await waitForNativeHarnessBridge(1800);
    if (!isActive()) return;
    if (!connected) {
      try {
        const stopped = await sendHarnessBridgeCommand('stop');
        applyHarnessBridgeStatus(stopped);
      } catch (error) {}
      return;
    }
    await bindHarnessTargetForTab(targetTabId);
  } catch (error) {
    if (!isActive()) return;
    try {
      const stopped = await sendHarnessBridgeCommand('stop');
      applyHarnessBridgeStatus(stopped);
    } catch (stopError) {}
    void error;
  }
}

function hideAllFrames() {
  frameGroups.forEach(group => group.forEach(frame => frame.classList.add('hidden')));
}

function renderFrameApp(appId, tabId) {
  const frame = getOrCreateFrame(appId, tabId);
  const group = frameGroupForTab(tabId, false);
  if (!frame || !group) return;
  group.forEach((item, id) => item.classList.toggle('hidden', id !== appId));
  const state = getPanelState(tabId);
  const zoom = state ? state.zoom : currentZoom;
  group.forEach(item => applyZoomToFrame(item, zoom));
  if ((loadedAppsForTab(tabId, false) || new Set()).has(appId)) loading.classList.add('hidden');
  else {
    loading.classList.remove('hidden');
    hideLoadingIfStillWaiting(appId, tabId);
  }
}

function renderCurrentApp() {
  const state = ensureVisibleApp(currentTabId);
  if (!state) return;
  currentApp = state.app;
  if (!APPS[currentApp]) return;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === currentApp));
  hideAllFrames();
  if (currentApp === 'harness') {
    renderFrameApp(currentApp, currentTabId);
    activateHarnessBridge(currentTabId);
    return;
  }
  harnessActivationSequence += 1;
  void unbindHarnessTarget();
  renderFrameApp(currentApp, currentTabId);
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

function applyHarnessBridgeStatus(status) {
  if (!status || status.source !== HARNESS_BRIDGE_SOURCE) return;
  nativeHarnessBridge = {
    state: status.state || 'stopped',
    connected: status.connected === true,
    caps: status.caps || null,
    error: status.error || '',
    targetTabId: numericTabId(status.targetTabId)
  };
  if (Object.prototype.hasOwnProperty.call(status, 'targetTabId')) {
    harnessTargetBoundTabId = nativeHarnessBridge.targetTabId;
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

function queryActiveTabWith(query, missingMessage) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.query(query, (tabs) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!tabs || !tabs[0] || typeof tabs[0].id !== 'number') {
          reject(new Error(missingMessage));
          return;
        }
        resolve(tabs[0]);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function queryActiveTab() {
  return queryActiveTabWith(
    { active: true, lastFocusedWindow: true },
    '未找到当前标签页'
  );
}

function queryPanelActiveTab() {
  if (panelBoundTabId !== null) return queryTabById(panelBoundTabId);
  const query = currentWindowId !== null
    ? { active: true, windowId: currentWindowId }
    : { active: true, lastFocusedWindow: true };
  return queryActiveTabWith(query, '未找到当前窗口的活动标签页');
}

const activeTabSynchronizer = DeepSeekSidebarTabState.createActiveTabSynchronizer({
  getCurrentTabId: () => currentTabId,
  getActiveTab: queryPanelActiveTab,
  onActivate: tab => scheduleTabActivation(tab.id, tab.windowId)
});

function reconcileActiveTab() {
  if (!tabLifecycleReady) return Promise.resolve(false);
  return activeTabSynchronizer.reconcile().catch(() => false);
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
    const frame = frameGroupForTab(currentTabId, false)?.get(currentApp);
    if (frame) {
      loadedAppsForTab(currentTabId, true).delete(currentApp);
      loading.classList.remove('hidden');
      const frameUrl = frame.dataset.currentUrl || frameUrlForApp(currentApp, currentTabId);
      frame.src = frameUrl;
      hideLoadingIfStillWaiting(currentApp, currentTabId);
    }
    activateHarnessBridge(currentTabId);
    return;
  }
  const frame = frameGroupForTab(currentTabId, false)?.get(currentApp);
  if (!frame) return;
  loadedAppsForTab(currentTabId, true).delete(currentApp);
  loading.classList.remove('hidden');
  frame.src = frame.dataset.currentUrl || frame.src;
  hideLoadingIfStillWaiting(currentApp, currentTabId);
});
zoomLabel.addEventListener('dblclick', () => applyZoom(100));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + ZOOM_STEP); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - ZOOM_STEP); }
});

window.addEventListener('pagehide', () => {
  persistCurrentPanelState();
});

setTimeout(() => loading.classList.add('hidden'), 8000);

// Restore saved state (last, in case storage API fails)
(async () => {
  await loadAppVisibility();
  renderAppButtons();
  const panelContext = await resolvePanelContext();
  if (panelContext) {
    panelBoundTabId = panelContext.tabId;
    currentWindowId = panelContext.windowId;
  } else {
    bindTabLifecycleListeners();
  }
  let initialTab = null;
  try {
    initialTab = panelBoundTabId === null
      ? await queryActiveTab()
      : await queryTabById(panelBoundTabId);
    currentWindowId = initialTab.windowId;
  } catch (e) {
    initialTab = null;
  }
  const result = await readLocalStorage([HARNESS_URL_KEY, HARNESS_TOKEN_KEY]);
  try {
    configuredHarnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(result[HARNESS_URL_KEY]);
  } catch (e) {
    configuredHarnessUrl = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;
  }
  currentHarnessUrl = configuredHarnessUrl;
  currentHarnessToken = typeof result[HARNESS_TOKEN_KEY] === 'string'
    ? result[HARNESS_TOKEN_KEY] : '';
  await resolveConfiguredHarnessUrl({ force: true });
  await loadPanelStateStore(initialTab && initialTab.id);
  tabLifecycleReady = true;
  const pending = pendingActiveTab;
  pendingActiveTab = null;
  if (pending && (currentWindowId === null || pending.windowId === currentWindowId)) {
    await scheduleTabActivation(pending.tabId, pending.windowId);
  } else if (initialTab && Number.isSafeInteger(initialTab.id)) {
    await scheduleTabActivation(initialTab.id, initialTab.windowId);
  }
  if (panelBoundTabId === null && activeTabSyncTimer === null) {
    activeTabSyncTimer = setInterval(() => {
      void reconcileActiveTab();
    }, ACTIVE_TAB_SYNC_INTERVAL_MS);
  }
})();
