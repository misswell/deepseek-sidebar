(function (root) {
  'use strict';

  const DEFAULT_APP = 'harness';
  const DEFAULT_ZOOM = 100;
  const MIN_ZOOM = 30;
  const MAX_ZOOM = 200;
  const MAX_FRAME_URL_LENGTH = 4096;

  function tabKey(tabId) {
    if (tabId === null || tabId === undefined ||
        (typeof tabId === 'string' && tabId.trim() === '')) return null;
    const value = typeof tabId === 'number' ? tabId : Number(tabId);
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  function normalizeZoom(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_ZOOM;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(numeric)));
  }

  function normalizeFrameUrl(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_FRAME_URL_LENGTH) return '';
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function normalizeFrameUrls(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    Object.entries(value).forEach(([app, url]) => {
      if (!app || app.length > 80) return;
      const normalizedUrl = normalizeFrameUrl(url);
      if (normalizedUrl) result[app] = normalizedUrl;
    });
    return result;
  }

  function normalizeState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      app: typeof source.app === 'string' && source.app.trim() ? source.app : DEFAULT_APP,
      zoom: normalizeZoom(source.zoom),
      harnessSessionId: typeof source.harnessSessionId === 'string' ? source.harnessSessionId : '',
      frameUrls: normalizeFrameUrls(source.frameUrls)
    };
  }

  function normalizeMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    Object.entries(value).forEach(([key, state]) => {
      const normalizedKey = tabKey(key);
      if (normalizedKey !== null) result[normalizedKey] = normalizeState(state);
    });
    return result;
  }

  function getTabState(map, tabId) {
    const key = tabKey(tabId);
    if (key === null) return null;
    const normalized = normalizeMap(map);
    return normalized[key] || null;
  }

  function setTabState(map, tabId, patch) {
    const key = tabKey(tabId);
    const result = normalizeMap(map);
    if (key === null) return result;
    result[key] = normalizeState({ ...result[key], ...(patch || {}) });
    return result;
  }

  function getFrameUrl(map, tabId, app) {
    if (typeof app !== 'string' || !app.trim()) return '';
    const state = getTabState(map, tabId);
    return state && state.frameUrls ? state.frameUrls[app] || '' : '';
  }

  function setFrameUrl(map, tabId, app, url) {
    const result = normalizeMap(map);
    const key = tabKey(tabId);
    if (key === null || typeof app !== 'string' || !app.trim()) return result;
    const state = normalizeState(result[key]);
    const frameUrls = { ...state.frameUrls };
    const normalizedUrl = normalizeFrameUrl(url);
    if (normalizedUrl) frameUrls[app] = normalizedUrl;
    else delete frameUrls[app];
    result[key] = normalizeState({ ...state, frameUrls });
    return result;
  }

  function removeTabState(map, tabId) {
    const result = normalizeMap(map);
    const key = tabKey(tabId);
    if (key !== null) delete result[key];
    return result;
  }

  function replaceTabState(map, oldTabId, newTabId) {
    const result = normalizeMap(map);
    const oldKey = tabKey(oldTabId);
    const newKey = tabKey(newTabId);
    if (oldKey === null || newKey === null || oldKey === newKey) return result;
    if (!result[newKey] && result[oldKey]) result[newKey] = result[oldKey];
    delete result[oldKey];
    return result;
  }

  function createActiveTabSynchronizer(options) {
    const config = options || {};
    let pending = null;

    function reconcile() {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(() => config.getActiveTab())
        .then(tab => {
          const activeKey = tabKey(tab && tab.id);
          if (activeKey === null) return false;
          const currentKey = tabKey(config.getCurrentTabId());
          if (activeKey === currentKey) return false;
          return Promise.resolve(config.onActivate(tab)).then(() => true);
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    }

    return { reconcile };
  }

  const api = {
    DEFAULT_APP,
    DEFAULT_ZOOM,
    MIN_ZOOM,
    MAX_ZOOM,
    tabKey,
    normalizeZoom,
    normalizeFrameUrl,
    normalizeFrameUrls,
    normalizeState,
    normalizeMap,
    getTabState,
    setTabState,
    getFrameUrl,
    setFrameUrl,
    removeTabState,
    replaceTabState,
    createActiveTabSynchronizer
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.DeepSeekSidebarTabState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
