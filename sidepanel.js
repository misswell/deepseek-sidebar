const LOG_PREFIX = '[SIDEPANEL]';
const log = (...args) => { try { console.log(LOG_PREFIX, ...args); } catch(e) {} };

const iframe = document.getElementById('webview');
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

const APPS = {
  deepseek: { url: 'https://chat.deepseek.com/' },
  qianwen: { url: 'https://www.qianwen.com/' },
  chatgpt: { url: 'https://chatgpt.com/' },
  gemini: { url: 'https://gemini.google.com/app' }
};

let currentZoom = 100;
let currentApp = null;
const appButtons = document.querySelectorAll('.app-btn');

function switchApp(appId) {
  const app = APPS[appId];
  if (!app) return;
  log('switchApp:', appId, '->', app.url);
  currentApp = appId;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === appId));
  iframe.src = app.url;
  applyZoom(currentZoom);
  try { chrome.storage.local.set({ [APP_KEY]: appId }); } catch (e) {}
}

function applyZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const scale = currentZoom / 100;
  iframe.style.transform = 'scale(' + scale + ')';
  iframe.style.width = (100 / scale) + '%';
  iframe.style.height = (100 / scale) + '%';
  zoomLabel.textContent = currentZoom + '%';
  try { chrome.storage.local.set({ [ZOOM_KEY]: currentZoom }); } catch (e) {}
}

// Bind all event listeners first (before any potentially failing async/storage calls)
appButtons.forEach(btn => {
  btn.addEventListener('click', () => switchApp(btn.dataset.app));
});
zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
reloadBtn.addEventListener('click', () => { iframe.src = iframe.src; });
zoomLabel.addEventListener('dblclick', () => applyZoom(100));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + ZOOM_STEP); }
  else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - ZOOM_STEP); }
});

// ---- IFRAME NAVIGATION MONITORING ----
let iframeLoadCount = 0;
let lastIframeSrc = '';

iframe.addEventListener('load', () => {
  iframeLoadCount++;
  const newSrc = iframe.src;
  log('iframe LOAD #' + iframeLoadCount, 'src:', newSrc, 'previous:', lastIframeSrc);
  if (lastIframeSrc && newSrc !== lastIframeSrc) {
    log('!!! IFRAME SRC CHANGED !!! from:', lastIframeSrc, 'to:', newSrc);
    log('!!! Stack:', new Error().stack);
  }
  lastIframeSrc = newSrc;
  loading.classList.add('hidden');
});

// Also monitor via contentWindow unload
const monitorIframeUnload = () => {
  try {
    const win = iframe.contentWindow;
    if (win) {
      win.addEventListener('unload', () => {
        log('!!! IFRAME contentWindow UNLOAD !!! src:', iframe.src);
      });
      win.addEventListener('beforeunload', () => {
        log('!!! IFRAME contentWindow BEFOREUNLOAD !!! src:', iframe.src);
      });
    }
  } catch(e) {
    // cross-origin, expected
  }
};
iframe.addEventListener('load', monitorIframeUnload);

// Poll iframe src for changes
setInterval(() => {
  if (iframe.src !== lastIframeSrc) {
    log('!!! IFRAME SRC CHANGED (poll) !!! from:', lastIframeSrc, 'to:', iframe.src);
    log('!!! Stack:', new Error().stack);
    lastIframeSrc = iframe.src;
  }
}, 500);

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
