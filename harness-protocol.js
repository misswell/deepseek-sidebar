(function attachHarnessProtocol(root, factory) {
  const api = factory();
  root.DeepSeekHarnessProtocol = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createHarnessProtocol() {
  const DEFAULT_HARNESS_URL = 'http://127.0.0.1:3080';
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

  function normalizeHarnessUrl(value) {
    const input = typeof value === 'string' && value.trim()
      ? value.trim()
      : DEFAULT_HARNESS_URL;
    let url;

    try {
      url = new URL(input);
    } catch (error) {
      throw new Error('请输入完整的 Harness 地址，例如 http://127.0.0.1:3080/');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Harness 地址只能使用 http 或 https');
    }
    if (url.username || url.password) {
      throw new Error('请不要把账号密码写进 Harness 地址');
    }

    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  }

  function harnessOriginPattern(value) {
    const url = new URL(normalizeHarnessUrl(value));
    return url.protocol + '//' + url.host + '/*';
  }

  function harnessApiUrl(baseUrl, method) {
    const base = normalizeHarnessUrl(baseUrl);
    const safeMethod = String(method || '').replace(/^\/+|\/+$/g, '');
    if (!safeMethod || safeMethod.includes('..')) {
      throw new Error('无效的 Harness API 方法');
    }
    return base + '/api/' + safeMethod;
  }

  function createRpcEnvelope(method, payload, rpcId) {
    const id = rpcId || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'rpc-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    return {
      type: 'client-request',
      rpcId: id,
      method,
      payload: payload || {}
    };
  }

  function unwrapRpcResponse(response) {
    const body = response && response.result !== undefined ? response.result : response;
    if (body && body.ok === false) {
      const error = body.error || {};
      const detail = error.message || error.code || 'Harness 请求失败';
      throw new Error(detail);
    }
    if (body && body.ok === true && Object.prototype.hasOwnProperty.call(body, 'value')) {
      return body.value;
    }
    return body && Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : body;
  }

  function maxEventSeq(events) {
    return (Array.isArray(events) ? events : []).reduce((max, item) => {
      const seq = item && item.event && Number(item.event.seq);
      return Number.isFinite(seq) ? Math.max(max, seq) : max;
    }, -1);
  }

  function eventType(event) {
    return event && event.event ? event.event.type : '';
  }

  function isAfterSeq(item, sequence) {
    const seq = item && item.event && Number(item.event.seq);
    return Number.isFinite(seq) && seq > sequence;
  }

  function textFromContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter(block => block && (block.type === 'text' || block.type === 'output_text'))
      .map(block => typeof block.text === 'string' ? block.text : '')
      .join('')
      .trim();
  }

  function extractAssistantText(events, afterSeq) {
    const relevant = (Array.isArray(events) ? events : []).filter(item => isAfterSeq(item, afterSeq));
    let latest = '';

    relevant.forEach(item => {
      const event = item.event;
      if (!event) return;
      if (event.type === 'assistant/message') {
        const data = event.data || {};
        const message = data.message || data;
        const text = textFromContent(message.content || data.content);
        if (text) latest = text;
      }
    });

    if (latest) return latest;

    const deltas = relevant
      .filter(item => eventType(item) === 'assistant/chunk')
      .map(item => item.event.data && item.event.data.chunk)
      .filter(chunk => chunk && (chunk.type === 'text-delta' || chunk.type === 'text'))
      .map(chunk => chunk.text || '')
      .join('')
      .trim();
    return deltas;
  }

  function findBalancedJson(text, start) {
    const first = text[start];
    if (first !== '{' && first !== '[') return null;
    const stack = [first === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}' || char === ']') {
        if (stack[stack.length - 1] !== char) return null;
        stack.pop();
        if (stack.length === 0) return text.slice(start, index + 1);
      }
    }
    return null;
  }

  function extractJsonCandidates(text) {
    const source = typeof text === 'string' ? text.trim() : '';
    if (!source) return [];
    const candidates = [];
    const addCandidate = value => {
      try {
        const parsed = JSON.parse(value);
        if (parsed && (typeof parsed === 'object' || Array.isArray(parsed)) &&
            !candidates.some(item => JSON.stringify(item) === JSON.stringify(parsed))) {
          candidates.push(parsed);
        }
      } catch (error) {
        // Keep scanning: the model may have put prose before the JSON.
      }
    };

    addCandidate(source);
    const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match;
    while ((match = fenced.exec(source))) addCandidate(match[1].trim());

    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== '{' && source[index] !== '[') continue;
      const balanced = findBalancedJson(source, index);
      if (balanced) addCandidate(balanced);
    }
    return candidates;
  }

  function normalizeAction(action) {
    if (!action || typeof action !== 'object') return null;
    const aliases = {
      input: 'fill',
      key: 'press',
      open: 'navigate',
      scrollBy: 'scroll',
      type: 'fill'
    };
    const rawType = String(action.type || action.action || action.command || action.op || '').trim();
    const type = aliases[rawType] || rawType;
    if (!ALLOWED_ACTIONS.has(type)) return null;

    const selector = typeof action.selector === 'string' ? action.selector.trim() : '';
    const url = typeof action.url === 'string' ? action.url.trim() : '';
    const value = action.value !== undefined ? String(action.value) :
      action.text !== undefined ? String(action.text) : '';
    const key = typeof action.key === 'string' ? action.key : value;
    const amount = Number(action.amount !== undefined ? action.amount : action.deltaY);

    return {
      type,
      selector,
      url,
      value,
      key,
      amount: Number.isFinite(amount) ? amount : undefined,
      direction: typeof action.direction === 'string' ? action.direction : undefined,
      waitMs: Number.isFinite(Number(action.waitMs)) ? Number(action.waitMs) : undefined
    };
  }

  function parseBrowserActionResponse(text) {
    const source = typeof text === 'string' ? text.trim() : '';
    const candidates = extractJsonCandidates(source);

    for (const candidate of candidates) {
      const rawActions = Array.isArray(candidate)
        ? candidate
        : Array.isArray(candidate.actions) ? candidate.actions
          : Array.isArray(candidate.steps) ? candidate.steps
            : Array.isArray(candidate.commands) ? candidate.commands
              : candidate.type || candidate.action || candidate.command ? [candidate] : [];
      const actions = rawActions.map(normalizeAction).filter(Boolean).slice(0, MAX_ACTIONS);
      if (actions.length || rawActions.length === 0) {
        return {
          actions,
          done: candidate.done === true || candidate.status === 'done' || candidate.complete === true,
          message: typeof candidate.message === 'string' ? candidate.message :
            typeof candidate.reply === 'string' ? candidate.reply : '',
          raw: candidate
        };
      }
    }

    return {
      actions: [],
      done: true,
      message: source || 'Harness 没有返回可执行的网页动作',
      raw: null
    };
  }

  function clipText(value, maxLength) {
    const text = String(value || '');
    if (text.length <= maxLength) return text;
    return text.slice(0, Math.floor(maxLength * 0.75)) +
      '\n…（页面内容已截断）…\n' +
      text.slice(-Math.floor(maxLength * 0.25));
  }

  function buildBrowserTaskPrompt(options) {
    const config = options || {};
    const snapshot = config.snapshot || {};
    const previousResults = Array.isArray(config.previousResults) ? config.previousResults : [];
    const continuation = config.continuation ? '\n这是同一任务的下一轮。请根据最新快照继续，不要重复已成功的动作。' : '';
    const resultText = previousResults.length
      ? '\n上一轮动作执行结果：\n' + JSON.stringify(previousResults, null, 2)
      : '';

    return [
      '你现在是 DeepSeek Harness 的浏览器网页操作代理。',
      '本次只能控制用户明确指定的当前 Chrome 标签页；不要调用终端、文件系统、网络搜索或其它本地工具。',
      '请只根据用户任务和页面快照规划网页动作。不要输出 Markdown，不要使用代码围栏，不要解释推理。',
      '严格返回一个 JSON 对象：{"actions":[...],"done":false,"message":"给用户看的简短进度"}。',
      '允许的动作类型：click(selector)、fill(selector,value)、press(selector,key)、select(selector,value)、scroll(amount 或 direction)、hover(selector)、navigate(url)、back、forward、reload、wait(waitMs)。',
      'selector 必须优先使用页面快照中已有的 selector；不要臆造不存在的 selector。',
      '最多返回 8 个动作。只有任务已经完成时才把 done 设为 true；需要继续操作时设为 false。',
      '不要点击登录、付款、删除、发送或提交按钮，除非用户任务明确要求；如果必须确认，返回空 actions 并在 message 中说明。',
      continuation,
      resultText,
      '\n当前页面快照：\n' + JSON.stringify({
        title: snapshot.title || '',
        url: snapshot.url || '',
        text: clipText(snapshot.text || '', 12000),
        interactive: Array.isArray(snapshot.interactive) ? snapshot.interactive.slice(0, 80) : [],
        focused: snapshot.focused || null
      }, null, 2),
      '\n用户任务：\n' + String(config.task || '').trim()
    ].filter(Boolean).join('\n');
  }

  function actionLabel(action) {
    if (!action) return '未知动作';
    if (action.type === 'click') return '点击 ' + (action.selector || '目标');
    if (action.type === 'fill') return '填写 ' + (action.selector || '输入框');
    if (action.type === 'press') return '按键 ' + (action.key || '');
    if (action.type === 'navigate') return '打开 ' + action.url;
    if (action.type === 'scroll') return '滚动页面';
    if (action.type === 'select') return '选择 ' + action.value;
    if (action.type === 'wait') return '等待';
    return ({back: '后退', forward: '前进', reload: '刷新', hover: '悬停'}[action.type] || action.type);
  }

  return {
    ALLOWED_ACTIONS,
    DEFAULT_HARNESS_URL,
    MAX_ACTIONS,
    actionLabel,
    buildBrowserTaskPrompt,
    createRpcEnvelope,
    eventType,
    extractAssistantText,
    extractJsonCandidates,
    harnessApiUrl,
    harnessOriginPattern,
    isAfterSeq,
    maxEventSeq,
    normalizeAction,
    normalizeHarnessUrl,
    parseBrowserActionResponse,
    textFromContent,
    unwrapRpcResponse
  };
});
