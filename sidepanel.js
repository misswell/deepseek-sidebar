const iframe = document.getElementById('webview');
const container = document.getElementById('webview-container');
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
const MOBILE_WIDTH = 430; // fixed virtual width so pages render mobile layout

const APPS = {
  deepseek: { url: 'https://chat.deepseek.com/' },
  qianwen: { url: 'https://www.qianwen.com/' },
  chatgpt: { url: 'https://chatgpt.com/' },
  gemini: { url: 'https://gemini.google.com/app' }
};

let currentZoom = 100;
const appButtons = document.querySelectorAll('.app-btn');

function switchApp(appId) {
  const app = APPS[appId];
  if (!app) return;
  appButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.app === appId));
  iframe.src = app.url;
  applyZoom(currentZoom);
  try { chrome.storage.local.set({ [APP_KEY]: appId }); } catch (e) {}
}

function applyZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  if (!containerWidth || !containerHeight) return;
  const baseScale = containerWidth / MOBILE_WIDTH;
  const userScale = currentZoom / 100;
  const scale = baseScale * userScale;
  iframe.style.width = MOBILE_WIDTH + 'px';
  iframe.style.height = (containerHeight / scale) + 'px';
  iframe.style.transform = 'scale(' + scale + ')';
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

// Recalculate on container resize
new ResizeObserver(() => applyZoom(currentZoom)).observe(container);

iframe.addEventListener('load', () => loading.classList.add('hidden'));
setTimeout(() => loading.classList.add('hidden'), 8000);

// Restore saved state (last, in case storage API fails)
try {
  chrome.storage.local.get([ZOOM_KEY, APP_KEY], (result) => {
    switchApp(result[APP_KEY] || 'deepseek');
    applyZoom(result[ZOOM_KEY] || 100);
  });
} catch (e) {
  switchApp('deepseek');
  applyZoom(100);
}
