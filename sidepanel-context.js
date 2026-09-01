(function (root) {
  'use strict';

  const PANEL_PATH = 'sidepanel.html';
  const TAB_STATE_PREFIX = 'deepseek-sidebar-tab-state:';

  function tabId(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
  }

  function panelOptionsForTab(value) {
    const id = tabId(value);
    return id === null ? null : { tabId: id, enabled: true, path: PANEL_PATH };
  }

  function stateStorageKey(value) {
    const id = tabId(value);
    return id === null ? null : `${TAB_STATE_PREFIX}${id}`;
  }

  function tabIdFromStateStorageKey(key) {
    if (typeof key !== 'string' || !key.startsWith(TAB_STATE_PREFIX)) return null;
    return tabId(key.slice(TAB_STATE_PREFIX.length));
  }

  function contextForDocument(contexts, documentId) {
    if (!Array.isArray(contexts) || typeof documentId !== 'string' || !documentId) return null;
    const context = contexts.find(item => item && item.documentId === documentId);
    const id = tabId(context && context.tabId);
    if (id === null) return null;
    return {
      tabId: id,
      windowId: tabId(context.windowId)
    };
  }

  const api = {
    PANEL_PATH,
    TAB_STATE_PREFIX,
    panelOptionsForTab,
    stateStorageKey,
    tabIdFromStateStorageKey,
    contextForDocument
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.DeepSeekSidebarContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
