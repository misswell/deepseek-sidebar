const iframe = document.getElementById('webview');
const loading = document.getElementById('loading');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const zoomReset = document.getElementById('zoom-reset');
const zoomLabel = document.getElementById('zoom-label');
const container = document.getElementById('webview-container');

const ZOOM_KEY = 'deepseek-sidebar-zoom';
const APP_KEY = 'deepseek-sidebar-app';
const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;

const APPS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    color: '#4a6cf7'
  },
  qianwen: {
    name: '千问',
    url: 'https://tongyi.aliyun.com/qianwen/',
    color: '#6236ff'
  },
  chatgpt: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    color: '#10a37f'
  },
  gemini: {
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    color: '#8e44ad'
  }
};

let currentZoom = 100;
let currentApp = 'deepseek';

// App switcher buttons
const appButtons = document.querySelectorAll('.app-btn');

function setActiveApp(appId) {
  currentApp = appId;
  const app = APPS[appId];

  // Update button active states
  appButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.app === appId);
  });

  // Show loading, hide iframe
  loading.classList.remove('hidden');
  iframe.style.visibility = 'hidden';
  iframe.src = app.url;

  chrome.storage.local.set({ [APP_KEY]: appId });
}

appButtons.forEach(btn => {
  btn.addEventListener('click', () => setActiveApp(btn.dataset.app));
});

// Zoom
function applyZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const scale = currentZoom / 100;
  iframe.style.transform = 'scale(' + scale + ')';
  iframe.style.width = (100 / scale) + '%';
  iframe.style.height = (100 / scale) + '%';
  zoomLabel.textContent = currentZoom + '%';
  iframe.style.visibility = 'visible';
  chrome.storage.local.set({ [ZOOM_KEY]: currentZoom });
}

// Restore saved state
chrome.storage.local.get([ZOOM_KEY, APP_KEY], (result) => {
  const savedApp = result[APP_KEY];
  if (savedApp && APPS[savedApp]) {
    setActiveApp(savedApp);
  } else {
    setActiveApp('deepseek');
  }

  const savedZoom = result[ZOOM_KEY];
  if (savedZoom && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) {
    applyZoom(savedZoom);
  } else {
    applyZoom(100);
  }
});

zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
zoomReset.addEventListener('click', () => applyZoom(100));

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    applyZoom(currentZoom + ZOOM_STEP);
  } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    applyZoom(currentZoom - ZOOM_STEP);
  } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    applyZoom(100);
  }
});

// Hide loading spinner when iframe finishes loading
iframe.addEventListener('load', () => {
  loading.classList.add('hidden');
});

// Also hide after timeout in case load event doesn't fire
setTimeout(() => {
  loading.classList.add('hidden');
}, 8000);
