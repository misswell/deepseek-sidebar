// All available apps — must match APP_META in sidepanel.js
const APPS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'icons/icon-deep.png' },
  { id: 'zhipu', name: '智谱', url: 'https://chat.z.ai/', icon: 'icons/zhipu.svg' },
  { id: 'qianwen', name: '千问', url: 'https://www.qianwen.com/', icon: 'icons/qianwen.png' },
  { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/', icon: 'icons/kimi.svg' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'icons/chatgpt.png' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', icon: 'icons/gemini.png' },
  { id: 'youdao', name: '有道词典', url: 'https://dict.youdao.com/m/', icon: 'icons/youdao.svg' }
];
const DEFAULT_ORDER = APPS.map(a => a.id);

const VISIBILITY_KEY = 'deepseek-sidebar-visibility';
const ORDER_KEY = 'deepseek-sidebar-order';

const appList = document.getElementById('appList');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const statusEl = document.getElementById('status');

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
    chrome.storage.local.get([VISIBILITY_KEY, ORDER_KEY], (result) => {
      const savedVis = result[VISIBILITY_KEY];
      if (savedVis && typeof savedVis === 'object') {
        currentVisibility = savedVis;
      } else {
        APPS.forEach(app => { currentVisibility[app.id] = true; });
      }
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
      renderAppList();
    });
  } catch (e) {
    APPS.forEach(app => { currentVisibility[app.id] = true; });
    currentOrder = [...DEFAULT_ORDER];
    renderAppList();
  }
}

function saveSettings() {
  try {
    chrome.storage.local.set({ [VISIBILITY_KEY]: currentVisibility, [ORDER_KEY]: currentOrder }, () => {
      statusEl.textContent = '已保存 ✓';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  } catch (e) {
    statusEl.textContent = '保存失败';
  }
}

function resetSettings() {
  DEFAULT_ORDER.forEach(id => { currentVisibility[id] = true; });
  currentOrder = [...DEFAULT_ORDER];
  renderAppList();
  try {
    chrome.storage.local.set({ [VISIBILITY_KEY]: currentVisibility, [ORDER_KEY]: currentOrder }, () => {
      statusEl.textContent = '已恢复默认 ✓';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });
  } catch (e) {
    statusEl.textContent = '重置失败';
  }
}

saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);

loadSettings();
