(function installDeepSeekPageBridge() {
  'use strict';

  // The background worker may lazily execute this file again when a tab was
  // already open before the extension was installed or reloaded. Keep the
  // existing bridge alive so its snapshot element ids remain valid across
  // browser_snapshot -> browser_click/browser_type calls.
  if (window.__deepseekSidebarPageBridgeInstalled) return;
  window.__deepseekSidebarPageBridgeInstalled = true;

  const MAX_PAGE_TEXT = 16000;
  const MAX_INTERACTIVE = 80;
  const DEFAULT_NATIVE_MAX_CHARS = 32000;
  const DEFAULT_NATIVE_MAX_ITEMS = 60;
  const DEFAULT_NATIVE_MAX_FORMS = 30;
  const SENSITIVE_FIELD_PATTERNS = [
    /password/i,
    /passwd/i,
    /credit/i,
    /card/i,
    /cvv/i,
    /cvc/i,
    /secret/i,
    /token/i,
    /pwd/i
  ];
  const nativeIds = new WeakMap();
  const nativeElements = new Map();
  let nativeNextId = 1;
  let nativeLastSnapshot = null;

  class NativeActionError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'NativeActionError';
      this.code = code;
    }
  }

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
    const directLabel = element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.innerText ||
      element.getAttribute('placeholder') ||
      element.textContent ||
      '';
    if (directLabel) return clipText(directLabel, 160);
    if (element instanceof HTMLInputElement) {
      if (['submit', 'button', 'reset'].includes(element.type) && element.value) {
        return clipText(element.value, 160);
      }
      return element.type || 'input';
    }
    return '';
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
        ? isSensitiveNativeField(element) ? maskNativeValue(element.value) : clipText(element.value, 120)
        : '',
      masked: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? isSensitiveNativeField(element) : false,
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

  const NATIVE_INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    'summary',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(', ');

  function cleanNativeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function nativePageText(root) {
    const element = root || document.body;
    if (!element) return '';
    return cleanNativeText(element.innerText || element.textContent || '');
  }

  function nativeMainText() {
    const main = document.querySelector('main, [role="main"]');
    if (main) return nativePageText(main);
    const articles = document.querySelectorAll('article');
    if (articles.length === 1) return nativePageText(articles[0]);

    let best = '';
    document.querySelectorAll('section, div').forEach(candidate => {
      const paragraphs = candidate.querySelectorAll('p').length;
      if (paragraphs < 2) return;
      const text = nativePageText(candidate);
      if (text.length * Math.min(paragraphs, 5) > best.length) best = text;
    });
    return best || nativePageText(document.body);
  }

  function isNativeInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight &&
      rect.right >= 0 && rect.left <= window.innerWidth;
  }

  function nativeAccessibleName(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return clipText(cleanNativeText(ariaLabel), 80);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const reference = document.getElementById(labelledBy.split(/\s+/)[0]);
      if (reference && cleanNativeText(reference.textContent)) {
        return clipText(cleanNativeText(reference.textContent), 80);
      }
    }
    const labelable = element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
    if (labelable) {
      if (element.id) {
        const label = document.querySelector('label[for="' + cssEscape(element.id) + '"]');
        if (label && cleanNativeText(label.textContent)) return clipText(cleanNativeText(label.textContent), 80);
      }
      const wrappingLabel = element.closest('label');
      if (wrappingLabel && cleanNativeText(wrappingLabel.textContent)) {
        return clipText(cleanNativeText(wrappingLabel.textContent), 80);
      }
    }
    if (!(element instanceof HTMLInputElement)) {
      const ownText = cleanNativeText(element.textContent);
      if (ownText) return clipText(ownText, 80);
    }
    if (element instanceof HTMLInputElement) {
      if (['submit', 'button', 'reset'].includes(element.type) && element.value) {
        return clipText(cleanNativeText(element.value), 80);
      }
      if (element.placeholder) return clipText(cleanNativeText(element.placeholder), 80);
      return element.type || 'input';
    }
    return element.tagName.toLowerCase();
  }

  function isSensitiveNativeField(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'password') return true;
      const autocomplete = String(element.autocomplete || '');
      if (autocomplete === 'credit-card' || autocomplete.indexOf('cc-') === 0) return true;
    }
    const name = element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.name : '';
    const haystack = [element.id, name, element.getAttribute('aria-label')]
      .filter(Boolean).join(' ');
    return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(haystack));
  }

  function maskNativeValue(value) {
    return value ? '••••' : '';
  }

  function assignNativeIds(elements) {
    const current = new Set(elements);
    let removed = 0;
    for (const [id, element] of nativeElements) {
      if (!current.has(element)) {
        nativeElements.delete(id);
        nativeIds.delete(element);
        removed += 1;
      }
    }
    let added = 0;
    for (const element of elements) {
      if (nativeIds.has(element)) continue;
      const id = nativeNextId++;
      nativeIds.set(element, id);
      nativeElements.set(id, element);
      element.setAttribute('data-dsh-el', String(id));
      added += 1;
    }
    return { added, removed };
  }

  function nativeRoleOf(element) {
    const role = element.getAttribute('role');
    if (role) return role;
    if (element instanceof HTMLAnchorElement) return 'link';
    if (element instanceof HTMLButtonElement) return 'button';
    if (element instanceof HTMLInputElement) {
      return ['checkbox', 'radio'].includes(element.type) ? element.type : 'input';
    }
    if (element instanceof HTMLSelectElement) return 'select';
    if (element instanceof HTMLTextAreaElement) return 'textarea';
    if (element instanceof HTMLElement && element.isContentEditable) return 'contenteditable';
    return element.tagName.toLowerCase();
  }

  function nativeItem(element, inViewport) {
    const item = {
      index: nativeIds.get(element),
      role: nativeRoleOf(element),
      name: nativeAccessibleName(element),
      inViewport: Boolean(inViewport)
    };
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
      item.checked = element.checked;
    }
    const ariaChecked = element.getAttribute('aria-checked');
    if (ariaChecked === 'true' || ariaChecked === 'false') item.checked = ariaChecked === 'true';
    if (element instanceof HTMLAnchorElement && element.href) {
      try {
        const url = new URL(element.href);
        item.href = url.origin === location.origin ? url.pathname + url.search : url.host + url.pathname;
      } catch (error) {
        item.href = element.href;
      }
    }
    return item;
  }

  function nativeFormField(element) {
    const sensitive = isSensitiveNativeField(element);
    const checkable = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type);
    let value = '';
    if (!checkable) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) value = element.value;
      else if (element instanceof HTMLSelectElement) {
        value = Array.from(element.selectedOptions).map(option => option.textContent || '').join(', ');
      }
    }
    return {
      index: nativeIds.get(element),
      label: nativeAccessibleName(element),
      kind: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase(),
      value: sensitive ? maskNativeValue(value) : clipText(value, 120),
      masked: sensitive,
      ...(checkable ? { checked: element.checked } : {}),
      ...(element instanceof HTMLInputElement && element.required ? { required: true } : {})
    };
  }

  function nativeSnapshot(args, budget) {
    const elements = Array.from(document.querySelectorAll(NATIVE_INTERACTIVE_SELECTOR))
      .filter(isVisible);
    const counts = assignNativeIds(elements);
    const maxItems = Number.isInteger(budget.maxItems) && budget.maxItems > 0
      ? budget.maxItems : DEFAULT_NATIVE_MAX_ITEMS;
    const maxForms = Number.isInteger(budget.maxForms) && budget.maxForms > 0
      ? budget.maxForms : DEFAULT_NATIVE_MAX_FORMS;
    const maxChars = Number.isInteger(budget.maxChars) && budget.maxChars >= 500
      ? budget.maxChars : DEFAULT_NATIVE_MAX_CHARS;
    const ordered = elements.map(element => ({ element, inViewport: isNativeInViewport(element) }))
      .sort((a, b) => Number(b.inViewport) - Number(a.inViewport));
    const items = ordered.slice(0, maxItems).map(item => nativeItem(item.element, item.inViewport));
    const formElements = elements.filter(element => element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement);
    const forms = formElements.slice(0, maxForms).map(nativeFormField);
    const source = args && typeof args.region === 'string' && args.region
      ? (() => {
        let region;
        try { region = document.querySelector(args.region); } catch (error) {
          throw new NativeActionError('bad-args', 'region selector 无效');
        }
        if (!region) throw new NativeActionError('action-failed', '找不到 region：' + args.region);
        return nativePageText(region);
      })()
      : nativeMainText();
    const mainLimit = Math.floor(maxChars * 0.5);
    const main = clipText(source, mainLimit);
    const view = {
      version: nativeLastSnapshot ? nativeLastSnapshot.version + 1 : 1,
      title: document.title || '',
      url: location.href,
      ready: document.readyState === 'complete' ? 'complete' : 'loading',
      main,
      items,
      forms,
      changed: [],
      removed: [],
      reindexed: Boolean(nativeLastSnapshot &&
        counts.added + counts.removed > elements.length * 0.5),
      truncated: {
        mainChars: Math.max(0, source.length - main.length),
        itemsDropped: Math.max(0, elements.length - maxItems),
        formsDropped: Math.max(0, formElements.length - maxForms)
      },
      budgetChars: maxChars,
      added: counts.added
    };
    if (args && args.delta === true && nativeLastSnapshot) {
      const beforeItems = new Map(nativeLastSnapshot.items.map(item => [item.index, item]));
      const beforeForms = new Map(nativeLastSnapshot.forms.map(form => [form.index, form]));
      view.changed = [];
      if (nativeLastSnapshot.title !== view.title || nativeLastSnapshot.url !== view.url ||
          nativeLastSnapshot.main !== view.main) view.changed.push(-1);
      view.items.forEach(item => {
        if (JSON.stringify(beforeItems.get(item.index)) !== JSON.stringify(item)) view.changed.push(item.index);
      });
      view.forms.forEach(form => {
        if (JSON.stringify(beforeForms.get(form.index)) !== JSON.stringify(form) &&
            !view.changed.includes(form.index)) view.changed.push(form.index);
      });
      const currentIds = new Set(view.items.map(item => item.index));
      nativeLastSnapshot.items.forEach(item => {
        if (!currentIds.has(item.index)) view.removed.push(item.index);
      });
    }
    nativeLastSnapshot = view;
    return view;
  }

  function nativeRenderItem(item) {
    const state = [
      item.disabled ? 'disabled' : '',
      item.checked === undefined ? '' : item.checked ? 'checked' : 'unchecked',
      item.inViewport ? '' : 'outside viewport'
    ].filter(Boolean).join('/');
    return '  [' + item.index + '] ' + item.role + ' "' + item.name + '"' +
      (state ? ' [' + state + ']' : '') + (item.href ? ' → ' + item.href : '');
  }

  function nativeRenderForm(form, includeIdentity) {
    const identity = includeIdentity ? form.label + ' (' + form.kind + ') ' : '';
    const state = form.checked === undefined
      ? 'value="' + (form.masked ? '••••' : form.value) + '"'
      : 'checked=' + String(form.checked);
    return '  [' + form.index + '] ' + identity + state + (form.required ? ' required' : '');
  }

  function nativeRenderSnapshot(view, delta, maxChars) {
    const lines = [];
    if (delta) {
      lines.push('Page change v' + view.version + ' (' + view.url + ')');
      lines.push('Status: ' + view.ready);
      if (view.changed.includes(-1)) {
        lines.push('Title: ' + (view.title || '(untitled)'));
        if (view.main) lines.push('\nChanged main content:\n' + view.main);
      }
      const changedItems = view.items.filter(item => view.changed.includes(item.index));
      const changedForms = view.forms.filter(form => view.changed.includes(form.index));
      if (changedItems.length) lines.push('\nChanged interactive elements:\n' + changedItems.map(nativeRenderItem).join('\n'));
      if (changedForms.length) lines.push('\nChanged form fields:\n' + changedForms.map(form =>
        nativeRenderForm(form, !changedItems.some(item => item.index === form.index))).join('\n'));
      if (view.removed.length) lines.push('Removed elements: ' + view.removed.join(', '));
      if (!view.changed.length && !view.removed.length) lines.push('(No visible changes.)');
    } else {
      lines.push('Title: ' + (view.title || '(untitled)'));
      lines.push('URL: ' + view.url);
      lines.push('Status: ' + view.ready);
      if (view.main) lines.push('\nMain content:\n' + view.main);
      if (view.items.length) lines.push('\nInteractive elements:\n' + view.items.map(nativeRenderItem).join('\n'));
      if (view.forms.length) lines.push('\nForm fields:\n' + view.forms.map(form =>
        nativeRenderForm(form, !view.items.some(item => item.index === form.index))).join('\n'));
    }
    const notes = [];
    if (view.truncated.mainChars > 0) notes.push('Main content truncated');
    if (view.truncated.itemsDropped > 0) notes.push(view.truncated.itemsDropped + ' additional elements omitted');
    if (view.truncated.formsDropped > 0) notes.push(view.truncated.formsDropped + ' additional form fields omitted');
    if (notes.length) lines.push('\n(' + notes.join('; ') + '.)');
    return clipText(lines.join('\n'), maxChars || view.budgetChars);
  }

  function nativeActionDelta(budget) {
    if (!nativeLastSnapshot) return {};
    const view = nativeSnapshot({ delta: true }, budget || {});
    return {
      pageContent: nativeRenderSnapshot(
        view,
        true,
        Math.min(view.budgetChars, 4000)
      )
    };
  }

  function withNativeActionDelta(result, budget) {
    const delta = nativeActionDelta(budget).pageContent;
    if (!delta) return result;
    return Object.assign({}, result, { text: result.text + '\n\n' + delta });
  }

  function nativeElementByIndex(args) {
    const value = args && args.index;
    if (!Number.isInteger(value) || value < 0) {
      throw new NativeActionError('bad-args', 'index 必须是非负整数');
    }
    const element = nativeElements.get(value);
    if (!element || !document.documentElement.contains(element)) {
      throw new NativeActionError('action-failed', '元素 [' + value + '] 不存在，请先重新读取 browser_snapshot');
    }
    if (!isVisible(element)) throw new NativeActionError('action-failed', '元素 [' + value + '] 当前不可见');
    return element;
  }

  function setElementValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function nativeSetValue(element, value) {
    setElementValue(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nativeWaitForSettled(minimumMs, quietMs, maxMs) {
    const started = Date.now();
    let lastMutation = started;
    let timer = null;
    let observer = null;
    return new Promise(resolve => {
      const finish = value => {
        if (timer) clearTimeout(timer);
        if (observer) observer.disconnect();
        resolve(value);
      };
      const check = () => {
        const now = Date.now();
        if (document.readyState === 'complete' && now - started >= minimumMs &&
            (now - lastMutation >= quietMs || now - started >= maxMs)) {
          finish(true);
          return;
        }
        if (now - started >= maxMs) {
          finish(false);
          return;
        }
        timer = setTimeout(check, 25);
      };
      if (document.documentElement && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => { lastMutation = Date.now(); });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      check();
    });
  }

  async function nativeRunAction(action, args, budget) {
    const name = String(action || '');
    if (name === 'browser_snapshot') {
      const view = nativeSnapshot(args || {}, budget || {});
      return { text: nativeRenderSnapshot(view, args && args.delta === true, view.budgetChars) };
    }
    if (name === 'browser_get_text') {
      const selector = args && typeof args.selector === 'string' && args.selector ? args.selector : '';
      let source = document.body;
      if (selector) {
        try { source = document.querySelector(selector); } catch (error) {
          throw new NativeActionError('bad-args', 'selector 无效：' + selector);
        }
        if (!source) return { text: 'No element matched selector: ' + selector };
      }
      return { text: clipText(nativePageText(source), 8000) };
    }
    if (name === 'browser_navigate') {
      const url = args && typeof args.url === 'string' ? args.url : '';
      let parsed;
      try { parsed = new URL(url, location.href); } catch (error) {
        throw new NativeActionError('bad-args', '导航地址无效');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new NativeActionError('bad-args', '只允许导航到 http/https 页面');
      }
      nativeLastSnapshot = null;
      setTimeout(() => { location.href = parsed.href; }, 0);
      return { text: 'Navigating to ' + parsed.href + '. Call browser_snapshot again after the page loads.', navigationPending: true };
    }
    if (name === 'browser_back' || name === 'browser_forward' || name === 'browser_reload') {
      nativeLastSnapshot = null;
      setTimeout(() => {
        if (name === 'browser_back') history.back();
        else if (name === 'browser_forward') history.forward();
        else location.reload();
      }, 0);
      return { text: 'Navigating through the browser. Call browser_snapshot again after the page loads.', navigationPending: true };
    }
    if (name === 'browser_scroll') {
      const direction = args && args.direction;
      const amount = typeof (args && args.amount) === 'number'
        ? Math.max(1, Math.abs(args.amount)) : Math.floor(window.innerHeight * 0.8);
      if (direction === 'top') window.scrollTo(0, 0);
      else if (direction === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
      else if (direction === 'up') window.scrollBy(0, -amount);
      else if (direction === 'down') window.scrollBy(0, amount);
      else throw new NativeActionError('bad-args', 'direction 必须是 up、down、top 或 bottom');
      await nativeWaitForSettled(50, 50, 250);
      return withNativeActionDelta({ text: 'Scrolled ' + direction + '.' }, budget);
    }
    if (name === 'browser_wait') {
      const waitMs = typeof (args && args.ms) === 'number' ? Math.min(5000, Math.max(0, args.ms)) : 0;
      await nativeWaitForSettled(100, 100, 1000);
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      return withNativeActionDelta({
        text: 'The page is stable' + (waitMs ? ' after an additional ' + waitMs + 'ms wait.' : '.')
      }, budget);
    }

    if (name === 'browser_press') {
      const hasIndex = args && Object.prototype.hasOwnProperty.call(args, 'index');
      const target = hasIndex
        ? nativeElementByIndex(args || {})
        : document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      if (target instanceof HTMLElement) {
        target.focus();
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const key = typeof args.key === 'string' ? args.key : '';
      if (!key) throw new NativeActionError('bad-args', 'key 不能为空');
      const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(keydown);
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      if (key === 'Enter' && !keydown.defaultPrevented && target instanceof HTMLElement && target.form) {
        // Dispatching a synthetic submit event only notifies listeners; it
        // does not perform the browser's submit algorithm. requestSubmit()
        // does, including validation and the form's submit event.
        if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
        else HTMLFormElement.prototype.submit.call(target.form);
      }
      await nativeWaitForSettled(100, 50, 300);
      return withNativeActionDelta({ text: 'Sent key "' + key + '".' }, budget);
    }

    const element = nativeElementByIndex(args || {});
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (name === 'browser_click') {
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
        throw new NativeActionError('action-failed', '元素已禁用');
      }
      const targetName = element instanceof HTMLAnchorElement
        ? element.target.trim().toLowerCase() : '';
      const sameFrameTarget = !targetName || targetName === '_self';
      let href = null;
      if (element instanceof HTMLAnchorElement && element.href) {
        try { href = new URL(element.href); } catch (error) {}
      }
      if (element instanceof HTMLAnchorElement && sameFrameTarget && href &&
          !element.hasAttribute('download') && ['http:', 'https:'].includes(href.protocol)) {
        setTimeout(() => { element.click(); }, 0);
        return { text: 'Clicked link [' + args.index + ']. Call browser_snapshot again after navigation settles.', navigationPending: true };
      }
      if (element instanceof HTMLAnchorElement) {
        element.click();
        await nativeWaitForSettled(100, 50, 300);
        return withNativeActionDelta({ text: 'Clicked link [' + args.index + '].' }, budget);
      }
      element.click();
      await nativeWaitForSettled(100, 50, 300);
      return withNativeActionDelta({ text: 'Clicked [' + args.index + '].' }, budget);
    }
    if (name === 'browser_type') {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) throw new NativeActionError('bad-args', 'text 不能为空');
      const replace = args.replace === true;
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        nativeSetValue(element, replace ? text : element.value + text);
      } else if (element instanceof HTMLElement && element.isContentEditable) {
        element.textContent = replace ? text : (element.textContent || '') + text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        throw new NativeActionError('action-failed', '元素不是可编辑输入框');
      }
      await nativeWaitForSettled(32, 32, 150);
      return withNativeActionDelta({
        text: 'Entered ' + text.length + ' characters into [' + args.index + '].'
      }, budget);
    }
    throw new NativeActionError('bad-args', '未知浏览器动作：' + name);
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
      setElementValue(element, text);
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

  const legacyMessageListener = (message, sender, sendResponse) => {
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
  };
  chrome.runtime.onMessage.addListener(legacyMessageListener);

  const nativeMessageListener = (message, sender, sendResponse) => {
    if (!message || message.type !== 'DSH_ACTION') return undefined;
    Promise.resolve()
      .then(() => nativeRunAction(message.action, message.args || {}, message.budget || {}))
      .then(value => sendResponse({ ok: true, result: value }))
      .catch(error => sendResponse({
        ok: false,
        error: {
          code: error && error.code ? error.code : 'action-failed',
          message: error && error.message ? error.message : String(error)
        }
      }));
    return true;
  };
  chrome.runtime.onMessage.addListener(nativeMessageListener);

  window.__deepseekSidebarPageBridgeDispose = () => {
    try { chrome.runtime.onMessage.removeListener(legacyMessageListener); } catch (error) {}
    try { chrome.runtime.onMessage.removeListener(nativeMessageListener); } catch (error) {}
    delete window.__deepseekSidebarPageBridgeDispose;
    delete window.__deepseekSidebarPageBridgeInstalled;
  };
})();
