(function attachHarnessDiscovery(root, factory) {
  const protocol = root.DeepSeekHarnessProtocol ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./harness-protocol.js')
      : null);
  if (!protocol) throw new Error('harness-protocol.js must load before harness-discovery.js');

  const api = factory(protocol, root);
  root.DeepSeekHarnessDiscovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createHarnessDiscovery(protocol, root) {
  const DEFAULT_TIMEOUT_MS = 900;

  function normalizeBridgeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    let url;
    try { url = new URL(value.trim()); } catch (error) { return null; }
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
      : null;
    const requestOptions = { ...(options || {}) };
    if (controller) requestOptions.signal = controller.signal;
    return Promise.resolve()
      .then(() => fetchImpl(url, requestOptions))
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
      });
  }

  async function fetchBridgeConfig(baseUrl, fetchImpl, timeoutMs) {
    try {
      const response = await fetchWithTimeout(fetchImpl,
        protocol.harnessBridgeConfigUrl(baseUrl), {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        }, timeoutMs);
      if (!response || !response.ok || typeof response.json !== 'function') return null;
      const body = await response.json();
      return normalizeBridgeUrl(body && body.wsUrl);
    } catch (error) {
      return null;
    }
  }

  async function fetchHarnessPage(baseUrl, fetchImpl, timeoutMs) {
    try {
      const response = await fetchWithTimeout(fetchImpl, baseUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      }, timeoutMs);
      if (!response || !response.ok || typeof response.text !== 'function') return false;
      return protocol.isDeepSeekHarnessPage(await response.text());
    } catch (error) {
      return false;
    }
  }

  async function probe(baseUrl, options) {
    const config = options || {};
    const fetchImpl = config.fetchImpl || (root && root.fetch);
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持检测 Harness 服务');
    }
    const timeoutMs = Number.isFinite(config.timeoutMs)
      ? Math.max(1, config.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const [bridgeUrl, pageDetected] = await Promise.all([
      fetchBridgeConfig(baseUrl, fetchImpl, timeoutMs),
      fetchHarnessPage(baseUrl, fetchImpl, timeoutMs)
    ]);
    return { baseUrl, bridgeUrl, pageDetected };
  }

  async function discover(baseUrl, options) {
    const normalized = protocol.normalizeHarnessUrl(baseUrl);
    const candidates = protocol.localHarnessCandidateUrls(normalized);
    const urls = candidates.length > 0 ? candidates : [normalized];
    const results = await Promise.all(urls.map(url => probe(url, options)));
    // A DSH build that requires browser authentication answers the ordinary page
    // with 401 while /ext/bridge-config stays public. Prefer an instance whose page
    // can actually be embedded, then borrow a bridge URL when one is available, so
    // the sidebar iframe never points at a URL that only returns the auth prompt.
    const pageResults = results.filter(result => result.pageDetected);
    const bridgeResult = results.find(result => result.bridgeUrl);
    const pageResult = pageResults.find(result => result.bridgeUrl) || pageResults[0] || null;
    const selected = pageResult || bridgeResult;
    return {
      baseUrl: selected ? selected.baseUrl : normalized,
      bridgeUrl: (pageResult && pageResult.bridgeUrl) ||
        (bridgeResult ? bridgeResult.bridgeUrl : null),
      pageDetected: Boolean(pageResult),
      detected: Boolean(selected),
      candidates: urls
    };
  }

  return {
    discover,
    fetchBridgeConfig,
    fetchHarnessPage,
    isDeepSeekHarnessPage: protocol.isDeepSeekHarnessPage,
    normalizeBridgeUrl,
    probe
  };
});
