const LOG_PREFIX = '[SIDEPANEL]';
const log = (...args) => { try { console.log(LOG_PREFIX, ...args); } catch(e) {} };

const webviewContainer = document.getElementById('webview-container');
const loading = document.getElementById('loading');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const reloadBtn = document.getElementById('refresh');
const zoomLabel = document.getElementById('zoom-label');

const ZOOM_KEY = 'deepseek-sidebar-zoom';
const APP_KEY = 'deepseek-sidebar-app';
const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';
const IFRAME_ALLOW = 'clipboard-read; clipboard-write; autoplay';

const APPS = {
  deepseek: { url: 'https://chat.deepseek.com/' },
  zhipu: { url: 'https://chat.z.ai/' },
  qianwen: { url: 'https://www.qianwen.com/' },
  kimi: { url: 'https://www.kimi.com/' },
  chatgpt: { url: 'https://chatgpt.com/' },
  gemini: { url: 'https://gemini.google.com/app' }
};

let currentZoom = 100;
let currentApp = null;
const appButtons = document.querySelectorAll('.app-btn');
const frames = new Map();
const loadedApps = new Set();

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

function monitorIframeUnload(frame, appId) {
  try {
    const win = frame.contentWindow;
    if (win) {
      win.addEventListener('unload', () => {
        log('!!! IFRAME contentWindow UNLOAD !!! app:', appId, 'src:', frame.src);
      });
      win.addEventListener('beforeunload', () => {
        log('!!! IFRAME contentWindow BEFOREUNLOAD !!! app:', appId, 'src:', frame.src);
      });
    }
  } catch(e) {
    // cross-origin, expected
  }
}

function setupFrameMonitoring(frame, appId) {
  let loadCount = 0;
  let lastSrc = '';

  frame.addEventListener('load', () => {
    loadCount++;
    loadedApps.add(appId);
    const newSrc = frame.src;
    log('iframe LOAD #' + loadCount, 'app:', appId, 'src:', newSrc, 'previous:', lastSrc);
    if (lastSrc && newSrc !== lastSrc) {
      log('!!! IFRAME SRC CHANGED !!! app:', appId, 'from:', lastSrc, 'to:', newSrc);
      log('!!! Stack:', new Error().stack);
    }
    lastSrc = newSrc;
    if (currentApp === appId) loading.classList.add('hidden');
  });

  frame.addEventListener('load', () => monitorIframeUnload(frame, appId));

  setInterval(() => {
    if (frame.src !== lastSrc) {
      log('!!! IFRAME SRC CHANGED (poll) !!! app:', appId, 'from:', lastSrc, 'to:', frame.src);
      log('!!! Stack:', new Error().stack);
      lastSrc = frame.src;
    }
  }, 500);
}

function getOrCreateFrame(appId) {
  const existingFrame = frames.get(appId);
  if (existingFrame) return existingFrame;

  const app = APPS[appId];
  const frame = document.createElement('iframe');
  frame.className = 'webview-frame hidden';
  frame.dataset.app = appId;
  frame.setAttribute('sandbox', IFRAME_SANDBOX);
  frame.setAttribute('allow', IFRAME_ALLOW);
  setupFrameMonitoring(frame, appId);
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
  log('switchApp:', appId, '->', app.url);
  currentApp = appId;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === appId));
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

// Bind all event listeners first (before any potentially failing async/storage calls)
appButtons.forEach(btn => {
  btn.addEventListener('click', () => switchApp(btn.dataset.app));
});
zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
reloadBtn.addEventListener('click', () => {
  const frame = frames.get(currentApp);
  if (!frame) return;
  loadedApps.delete(currentApp);
  loading.classList.remove('hidden');
  frame.src = frame.src;
  hideLoadingIfStillWaiting(currentApp);
});
zoomLabel.addEventListener('dblclick', () => applyZoom(100));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + ZOOM_STEP); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - ZOOM_STEP); }
});

// Monitor visibility of sidepanel itself
document.addEventListener('visibilitychange', () => {
  log('!!! SIDEPANEL visibilitychange:', document.visibilityState, 'hidden:', document.hidden);
});

setTimeout(() => loading.classList.add('hidden'), 8000);

log('sidepanel initialized');

// Restore saved state (last, in case storage API fails)
try {
  chrome.storage.local.get([ZOOM_KEY, APP_KEY], (result) => {
    log('restored state:', result);
    switchApp(result[APP_KEY] || 'deepseek');
    applyZoom(result[ZOOM_KEY] || 100);
  });
} catch (e) {
  switchApp('deepseek');
  applyZoom(100);
}
