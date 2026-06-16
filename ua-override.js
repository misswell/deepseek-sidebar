// Override navigator.userAgent to mobile Safari so sites render mobile version
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
