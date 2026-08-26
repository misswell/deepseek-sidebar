(function (root) {
  'use strict';

  const DEFAULT_APP = 'deepseek';
  const DEFAULT_ZOOM = 100;
  const MIN_ZOOM = 30;
  const MAX_ZOOM = 200;

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

  function normalizeState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      app: typeof source.app === 'string' && source.app.trim() ? source.app : DEFAULT_APP,
      zoom: normalizeZoom(source.zoom),
      harnessSessionId: typeof source.harnessSessionId === 'string' ? source.harnessSessionId : ''
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

  const api = {
    DEFAULT_APP,
    DEFAULT_ZOOM,
    MIN_ZOOM,
    MAX_ZOOM,
    tabKey,
    normalizeZoom,
    normalizeState,
    normalizeMap,
    getTabState,
    setTabState,
    removeTabState,
    replaceTabState
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.DeepSeekSidebarTabState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
