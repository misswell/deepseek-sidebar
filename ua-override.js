// ---- Mobile UA override for qianwen ----
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

Object.defineProperty(Navigator.prototype, 'userAgent', {
  get: () => MOBILE_UA,
  configurable: true,
  enumerable: true
});

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

// Provide a valid mobile userAgentData object (not undefined)
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
} catch(e) {}

// ---- Block visibilitychange from triggering page reload ----
// Keep document always "visible" so qianwen doesn't reload on tab switch
try {
  Object.defineProperty(Document.prototype, 'visibilityState', {
    get: () => 'visible',
    configurable: true,
    enumerable: true
  });
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
