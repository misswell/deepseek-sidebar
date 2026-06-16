// Only run in the main qianwen frame (direct child of extension), skip sub-frames
(function() {
  'use strict';

  // Detect if we're in the main frame or a sub-frame
  let isMainFrame = false;
  try {
    // window.self !== window.top means we're in some kind of frame
    if (window.self !== window.top) {
      // window.parent === window.top means we're a direct child of top
      // (the main qianwen frame inside the extension iframe)
      if (window.parent === window.top) {
        isMainFrame = true;
      }
    }
  } catch(e) {
    // Cross-origin access blocked — we're in a sub-frame, skip
  }

  if (!isMainFrame) return;

  const LOG_PREFIX = '[UA-OVERRIDE]';
  const log = (...args) => {
    try { console.log(LOG_PREFIX, ...args); } catch(e) {}
  };

  log('injected at', document.readyState, 'URL:', location.href);

  // ---- Mobile UA override for qianwen ----
  const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  Object.defineProperty(Navigator.prototype, 'userAgent', {
    get: () => MOBILE_UA,
    configurable: true,
    enumerable: true
  });
  log('userAgent override installed');

  Object.defineProperty(Navigator.prototype, 'platform', {
    get: () => 'iPhone',
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
    get: () => 5,
    configurable: true,
    enumerable: true
  });

  // Provide a valid mobile userAgentData object
  try {
    const mobileUAData = {
      brands: [
        { brand: 'Chromium', version: '149' },
        { brand: 'Not)A;Brand', version: '24' },
        { brand: 'Google Chrome', version: '149' }
      ],
      mobile: true,
      platform: 'Android',
      getHighEntropyValues: () => Promise.resolve({
        architecture: '',
        bitness: '',
        model: '',
        platformVersion: '',
        uaFullVersion: '',
        fullVersionList: []
      }),
      toJSON: () => ({ brands: mobileUAData.brands, mobile: true, platform: 'Android' })
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => mobileUAData,
      configurable: true,
      enumerable: true
    });
    log('userAgentData override installed');
  } catch(e) {
    log('userAgentData override FAILED:', e.message);
  }

  // ---- Block visibilitychange from triggering page reload ----
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
      enumerable: true
    });
  } catch(e) {}

  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      get: () => false,
      configurable: true,
      enumerable: true
    });
  } catch(e) {}

  // Intercept addEventListener to block visibilitychange handlers
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'visibilitychange') return;
    return origAddEventListener.call(this, type, listener, options);
  };

  // ---- Monitor for navigation attempts ----
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      log('!!! NAVIGATION DETECTED:', lastHref, '->', location.href);
      log('!!! Stack:', new Error().stack);
      lastHref = location.href;
    }
  }, 200);

  window.addEventListener('beforeunload', () => {
    log('!!! beforeunload EVENT FIRED !!!');
  });

  log('all monitors installed');
})();
