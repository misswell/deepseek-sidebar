const MULTI_AI_SOURCE = 'deepseek-sidebar-multi-ai';
const MULTI_SELECTION_KEY = 'deepseek-sidebar-multi-apps';
const MULTI_ZOOM_KEY = 'deepseek-sidebar-multi-zoom';
const VISIBILITY_KEY = 'deepseek-sidebar-visibility';
const ORDER_KEY = 'deepseek-sidebar-order';
const DEFAULT_APPS = ['deepseek', 'qianwen', 'chatgpt'];
const ZOOM_STEP = 10;

const appChoices = document.getElementById('app-choices');
const results = document.getElementById('results');
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send');
const globalStatus = document.getElementById('global-status');
const selectionCount = document.getElementById('selection-count');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomLabel = document.getElementById('zoom-label');
const reloadAllButton = document.getElementById('reload-all');
const fullscreenButton = document.getElementById('fullscreen');
const panelTemplate = document.getElementById('panel-template');

let availableApps = [];
let selected = new Set();
let sending = false;
let currentZoom = DeepSeekSidebarTabState.DEFAULT_ZOOM;
const panels = new Map();

function setGlobalStatus(message, error) {
  globalStatus.textContent = message;
  globalStatus.classList.toggle('error', Boolean(error));
}

function setPanelStatus(appId, state, message) {
  const panel = panels.get(appId);
  if (!panel) return;
  panel.root.dataset.state = state;
  panel.status.textContent = message;
  panel.status.title = message;
}

function persistSelection() {
  chrome.storage.local.set({ [MULTI_SELECTION_KEY]: Array.from(selected) });
}

function persistZoom() {
  chrome.storage.local.set({ [MULTI_ZOOM_KEY]: currentZoom });
}

function applyZoomToFrame(frame, zoom) {
  const normalizedZoom = DeepSeekSidebarTabState.normalizeZoom(zoom);
  const scale = normalizedZoom / 100;
  frame.style.transformOrigin = 'top left';
  frame.style.transform = `scale(${scale})`;
  frame.style.width = `${100 / scale}%`;
  frame.style.height = `${100 / scale}%`;
}

function updateZoomControls() {
  zoomLabel.textContent = `${currentZoom}%`;
  zoomOutButton.disabled = currentZoom <= DeepSeekSidebarTabState.MIN_ZOOM;
  zoomInButton.disabled = currentZoom >= DeepSeekSidebarTabState.MAX_ZOOM;
}

function applyZoom(zoom) {
  currentZoom = DeepSeekSidebarTabState.normalizeZoom(zoom);
  panels.forEach(panel => applyZoomToFrame(panel.frame, currentZoom));
  updateZoomControls();
  persistZoom();
}

function orderedSelectedApps() {
  return availableApps.filter(app => selected.has(app.id));
}

function updateLayout() {
  const count = selected.size;
  results.style.setProperty('--visible-columns', String(Math.max(1, Math.min(3, count))));
  selectionCount.textContent = `${count} AI`;
  sendButton.disabled = sending || count === 0;
  if (count === 0 && !results.querySelector('.empty-results')) {
    const empty = document.createElement('p');
    empty.className = 'empty-results';
    empty.textContent = '从上方选择要同时提问的 AI';
    results.appendChild(empty);
  }
  const empty = results.querySelector('.empty-results');
  if (empty && count > 0) empty.remove();
}

function createPanel(app) {
  const root = panelTemplate.content.firstElementChild.cloneNode(true);
  root.dataset.app = app.id;
  root.dataset.state = 'loading';
  root.style.setProperty('--app-color', app.color);
  const icon = root.querySelector('.panel-icon');
  const name = root.querySelector('.panel-name');
  const status = root.querySelector('.panel-status span');
  const frame = root.querySelector('.ai-frame');
  icon.src = app.icon;
  icon.alt = app.name;
  name.textContent = app.name;
  frame.dataset.app = app.id;
  applyZoomToFrame(frame, currentZoom);
  frame.addEventListener('load', () => setPanelStatus(app.id, 'ready', '可以提问'));
  root.querySelector('.panel-reload').addEventListener('click', () => {
    setPanelStatus(app.id, 'loading', '正在刷新');
    frame.src = app.url;
  });
  root.querySelector('.panel-open').addEventListener('click', () => {
    chrome.tabs.create({ url: app.url });
  });
  panels.set(app.id, { root, frame, status });
  frame.src = app.url;
  return root;
}

function renderPanels() {
  panels.forEach((panel, appId) => {
    if (!selected.has(appId)) {
      panel.root.remove();
      panels.delete(appId);
    }
  });
  orderedSelectedApps().forEach(app => {
    const panel = panels.get(app.id);
    results.appendChild(panel ? panel.root : createPanel(app));
  });
  updateLayout();
}

function renderChoices() {
  appChoices.innerHTML = '';
  availableApps.forEach(app => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-choice';
    button.style.setProperty('--app-color', app.color);
    button.dataset.app = app.id;
    button.setAttribute('aria-pressed', String(selected.has(app.id)));
    const icon = document.createElement('img');
    icon.src = app.icon;
    icon.alt = '';
    const label = document.createElement('span');
    label.textContent = app.name;
    button.append(icon, label);
    button.addEventListener('click', () => {
      if (selected.has(app.id)) selected.delete(app.id);
      else selected.add(app.id);
      button.setAttribute('aria-pressed', String(selected.has(app.id)));
      persistSelection();
      renderPanels();
      setGlobalStatus(selected.size > 1 ? '输入问题后将同时投递' : '建议至少选择两个 AI 进行对比');
    });
    appChoices.appendChild(button);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response || response.ok !== true) reject(new Error(response?.error || '没有收到后台响应'));
      else resolve(response.value);
    });
  });
}

async function dispatchPrompt() {
  const prompt = promptInput.value.trim();
  const appIds = orderedSelectedApps().map(app => app.id);
  if (!prompt) {
    setGlobalStatus('请先输入问题', true);
    promptInput.focus();
    return;
  }
  if (appIds.length === 0) {
    setGlobalStatus('请至少选择一个 AI', true);
    return;
  }
  sending = true;
  document.body.classList.add('dispatching');
  updateLayout();
  appIds.forEach(appId => setPanelStatus(appId, 'sending', '正在投递'));
  setGlobalStatus(`正在同时发送到 ${appIds.length} 个 AI…`);
  try {
    const value = await sendRuntimeMessage({ source: MULTI_AI_SOURCE, command: 'prompt', prompt, appIds });
    const responseByApp = new Map((value.results || []).map(item => [item.appId, item]));
    let successCount = 0;
    appIds.forEach(appId => {
      const item = responseByApp.get(appId);
      if (item && item.ok) {
        successCount += 1;
        setPanelStatus(appId, 'sent', '已发送');
      } else {
        setPanelStatus(appId, 'error', item?.error || '发送失败');
      }
    });
    setGlobalStatus(successCount === appIds.length
      ? `已发送到 ${successCount} 个 AI，回答会显示在下方各栏`
      : `已发送 ${successCount}/${appIds.length}；失败栏可登录或刷新后重试`, successCount === 0);
  } catch (error) {
    appIds.forEach(appId => setPanelStatus(appId, 'error', '发送失败'));
    setGlobalStatus(error.message, true);
  } finally {
    sending = false;
    document.body.classList.remove('dispatching');
    updateLayout();
  }
}

function resizePrompt() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(116, promptInput.scrollHeight) + 'px';
}

function loadState() {
  chrome.storage.local.get([MULTI_SELECTION_KEY, MULTI_ZOOM_KEY, VISIBILITY_KEY, ORDER_KEY], values => {
    currentZoom = DeepSeekSidebarTabState.normalizeZoom(values[MULTI_ZOOM_KEY]);
    updateZoomControls();
    const visibility = values[VISIBILITY_KEY] || {};
    const order = Array.isArray(values[ORDER_KEY]) ? values[ORDER_KEY] : DeepSeekSidebarApps.apps.map(app => app.id);
    availableApps = order
      .map(id => DeepSeekSidebarApps.byId(id))
      .filter(app => app && app.multi && visibility[app.id] !== false);
    const saved = Array.isArray(values[MULTI_SELECTION_KEY]) ? values[MULTI_SELECTION_KEY] : DEFAULT_APPS;
    selected = new Set(saved.filter(id => availableApps.some(app => app.id === id)));
    if (selected.size === 0) availableApps.slice(0, 3).forEach(app => selected.add(app.id));
    renderChoices();
    renderPanels();
    setGlobalStatus(selected.size > 1 ? '输入问题后将同时投递' : '建议至少选择两个 AI 进行对比');
  });
}

sendButton.addEventListener('click', dispatchPrompt);
zoomInButton.addEventListener('click', () => applyZoom(currentZoom + ZOOM_STEP));
zoomOutButton.addEventListener('click', () => applyZoom(currentZoom - ZOOM_STEP));
zoomLabel.addEventListener('dblclick', () => applyZoom(DeepSeekSidebarTabState.DEFAULT_ZOOM));
promptInput.addEventListener('input', resizePrompt);
promptInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void dispatchPrompt();
  }
});
reloadAllButton.addEventListener('click', () => {
  panels.forEach((panel, appId) => {
    setPanelStatus(appId, 'loading', '正在刷新');
    panel.frame.src = DeepSeekSidebarApps.byId(appId).url;
  });
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    setGlobalStatus('浏览器未允许进入全屏', true);
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
});
document.addEventListener('keydown', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    applyZoom(currentZoom + ZOOM_STEP);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    applyZoom(currentZoom - ZOOM_STEP);
  } else if (event.key === '0') {
    event.preventDefault();
    applyZoom(DeepSeekSidebarTabState.DEFAULT_ZOOM);
  }
});

updateZoomControls();
loadState();
