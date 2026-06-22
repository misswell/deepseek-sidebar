const webviewContainer = document.getElementById('webview-container');
const loading = document.getElementById('loading');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const reloadBtn = document.getElementById('refresh');
const zoomLabel = document.getElementById('zoom-label');
const readPageBtn = document.getElementById('read-page');
const pageReader = document.getElementById('page-reader');
const pageReaderTitle = document.getElementById('page-reader-title');
const pageReaderMeta = document.getElementById('page-reader-meta');
const pageReaderContent = document.getElementById('page-reader-content');
const pageReaderStatus = document.getElementById('page-reader-status');
const copyPageContentBtn = document.getElementById('copy-page-content');
const closePageReaderBtn = document.getElementById('close-page-reader');

const ZOOM_KEY = 'deepseek-sidebar-zoom';
const APP_KEY = 'deepseek-sidebar-app';
const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 200;
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
let currentPageText = '';
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

function setupFrameLoadState(frame, appId) {
  frame.addEventListener('load', () => {
    loadedApps.add(appId);
    if (currentApp === appId) loading.classList.add('hidden');
  });
}

function getOrCreateFrame(appId) {
  const existingFrame = frames.get(appId);
  if (existingFrame) return existingFrame;

  const app = APPS[appId];
  const frame = document.createElement('iframe');
  frame.className = 'webview-frame hidden';
  frame.dataset.app = appId;
  frame.setAttribute('allow', IFRAME_ALLOW);
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

function readPageText() {
  return {
    title: document.title || '未命名页面',
    url: location.href,
    text: (document.body && document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
  };
}

function executePageRead(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, func: readPageText },
      (results) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        const result = results && results[0] && results[0].result;
        if (!result) {
          reject(new Error('无法读取当前页面'));
          return;
        }
        resolve(result);
      }
    );
  });
}

function showPageReader(result) {
  currentPageText = result.text || '';
  pageReaderTitle.textContent = result.title || '当前页面内容';
  pageReaderMeta.textContent = result.url || '';
  pageReaderContent.value = currentPageText;
  pageReaderStatus.textContent = currentPageText ? currentPageText.length + ' 字符' : '未读取到文本内容';
  pageReader.classList.remove('hidden');
}

function showPageReaderError(message) {
  currentPageText = '';
  pageReaderTitle.textContent = '当前页面内容';
  pageReaderMeta.textContent = '';
  pageReaderContent.value = '';
  pageReaderStatus.textContent = message;
  pageReader.classList.remove('hidden');
}

async function readCurrentPage() {
  pageReader.classList.remove('hidden');
  pageReaderTitle.textContent = '当前页面内容';
  pageReaderMeta.textContent = '';
  pageReaderContent.value = '';
  pageReaderStatus.textContent = '读取中...';

  try {
    const tab = await queryActiveTab();
    const result = await executePageRead(tab.id);
    showPageReader(result);
  } catch (e) {
    showPageReaderError(e && e.message ? e.message : '读取失败');
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
appButtons.forEach(btn => {
  btn.addEventListener('click', () => switchApp(btn.dataset.app));
});
zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
readPageBtn.addEventListener('click', readCurrentPage);
copyPageContentBtn.addEventListener('click', copyCurrentPageText);
closePageReaderBtn.addEventListener('click', () => pageReader.classList.add('hidden'));
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
