(function installDeepSeekFrameRouteBridge() {
  'use strict';

  const FRAME_ROUTE_SOURCE = 'deepseek-sidebar-frame-route';
  const FRAME_ROUTE_INIT_SOURCE = 'deepseek-sidebar-frame-route-init';

  // This script deliberately runs in the page's MAIN world so history calls
  // made by a SPA are visible to the route reporter. It stays passive in
  // ordinary page iframes until the extension side panel handshakes with it;
  // the page bridge itself remains in the isolated world and owns all
  // browser-tool operations.
  if (window.parent === window || window.__deepseekSidebarMainFrameRouteInstalled) return;

  function installReporter() {
    if (window.__deepseekSidebarMainFrameRouteInstalled) return;

    const historyApi = window.history;
    const originalPushState = historyApi && historyApi.pushState;
    const originalReplaceState = historyApi && historyApi.replaceState;
    const report = () => {
      try {
        window.parent.postMessage({
          source: FRAME_ROUTE_SOURCE,
          url: location.href
        }, '*');
      } catch (error) {}
    };
    const reportSoon = () => setTimeout(report, 0);

    try {
      if (typeof originalPushState === 'function') {
        historyApi.pushState = function (...args) {
          const result = originalPushState.apply(this, args);
          reportSoon();
          return result;
        };
      }
      if (typeof originalReplaceState === 'function') {
        historyApi.replaceState = function (...args) {
          const result = originalReplaceState.apply(this, args);
          reportSoon();
          return result;
        };
      }
    } catch (error) {}

    window.addEventListener('popstate', reportSoon, true);
    window.addEventListener('hashchange', reportSoon, true);
    window.addEventListener('beforeunload', report, true);
    window.__deepseekSidebarMainFrameRouteInstalled = true;
    reportSoon();
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data ||
        event.data.source !== FRAME_ROUTE_INIT_SOURCE) return;
    installReporter();
  }, true);
})();
