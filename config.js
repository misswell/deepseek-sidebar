// All available apps — must match APP_META in sidepanel.js
const APPS = DeepSeekSidebarApps.apps.map(app => ({
  ...app,
  url: app.url || app.displayUrl
}));
const DEFAULT_ORDER = APPS.map(a => a.id);

const VISIBILITY_KEY = 'deepseek-sidebar-visibility';
const ORDER_KEY = 'deepseek-sidebar-order';
const HARNESS_URL_KEY = 'deepseek-sidebar-harness-url';
const HARNESS_TOKEN_KEY = 'deepseek-sidebar-harness-token';
const DEFAULT_HARNESS_URL = DeepSeekHarnessProtocol.DEFAULT_HARNESS_URL;

const appList = document.getElementById('appList');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const statusEl = document.getElementById('status');
const harnessUrlInput = document.getElementById('harnessUrl');
const harnessTokenInput = document.getElementById('harnessToken');
const testHarnessBtn = document.getElementById('testHarnessBtn');
const harnessStatusEl = document.getElementById('harnessStatus');
const copyHarnessInstallCommandBtn = document.getElementById('copyHarnessInstallCommand');
const harnessInstallAlertEl = document.getElementById('harnessInstallAlert');
const harnessInstallAlertDetailEl = document.getElementById('harnessInstallAlertDetail');
const HARNESS_INSTALL_COMMAND = './scripts/install-dsh-bridge.sh';

let currentVisibility = {};
let currentOrder = [];   // array of app ids
let draggedItem = null;

function getAppById(id) {
  return APPS.find(a => a.id === id);
}

function renderAppList() {
  appList.innerHTML = '';
  currentOrder.forEach(id => {
    const app = getAppById(id);
    if (!app) return;
    const item = document.createElement('div');
    item.className = 'app-item' + (currentVisibility[app.id] !== false ? ' checked' : '');
    item.dataset.appId = app.id;
    item.draggable = true;
    item.innerHTML = `
      <div class="drag-handle" title="拖动排序">⠿</div>
      <img class="app-icon" src="${app.icon}" alt="${app.name}">
      <div class="app-name">${app.name}<br><span class="app-url">${app.url}</span></div>
      <div class="checkbox"></div>
    `;
    // Click toggles visibility
    item.addEventListener('click', (e) => {
      // Don't toggle when clicking the drag handle
      if (e.target.classList.contains('drag-handle')) return;
      currentVisibility[app.id] = currentVisibility[app.id] === false ? true : false;
      item.classList.toggle('checked');
    });
    // Drag events
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', app.id);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      appList.querySelectorAll('.app-item').forEach(el => el.classList.remove('drag-over'));
      draggedItem = null;
      // Update currentOrder from DOM
      currentOrder = Array.from(appList.querySelectorAll('.app-item')).map(el => el.dataset.appId);
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedItem && draggedItem !== item) {
        appList.querySelectorAll('.app-item').forEach(el => el.classList.remove('drag-over'));
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedItem || draggedItem === item) return;
      // Determine insert position
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const dropAfter = e.clientY > midpoint;
      appList.insertBefore(draggedItem, dropAfter ? item.nextSibling : item);
      item.classList.remove('drag-over');
    });
    appList.appendChild(item);
  });
}

function loadSettings() {
  try {
    chrome.storage.local.get([
      VISIBILITY_KEY,
      ORDER_KEY,
      HARNESS_URL_KEY,
      HARNESS_TOKEN_KEY
    ], (result) => {
      const savedVis = result[VISIBILITY_KEY];
      if (savedVis && typeof savedVis === 'object') {
        currentVisibility = savedVis;
      } else {
        APPS.forEach(app => { currentVisibility[app.id] = true; });
      }
      APPS.forEach(app => {
        if (typeof currentVisibility[app.id] !== 'boolean') currentVisibility[app.id] = true;
      });
      const savedOrder = result[ORDER_KEY];
      if (Array.isArray(savedOrder)) {
        // Use saved order, append any new apps not in saved order
        currentOrder = savedOrder.filter(id => getAppById(id));
        APPS.forEach(app => {
          if (!currentOrder.includes(app.id)) currentOrder.push(app.id);
        });
      } else {
        currentOrder = [...DEFAULT_ORDER];
      }
      try {
        harnessUrlInput.value = DeepSeekHarnessProtocol.normalizeHarnessUrl(result[HARNESS_URL_KEY]);
      } catch (e) {
        harnessUrlInput.value = DEFAULT_HARNESS_URL;
      }
      harnessTokenInput.value = typeof result[HARNESS_TOKEN_KEY] === 'string'
        ? result[HARNESS_TOKEN_KEY] : '';
      renderAppList();
    });
  } catch (e) {
    APPS.forEach(app => { currentVisibility[app.id] = true; });
    currentOrder = [...DEFAULT_ORDER];
    harnessUrlInput.value = DEFAULT_HARNESS_URL;
    harnessTokenInput.value = '';
    renderAppList();
  }
}

function saveSettings() {
  let harnessUrl;
  try {
    harnessUrl = DeepSeekHarnessProtocol.normalizeHarnessUrl(harnessUrlInput.value);
  } catch (e) {
    harnessStatusEl.textContent = e.message;
    harnessStatusEl.classList.add('error');
    return;
  }
  const harnessToken = harnessTokenInput.value.trim();
  try {
    harnessUrlInput.value = harnessUrl;
    chrome.storage.local.set({
      [VISIBILITY_KEY]: currentVisibility,
      [ORDER_KEY]: currentOrder,
      [HARNESS_URL_KEY]: harnessUrl,
      [HARNESS_TOKEN_KEY]: harnessToken
    }, () => {
      statusEl.textContent = '已保存 ✓';
      harnessStatusEl.textContent = 'Harness 地址和 bridge token 已保存。';
      harnessStatusEl.classList.remove('error');
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  } catch (e) {
    statusEl.textContent = '保存失败';
  }
}

function resetSettings() {
  DEFAULT_ORDER.forEach(id => { currentVisibility[id] = true; });
  currentOrder = [...DEFAULT_ORDER];
  harnessUrlInput.value = DEFAULT_HARNESS_URL;
  harnessTokenInput.value = '';
  renderAppList();
  try {
    chrome.storage.local.set({
      [VISIBILITY_KEY]: currentVisibility,
      [ORDER_KEY]: currentOrder,
      [HARNESS_URL_KEY]: DEFAULT_HARNESS_URL,
      [HARNESS_TOKEN_KEY]: ''
    }, () => {
      statusEl.textContent = '已恢复默认 ✓';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  } catch (e) {
    statusEl.textContent = '重置失败';
  }
}

function requestHarnessPermission(url) {
  const origin = DeepSeekHarnessProtocol.harnessOriginPattern(url);
  return new Promise(resolve => {
    chrome.permissions.contains({ origins: [origin] }, granted => {
      void chrome.runtime.lastError;
      if (granted) {
        resolve(true);
        return;
      }
      try {
        chrome.permissions.request({ origins: [origin] }, requested => {
          void chrome.runtime.lastError;
          resolve(Boolean(requested));
        });
      } catch (e) {
        resolve(false);
      }
    });
  });
}

function probeHarness(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      source: 'deepseek-sidebar-harness-host',
      command: 'probe',
      baseUrl: url
    }, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response || response.ok !== true) {
        reject(new Error(response && response.error ? response.error : 'Harness 没有返回结果'));
        return;
      }
      resolve(response.value);
    });
  });
}

function probeHarnessBridge(url, token) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      source: 'deepseek-sidebar-harness-bridge',
      command: 'test',
      baseUrl: url,
      token: typeof token === 'string' ? token : ''
    }, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response || response.ok !== true) {
        reject(new Error(response && response.error ? response.error : 'Harness bridge 未完成握手'));
        return;
      }
      resolve(response.value);
    });
  });
}

function settledError(result) {
  if (!result || result.status !== 'rejected') return '';
  const reason = result.reason;
  return reason && reason.message ? reason.message : String(reason || '未知错误');
}

function showHarnessInstallAlert(detail) {
  harnessInstallAlertDetailEl.textContent = detail ||
    'DSH 页面正常，但没有收到 bridge 的 hello.ok。请按上方步骤安装并重启 DSH。';
  harnessInstallAlertEl.hidden = false;
}

function hideHarnessInstallAlert() {
  harnessInstallAlertEl.hidden = true;
}

async function copyHarnessInstallCommand() {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('当前环境不支持剪贴板');
    }
    await navigator.clipboard.writeText(HARNESS_INSTALL_COMMAND);
    const original = copyHarnessInstallCommandBtn.textContent;
    copyHarnessInstallCommandBtn.textContent = '已复制';
    setTimeout(() => { copyHarnessInstallCommandBtn.textContent = original; }, 1500);
  } catch (error) {
    harnessStatusEl.textContent = '请手动复制命令：' + HARNESS_INSTALL_COMMAND;
    harnessStatusEl.classList.add('error');
  }
}

async function testHarnessConnection() {
  let url;
  try {
    url = DeepSeekHarnessProtocol.normalizeHarnessUrl(harnessUrlInput.value);
  } catch (e) {
    hideHarnessInstallAlert();
    harnessStatusEl.textContent = e.message;
    harnessStatusEl.classList.add('error');
    return;
  }
  testHarnessBtn.disabled = true;
  hideHarnessInstallAlert();
  harnessStatusEl.classList.remove('error');
  harnessStatusEl.textContent = '正在连接…';
  try {
    if (!(await requestHarnessPermission(url))) {
      throw new Error('没有获得该 Harness 地址的访问权限。');
    }
    const [infoResult, bridgeResult] = await Promise.allSettled([
      probeHarness(url),
      probeHarnessBridge(url, harnessTokenInput.value.trim())
    ]);
    const info = infoResult.status === 'fulfilled' ? infoResult.value : null;
    const bridge = bridgeResult.status === 'fulfilled' ? bridgeResult.value : null;
    const infoOk = Boolean(info && info.ok === true);
    const bridgeOk = Boolean(bridge && bridge.connected === true);
    const infoError = settledError(infoResult) ||
      (info ? 'Harness 返回了异常状态（HTTP ' + (info.status || '未知') + '）' : '无法访问 Harness 页面');
    const bridgeError = settledError(bridgeResult) ||
      (bridge && bridge.error ? bridge.error : '未收到 hello.ok 握手响应');
    const bridgeNeedsInstall = !bridgeOk && (
      (bridge && bridge.discovered === false) ||
      bridgeError.includes('未发现 /ext/bridge-config')
    );

    harnessUrlInput.value = url;
    if (infoOk && bridgeOk) {
      harnessStatusEl.textContent = (info.title ? '连接成功 · ' + info.title : '连接成功') +
        ' · 原生 bridge hello.ok 握手成功';
      harnessStatusEl.classList.remove('error');
    } else if (infoOk && !bridgeOk) {
      const discoveryHint = bridge && bridge.discovered === false
        ? '未发现 /ext/bridge-config；' : '';
      const nextStep = bridgeNeedsInstall
        ? '请安装并启动 dsh-browser bridge，再重试。'
        : '请检查 bridge token 和服务状态，再重试。';
      harnessStatusEl.textContent = 'DSH 页面正常' +
        (info.title ? ' · ' + info.title : '') +
        '，但浏览器 bridge 未连接（' + discoveryHint + bridgeError +
        '）。' + nextStep;
      harnessStatusEl.classList.add('error');
      if (bridgeNeedsInstall) {
        showHarnessInstallAlert(
          'DSH 页面已打开，但没有收到 bridge 的 hello.ok（' + bridgeError + '）。请按上方步骤安装并重启 DSH。'
        );
      }
    } else if (!infoOk && bridgeOk) {
      harnessStatusEl.textContent = '原生 bridge 握手成功，但 DSH 页面检查失败：' + infoError;
      harnessStatusEl.classList.add('error');
    } else {
      harnessStatusEl.textContent = '连接失败：' + infoError + '；浏览器 bridge：' + bridgeError;
      harnessStatusEl.classList.add('error');
    }
  } catch (e) {
    harnessStatusEl.textContent = e && e.message ? e.message : '连接失败';
    harnessStatusEl.classList.add('error');
  } finally {
    testHarnessBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);
testHarnessBtn.addEventListener('click', testHarnessConnection);
copyHarnessInstallCommandBtn.addEventListener('click', () => { void copyHarnessInstallCommand(); });

loadSettings();
