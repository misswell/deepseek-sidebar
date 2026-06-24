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
let lastFillRequestId = 0;
let pickingTabId = null;
let pickCancelled = false;
let pickWaitResolver = null;
let pickPendingNavigation = false;
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
appButtons.forEach(btn => {
  btn.addEventListener('click', () => switchApp(btn.dataset.app));
});
zoomIn.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOut.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
pickElementBtn.addEventListener('click', pickCurrentPageElement);
togglePageReaderBtn.addEventListener('click', () => setPageReaderExpanded(!pageReader.classList.contains('expanded')));
copyPageContentBtn.addEventListener('click', copyCurrentPageText);
closePageReaderBtn.addEventListener('click', () => {
  pageReader.classList.add('hidden');
  setPageReaderExpanded(false);
});
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
try {
  chrome.storage.local.get([ZOOM_KEY, APP_KEY], (result) => {
    switchApp(result[APP_KEY] || 'deepseek');
    applyZoom(result[ZOOM_KEY] || 100);
  });
} catch (e) {
  switchApp('deepseek');
  applyZoom(100);
}
