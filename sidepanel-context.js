(function (root) {
  'use strict';

  const PANEL_PATH = 'sidepanel.html';
  const TAB_STATE_PREFIX = 'deepseek-sidebar-tab-state:';
  // Must match tab-state.js SHARED_SLOT: the unified-sidebar mode stores every
  // tab's panel state under this single slot.
  const SHARED_STATE_SLOT = 'shared';

  function tabId(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
  }

  function panelOptionsForTab(value) {
    const id = tabId(value);
    return id === null ? null : { tabId: id, enabled: true, path: PANEL_PATH };
  }

  function stateStorageKey(value) {
    if (value === SHARED_STATE_SLOT) return `${TAB_STATE_PREFIX}${SHARED_STATE_SLOT}`;
    const id = tabId(value);
    return id === null ? null : `${TAB_STATE_PREFIX}${id}`;
  }

  function slotFromStateStorageKey(key) {
    if (typeof key !== 'string' || !key.startsWith(TAB_STATE_PREFIX)) return null;
    const rest = key.slice(TAB_STATE_PREFIX.length);
    if (rest === SHARED_STATE_SLOT) return SHARED_STATE_SLOT;
    return tabId(rest);
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
    SHARED_STATE_SLOT,
    panelOptionsForTab,
    stateStorageKey,
    slotFromStateStorageKey,
    contextForDocument
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.DeepSeekSidebarContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
