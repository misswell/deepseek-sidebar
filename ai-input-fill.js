(function() {
  'use strict';

  if (window.__deepseekSidebarInputFillInstalled) return;
  window.__deepseekSidebarInputFillInstalled = true;

  function isEditable(element) {
    if (!element) return false;
    const tagName = element.tagName && element.tagName.toLowerCase();
    if (tagName === 'textarea') return !element.disabled && !element.readOnly;
    if (tagName === 'input') {
      const type = (element.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'email', 'tel', ''].includes(type) && !element.disabled && !element.readOnly;
    }
    return element.isContentEditable || element.getAttribute('role') === 'textbox';
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function findInput() {
    if (isEditable(document.activeElement) && isVisible(document.activeElement)) {
      return document.activeElement;
    }

    const selectors = [
      'textarea:not([disabled]):not([readonly])',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[role="textbox"]',
      'input[type="text"]:not([disabled]):not([readonly])',
      'input:not([type]):not([disabled]):not([readonly])'
    ];

    return collectEditableCandidates(document)
      .filter((element) => isEditable(element) && isVisible(element))
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;

    function collectEditableCandidates(root) {
      const candidates = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
      Array.from(root.querySelectorAll('*')).forEach((element) => {
        if (element.shadowRoot) {
          candidates.push(...collectEditableCandidates(element.shadowRoot));
        }
      });
      return candidates;
    }
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchEditEvents(element) {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: element.value || element.textContent || ''
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillPlainInput(element, text) {
    setNativeValue(element, text);
    element.focus();
    dispatchEditEvents(element);
    return true;
  }

  function fillContentEditable(element, text) {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand && document.execCommand('insertText', false, text);
    if (!inserted) {
      element.textContent = text;
      dispatchEditEvents(element);
    }

    selection.removeAllRanges();
    return true;
  }

  function fillInput(text) {
    const input = findInput();
    if (!input) return false;

    const tagName = input.tagName.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
      return fillPlainInput(input, text);
    }

    return fillContentEditable(input, text);
  }

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'deepseek-sidebar' || data.type !== 'fill-input') return;

    const text = typeof data.text === 'string' ? data.text : '';
    const ok = fillInput(text);

    window.parent.postMessage({
      source: 'deepseek-sidebar',
      type: 'fill-input-result',
      requestId: data.requestId,
      ok
    }, '*');
  });
})();
