(function installDeepSeekSidebarHarnessBridge() {
  'use strict';

  if (window.__deepseekSidebarHarnessBridgeInstalled) return;
  window.__deepseekSidebarHarnessBridgeInstalled = true;

  // The bridge only belongs to the Harness document embedded in the side panel.
  // A dynamically registered content script can also match a normal Harness tab,
  // so avoid changing that page when it is not inside the extension.
  if (window.parent === window || window.parent !== window.top) return;

  const SOURCE = 'deepseek-sidebar-harness-embedded';
  const MAX_ACTIONS = 8;
  const ALLOWED_ACTIONS = new Set([
    'back',
    'click',
    'fill',
    'forward',
    'hover',
    'navigate',
    'press',
    'reload',
    'scroll',
    'select',
    'wait'
  ]);

  let submitting = false;
  let replayingSubmit = false;
  let responseBusy = false;
  let activeTask = null;
  let processedResponseKeys = new Set();
  let observerStarted = false;

  function post(type, value) {
    try {
      window.parent.postMessage({
        source: SOURCE,
        type,
        ...(value && typeof value === 'object' ? value : {})
      }, '*');
    } catch (error) {
      // The side panel can disappear while a Harness response is finishing.
    }
  }

  function request(command, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        source: SOURCE,
        command,
        ...(payload || {})
      }, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response || response.ok !== true) {
          reject(new Error(response && response.error ? response.error : '扩展没有返回结果'));
          return;
        }
        resolve(response.value);
      });
    });
  }

  function findComposer() {
    return document.querySelector([
      'textarea[aria-label="给智能体发消息"]',
      'textarea[aria-label="描述你想要构建的内容"]',
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"][role="textbox"]'
    ].join(','));
  }

  function composerText(composer) {
    if (!composer) return '';
    if ('value' in composer) return String(composer.value || '');
    return String(composer.innerText || composer.textContent || '');
  }

  function setComposerText(composer, value) {
    if (!composer) return;
    const text = String(value || '');
    composer.focus();
    if ('value' in composer) {
      if (composer.value === text) return;
      if (typeof composer.select === 'function') composer.select();
      try {
        // execCommand goes through the browser editing pipeline and emits the
        // trusted input event expected by the Harness React composer.
        if (document.execCommand('insertText', false, text) && composer.value === text) {
          composer.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      } catch (error) {}
      const prototype = composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(composer, text);
      else composer.value = text;
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      try {
        if (document.execCommand('insertText', false, text) && composerText(composer) === text) return;
      } catch (error) {}
      composer.textContent = text;
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
    }
  }

  function findSendButton() {
    return Array.from(document.querySelectorAll('button')).find(button => {
      const label = button.getAttribute('aria-label') || '';
      return label === '发送消息' || label.toLowerCase() === 'send message';
    });
  }

  function actionResponseKey(parsed) {
    return JSON.stringify({
      done: parsed.done,
      message: parsed.message,
      actions: parsed.actions
    });
  }

  function extractJsonCandidates(text) {
    const value = String(text || '').trim();
    if (!value) return [];
    const candidates = [value];
    const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match;
    while ((match = fencePattern.exec(value))) candidates.push(match[1].trim());
    const firstBrace = value.indexOf('{');
    const lastBrace = value.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(value.slice(firstBrace, lastBrace + 1));
    }
    return [...new Set(candidates)];
  }

  function parseActionResponse(text) {
    for (const candidate of extractJsonCandidates(text)) {
      let value;
      try {
        value = JSON.parse(candidate);
      } catch (error) {
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (!Array.isArray(value.actions) && typeof value.done !== 'boolean') continue;

      const actions = (Array.isArray(value.actions) ? value.actions : [])
        .filter(action => action && typeof action === 'object')
        .filter(action => ALLOWED_ACTIONS.has(action.type))
        .slice(0, MAX_ACTIONS)
        .map(action => {
          const normalized = { type: action.type };
          if (typeof action.selector === 'string') normalized.selector = action.selector;
          if (action.value !== undefined || action.text !== undefined) {
            normalized.value = String(action.value !== undefined ? action.value : action.text);
          }
          if (typeof action.key === 'string') normalized.key = action.key;
          else if (action.value !== undefined && action.type === 'press') normalized.key = String(action.value);
          if (typeof action.url === 'string') normalized.url = action.url;
          if (typeof action.direction === 'string') normalized.direction = action.direction;
          if (Number.isFinite(action.amount)) normalized.amount = action.amount;
          if (Number.isFinite(action.x)) normalized.x = action.x;
          if (Number.isFinite(action.y)) normalized.y = action.y;
          if (Number.isFinite(action.waitMs)) normalized.waitMs = action.waitMs;
          else if (Number.isFinite(action.delayMs)) normalized.waitMs = action.delayMs;
          return normalized;
        });

      return {
        done: value.done === true,
        message: typeof value.message === 'string' ? value.message : '',
        actions
      };
    }
    return null;
  }

  function responseTextCandidates() {
    const selectors = ['pre', 'code', 'p', '[role="article"]'];
    const values = [];
    const assistantRoots = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]');
    for (const root of assistantRoots) {
      const elements = [root, ...root.querySelectorAll(selectors.join(','))];
      for (const element of elements) {
      const text = (element.innerText || element.textContent || '').trim();
      if (!text || text.length > 30000) continue;
      if (!text.includes('{') && !text.includes('```')) continue;
      values.push(text);
      }
    }
    return [...new Set(values)];
  }

  function snapshotForPrompt(snapshot) {
    const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
      title: typeof value.title === 'string' ? value.title : '',
      url: typeof value.url === 'string' ? value.url : '',
      text: typeof value.text === 'string' ? value.text.slice(0, 16000) : '',
      interactive: Array.isArray(value.interactive) ? value.interactive.slice(0, 120) : []
    };
  }

  function browserTaskPrompt(task, snapshot, taskId) {
    return [
      '[DeepSeek Sidebar browser task]',
      'Task id: ' + taskId,
      'The Chrome extension has attached the current browser tab snapshot below.',
      'Operate that current tab through the extension. Do not claim that you used a browser tool.',
      'Return exactly one JSON object and no Markdown outside it:',
      '{"done":false,"message":"short status","actions":[{"type":"click","selector":"#example"}]}',
      'Allowed action types: click, fill, press, scroll, select, hover, navigate, back, forward, reload, wait.',
      'Use selectors from the snapshot. For fill use text; for press use key; for navigate use an http/https url.',
      'If the task is complete, return {"done":true,"message":"...","actions":[]}.',
      'Current page snapshot:',
      '```json',
      JSON.stringify(snapshotForPrompt(snapshot)),
      '```',
      'User task:',
      task
    ].join('\n');
  }

  function actionResultPrompt(taskId, execution, snapshot) {
    return [
      '[DeepSeek Sidebar browser action results]',
      'Task id: ' + taskId,
      'The extension executed the previous JSON actions on the current Chrome tab.',
      'Return exactly one JSON object and no Markdown outside it.',
      'If more actions are needed, return {"done":false,"message":"...","actions":[...]}.',
      'If the task is complete, return {"done":true,"message":"...","actions":[]}.',
      'Execution results:',
      '```json',
      JSON.stringify(execution || {}),
      '```',
      'Updated page snapshot:',
      '```json',
      JSON.stringify(snapshotForPrompt(snapshot)),
      '```'
    ].join('\n');
  }

  function waitForSendButton() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const button = findSendButton();
        if (button && !button.disabled) {
          resolve(button);
          return;
        }
        if (Date.now() - startedAt > 10000) {
          reject(new Error('Harness 输入框暂时不可用'));
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  async function sendRawPrompt(prompt) {
    const composer = findComposer();
    if (!composer) throw new Error('找不到 Harness 输入框');
    setComposerText(composer, prompt);
    const button = await waitForSendButton();
    replayingSubmit = true;
    try {
      button.click();
    } finally {
      replayingSubmit = false;
    }
  }

  async function submitBrowserTask() {
    if (submitting) return;
    const composer = findComposer();
    const task = composerText(composer).trim();
    if (!task) return;

    submitting = true;
    const taskId = 'browser-task-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
    activeTask = { id: taskId, task };
    processedResponseKeys = new Set(responseTextCandidates()
      .map(parseActionResponse)
      .filter(Boolean)
      .map(actionResponseKey));
    post('status', { message: '正在读取当前标签页…', state: 'working' });

    try {
      const result = await request('snapshot');
      await sendRawPrompt(browserTaskPrompt(task, result && result.snapshot, taskId));
      post('status', { message: '已把当前页面上下文交给 Harness', state: 'ready' });
    } catch (error) {
      activeTask = null;
      post('error', { message: error && error.message ? error.message : String(error) });
    } finally {
      submitting = false;
    }
  }

  async function handleActionResponse(parsed) {
    if (!activeTask || responseBusy) return;
    responseBusy = true;
    try {
      if (!parsed.actions.length) {
        if (parsed.done) {
          post('status', { message: parsed.message || '任务已完成。', state: 'done' });
          activeTask = null;
        }
        return;
      }

      post('status', { message: 'Harness 正在操作当前标签页…', state: 'working' });
      const execution = await request('execute', { actions: parsed.actions });
      const refreshed = await request('snapshot');
      if (parsed.done) {
        post('status', { message: parsed.message || '任务已完成。', state: 'done' });
        activeTask = null;
        return;
      }
      await sendRawPrompt(actionResultPrompt(activeTask.id, execution, refreshed && refreshed.snapshot));
      post('status', { message: '动作已执行，等待 Harness 下一步…', state: 'ready' });
    } catch (error) {
      post('error', { message: error && error.message ? error.message : String(error) });
      activeTask = null;
    } finally {
      responseBusy = false;
    }
  }

  function scanAssistantResponses() {
    if (!activeTask || responseBusy) return;
    for (const text of responseTextCandidates()) {
      const parsed = parseActionResponse(text);
      if (!parsed) continue;
      const key = actionResponseKey(parsed);
      if (processedResponseKeys.has(key)) continue;
      processedResponseKeys.add(key);
      void handleActionResponse(parsed);
      break;
    }
  }

  function isComposerTarget(target) {
    const composer = findComposer();
    return Boolean(composer && target && (target === composer || composer.contains(target)));
  }

  function onKeyDown(event) {
    if (replayingSubmit || event.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    if (!isComposerTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void submitBrowserTask();
  }

  function onClick(event) {
    if (replayingSubmit) return;
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || target.disabled) return;
    const label = target.getAttribute('aria-label') || '';
    if (label !== '发送消息' && label.toLowerCase() !== 'send message') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void submitBrowserTask();
  }

  function start() {
    if (observerStarted) return;
    observerStarted = true;
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    const observer = new MutationObserver(() => scanAssistantResponses());
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    post('ready', { url: location.href });
    scanAssistantResponses();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
