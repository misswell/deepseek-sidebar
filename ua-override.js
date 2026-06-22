// Only run in the main qianwen frame (direct child of extension), skip sub-frames
(function() {
  'use strict';

  let isMainFrame = false;
  try {
    if (window.self !== window.top && window.parent === window.top) {
      isMainFrame = true;
    }
  } catch(e) {}

  if (!isMainFrame) return;

  // ---- Mobile UA override ----
  const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  Object.defineProperty(Navigator.prototype, 'userAgent', {
    get: () => MOBILE_UA, configurable: true, enumerable: true
  });
  Object.defineProperty(Navigator.prototype, 'platform', {
    get: () => 'iPhone', configurable: true, enumerable: true
  });
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
    get: () => 5, configurable: true, enumerable: true
  });

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
        architecture: '', bitness: '', model: '',
        platformVersion: '', uaFullVersion: '', fullVersionList: []
      }),
      toJSON: () => ({ brands: mobileUAData.brands, mobile: true, platform: 'Android' })
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => mobileUAData, configurable: true, enumerable: true
    });
  } catch(e) {}

  // ---- Hide the fact that we're in an iframe ----
  // Shadow window.top and window.parent to point to self
  try {
    Object.defineProperty(window, 'top', {
      get: () => window.self, configurable: true, enumerable: true
    });
    Object.defineProperty(window, 'parent', {
      get: () => window.self, configurable: true, enumerable: true
    });
  } catch(e) {}

  // Block frameElement
  try {
    Object.defineProperty(window, 'frameElement', {
      get: () => null, configurable: true, enumerable: true
    });
  } catch(e) {}

  // ---- Block visibility/focus/blur events that trigger reload ----
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: () => 'visible', configurable: true, enumerable: true
    });
    Object.defineProperty(Document.prototype, 'hidden', {
      get: () => false, configurable: true, enumerable: true
    });
  } catch(e) {}

  // Block document.hasFocus() — always return true
  try {
    Document.prototype.hasFocus = () => true;
  } catch(e) {}

  // Intercept addEventListener to block problematic event types
  const blockedEvents = [
    'visibilitychange',
    'focus',
    'blur',
    'pageshow',
    'pagehide',
    'deviceorientation',
    'deviceorientationabsolute',
    'devicemotion'
  ];
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (blockedEvents.includes(type)) return;
    return origAddEventListener.call(this, type, listener, options);
  };
})();
