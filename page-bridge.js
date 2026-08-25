(function installDeepSeekPageBridge() {
  'use strict';

  if (window.__deepseekSidebarPageBridgeInstalled) return;
  window.__deepseekSidebarPageBridgeInstalled = true;

  const MAX_PAGE_TEXT = 16000;
  const MAX_INTERACTIVE = 80;

  function clipText(value, maxLength) {
    const text = String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    if (text.length <= maxLength) return text;
    return text.slice(0, Math.floor(maxLength * 0.78)) +
      '\n…（页面内容已截断）…\n' +
      text.slice(-Math.floor(maxLength * 0.22));
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function selectorFor(element) {
    if (!element || !element.tagName) return '';
    if (element.id) {
      const idSelector = '#' + cssEscape(element.id);
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    }

    const stableAttributes = ['data-testid', 'data-test', 'aria-label', 'name', 'placeholder'];
    for (const attribute of stableAttributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const candidate = element.tagName.toLowerCase() + '[' + attribute + '="' +
        cssEscape(value).replace(/"/g, '\\"') + '"]';
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (error) {
        // Keep building a structural selector.
      }
    }

    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      let part = node.localName;
      const usefulClasses = Array.from(node.classList || [])
        .filter(name => !/^([a-z]+-)?([a-f0-9]{6,}|css-|sc-)/i.test(name))
        .slice(0, 2);
      if (usefulClasses.length) part += '.' + usefulClasses.map(cssEscape).join('.');

      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(child => child.localName === node.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (error) {
        // Continue with the next ancestor.
      }
      if (parts.length >= 6) break;
      node = parent;
    }
    return parts.join(' > ');
  }

  function elementLabel(element) {
    if (!element) return '';
    return clipText(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.innerText ||
      element.value ||
      element.getAttribute('placeholder') ||
      element.textContent ||
      '',
      160
    );
  }

  function elementDescriptor(element, index) {
    const rect = element.getBoundingClientRect();
    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      type: element.getAttribute('type') || '',
      text: elementLabel(element),
      ariaLabel: element.getAttribute('aria-label') || '',
      placeholder: element.getAttribute('placeholder') || '',
      name: element.getAttribute('name') || '',
      value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? clipText(element.value, 120)
        : '',
      selector: selectorFor(element),
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function collectInteractive() {
    const selectors = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[tabindex]:not([tabindex="-1"])'
    ];
    const seen = new Set();
    const elements = [];
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        if (seen.has(element) || elements.length >= MAX_INTERACTIVE) return;
        seen.add(element);
        if (isVisible(element)) elements.push(element);
      });
    });
    return elements.map(elementDescriptor);
  }

  function pageSnapshot() {
    const active = document.activeElement;
    return {
      title: document.title || '',
      url: location.href,
      text: clipText(document.body ? document.body.innerText : '', MAX_PAGE_TEXT),
      interactive: collectInteractive(),
      focused: active && active !== document.body ? {
        tag: active.tagName ? active.tagName.toLowerCase() : '',
        selector: selectorFor(active),
        text: elementLabel(active)
      } : null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        scrollHeight: document.documentElement ? document.documentElement.scrollHeight : 0
      }
    };
  }

  function findElement(selector) {
    if (!selector || typeof selector !== 'string') throw new Error('动作缺少 selector');
    let element;
    try {
      element = document.querySelector(selector);
    } catch (error) {
      throw new Error('selector 无效：' + selector);
    }
    if (!element) throw new Error('找不到元素：' + selector);
    if (!isVisible(element)) throw new Error('元素不可见：' + selector);
    return element;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchInput(element, value) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (error) {
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillElement(element, value) {
    const text = String(value || '');
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, text);
      dispatchInput(element, text);
      return;
    }
    if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand && document.execCommand('insertText', false, text);
      if (!inserted) element.textContent = text;
      dispatchInput(element, text);
      selection.removeAllRanges();
      return;
    }
    throw new Error('目标不是可填写的输入框');
  }

  function pressElement(element, key) {
    const value = String(key || 'Enter');
    element.focus();
    const eventOptions = {
      key: value,
      code: value.length === 1 ? 'Key' + value.toUpperCase() : value,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    element.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
    element.dispatchEvent(new KeyboardEvent('keyup', eventOptions));

    if (value === 'Enter' && element instanceof HTMLButtonElement) element.click();
    if ((value === 'Enter' || value === ' ') && element.getAttribute('role') === 'button') element.click();
    if (value === 'Enter' && element.form && typeof element.form.requestSubmit === 'function') {
      element.form.requestSubmit();
    }
  }

  function selectElement(element, value) {
    if (!(element instanceof HTMLSelectElement)) throw new Error('目标不是下拉框');
    const expected = String(value || '');
    const option = Array.from(element.options).find(item => item.value === expected || item.textContent.trim() === expected);
    if (!option) throw new Error('找不到选项：' + expected);
    element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function scrollPage(action) {
    const direction = String(action.direction || '').toLowerCase();
    const amount = Number.isFinite(action.amount) ? action.amount :
      direction === 'up' || direction === 'left' ? -Math.round(window.innerHeight * 0.75) :
        Math.round(window.innerHeight * 0.75);
    if (action.selector) {
      const element = findElement(action.selector);
      element.scrollBy({ top: direction === 'left' || direction === 'right' ? 0 : amount,
        left: direction === 'left' || direction === 'right' ? amount : 0,
        behavior: 'smooth' });
    } else {
      window.scrollBy({ top: direction === 'left' || direction === 'right' ? 0 : amount,
        left: direction === 'left' || direction === 'right' ? amount : 0,
        behavior: 'smooth' });
    }
  }

  async function executeAction(action) {
    const type = action && action.type;
    if (type === 'wait') {
      const waitMs = Math.max(0, Math.min(5000, Number(action.waitMs || action.amount || 500)));
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return { ok: true, type, waitMs };
    }
    if (type === 'scroll') {
      scrollPage(action);
      return { ok: true, type };
    }
    if (type === 'navigate') {
      let url;
      try { url = new URL(action.url, location.href); } catch (error) { throw new Error('导航地址无效'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许导航到 http/https 页面');
      setTimeout(() => { location.href = url.href; }, 0);
      return { ok: true, type, url: url.href };
    }
    if (type === 'back' || type === 'forward' || type === 'reload') {
      throw new Error('浏览器级动作由扩展后台执行');
    }

    const element = findElement(action.selector);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    if (type === 'click') element.click();
    else if (type === 'fill') fillElement(element, action.value);
    else if (type === 'press') pressElement(element, action.key);
    else if (type === 'select') selectElement(element, action.value);
    else if (type === 'hover') {
      ['mouseenter', 'mouseover', 'mousemove'].forEach(name => element.dispatchEvent(new MouseEvent(name, {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    } else {
      throw new Error('不支持的网页动作：' + type);
    }
    return { ok: true, type, selector: action.selector };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'deepseek-sidebar-harness-page') return undefined;
    Promise.resolve()
      .then(() => {
        if (message.command === 'snapshot') return pageSnapshot();
        if (message.command === 'execute') return executeAction(message.action || {});
        throw new Error('未知页面桥接命令');
      })
      .then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
  });
})();
