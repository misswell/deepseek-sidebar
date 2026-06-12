const iframe = document.getElementById('webview');
const loading = document.getElementById('loading');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const zoomReset = document.getElementById('zoom-reset');
const zoomLabel = document.getElementById('zoom-label');
const container = document.getElementById('webview-container');

const STORAGE_KEY = 'deepseek-sidebar-zoom';
const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;

let currentZoom = 100;

function applyZoom(zoom) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const scale = currentZoom / 100;
  // Scale the iframe and adjust its rendered size so scrolling works correctly
  iframe.style.transform = `scale(${scale})`;
  iframe.style.width = `${100 / scale}%`;
  iframe.style.height = `${100 / scale}%`;
  zoomLabel.textContent = `${currentZoom}%`;
  chrome.storage.local.set({ [STORAGE_KEY]: currentZoom });
}

// Restore saved zoom level
chrome.storage.local.get(STORAGE_KEY, (result) => {
  const saved = result[STORAGE_KEY];
  if (saved && saved >= ZOOM_MIN && saved <= ZOOM_MAX) {
    applyZoom(saved);
  }
});

zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
zoomReset.addEventListener('click', () => applyZoom(100));

// Keyboard shortcuts: Ctrl/Cmd + +/-/0
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
