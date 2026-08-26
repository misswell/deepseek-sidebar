(function attachHarnessBridgeClient(root, factory) {
  const protocol = root.DeepSeekHarnessProtocol ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./harness-protocol.js')
      : null);
  if (!protocol) throw new Error('harness-protocol.js must load before harness-bridge-client.js');

  const api = factory(root, protocol);
  root.DeepSeekHarnessBridgeClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createHarnessBridgeClient(root, protocol) {
  const DEFAULT_TIMEOUT_MS = 30000;
  const DEFAULT_HELLO_TIMEOUT_MS = 5000;
  const BACKOFF_BASE_MS = 500;
  const BACKOFF_MAX_MS = 10000;

  function makeId(prefix) {
    const cryptoObject = root.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID();
    }
    return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function isOpen(socket, WebSocketImpl) {
    const openState = WebSocketImpl && typeof WebSocketImpl.OPEN === 'number'
      ? WebSocketImpl.OPEN : 1;
    return Boolean(socket && socket.readyState === openState);
  }

  function safeInvoke(callback, value) {
    try {
      if (typeof callback === 'function') callback(value);
    } catch (error) {
      // A UI callback must never tear down the bridge transport.
    }
  }

  class HarnessBridgeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'HarnessBridgeError';
      this.code = code;
    }
  }

  class DeepSeekHarnessBridgeClient {
    constructor(options) {
      const config = options || {};
      this.WebSocketImpl = config.WebSocketImpl || root.WebSocket;
      this.reconnect = config.reconnect !== false;
      this.helloTimeoutMs = Number.isFinite(config.helloTimeoutMs)
        ? config.helloTimeoutMs : DEFAULT_HELLO_TIMEOUT_MS;
      this.timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
      this.backoffBaseMs = Number.isFinite(config.backoffBaseMs)
        ? Math.max(0, config.backoffBaseMs) : BACKOFF_BASE_MS;
      this.backoffMaxMs = Number.isFinite(config.backoffMaxMs)
        ? Math.max(this.backoffBaseMs, config.backoffMaxMs) : BACKOFF_MAX_MS;
      this.onStateChange = config.onStateChange || (() => {});
      this.onFrame = config.onFrame || (() => {});
      this.onHelloOk = config.onHelloOk || (() => {});
      this.onToolCall = config.onToolCall || (async () => {
        throw new HarnessBridgeError('internal', '没有注册浏览器工具处理器');
      });
      this.ws = null;
      this.url = '';
      this.token = '';
      this.caps = null;
      this.running = false;
      this.authenticated = false;
      this.attempt = 0;
      this.generation = 0;
      this.retryTimer = null;
      this.ackTimer = null;
      this.pending = new Map();
      this.activeTools = new Map();
      this.state = 'stopped';
      this.lastError = '';
    }

    start(url, token) {
      if (typeof url !== 'string' || !url.trim()) {
        throw new Error('Harness bridge WebSocket 地址不能为空');
      }
      this.stop();
      this.url = url.trim();
      this.token = typeof token === 'string' ? token : '';
      this.running = true;
      this.attempt = 0;
      this.lastError = '';
      const generation = ++this.generation;
      this.connect(generation);
    }

    stop() {
      this.running = false;
      this.generation += 1;
      this.clearRetryTimer();
      this.clearAckTimer();
      const socket = this.ws;
      this.ws = null;
      this.authenticated = false;
      if (socket && (socket.readyState === 0 || isOpen(socket, this.WebSocketImpl))) {
        try { socket.close(); } catch (error) {}
      }
      this.rejectPending(new HarnessBridgeError('bridge-closed', 'Harness bridge 已断开'));
      for (const controller of this.activeTools.values()) controller.abort();
      this.activeTools.clear();
      this.emitState('stopped');
    }

    get connected() {
      return isOpen(this.ws, this.WebSocketImpl) && this.authenticated;
    }

    send(frame) {
      if (!this.connected) return false;
      try {
        this.ws.send(JSON.stringify(frame));
        return true;
      } catch (error) {
        return false;
      }
    }

    request(method, payload, options) {
      const config = options || {};
      if (!this.connected) {
        return Promise.reject(new HarnessBridgeError('bridge-closed', '没有连接到 Harness 浏览器 bridge'));
      }
      if (config.signal && config.signal.aborted) {
        return Promise.reject(new HarnessBridgeError('bridge-closed', '请求在发送前已取消'));
      }

      const id = makeId('rpc');
      const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : this.timeoutMs;
      return new Promise((resolve, reject) => {
        let timer;
        let removeAbort = null;
        const settle = (callback, value) => {
          clearTimeout(timer);
          if (removeAbort) removeAbort();
          if (this.pending.get(id) === pending) this.pending.delete(id);
          callback(value);
        };
        const onAbort = () => settle(reject, new HarnessBridgeError('bridge-closed', 'Harness RPC 已取消'));
        const pending = { resolve, reject, settle, onAbort };
        timer = setTimeout(() => settle(reject,
          new HarnessBridgeError('timeout', 'Harness RPC 请求超时')), Math.max(1, timeoutMs));
        if (config.signal) {
          config.signal.addEventListener('abort', onAbort, { once: true });
          removeAbort = () => config.signal.removeEventListener('abort', onAbort);
        }
        this.pending.set(id, pending);
        const sent = this.send({
          t: 'rpc',
          id,
          method: String(method || ''),
          payload: payload === undefined ? {} : payload
        });
        if (!sent) settle(reject,
          new HarnessBridgeError('bridge-closed', 'Harness bridge 在请求发送前已断开'));
      });
    }

    connect(generation) {
      if (!this.running || generation !== this.generation) return;
      this.emitState('connecting');
      let socket;
      try {
        if (typeof this.WebSocketImpl !== 'function') {
          throw new Error('当前 Chrome 不支持 WebSocket');
        }
        socket = new this.WebSocketImpl(this.url);
      } catch (error) {
        this.lastError = error && error.message ? error.message : String(error);
        this.scheduleReconnect(generation);
        return;
      }
      this.ws = socket;
      this.authenticated = false;

      socket.addEventListener('open', () => {
        if (this.ws !== socket || !this.running || generation !== this.generation) return;
        try {
          socket.send(JSON.stringify({
            t: 'hello',
            token: this.token,
            caps: {
              textOnly: true,
              snapshotMaxChars: protocol.DEFAULT_SNAPSHOT_MAX_CHARS,
              maxInteractiveItems: protocol.DEFAULT_MAX_INTERACTIVE_ITEMS
            }
          }));
        } catch (error) {
          this.lastError = error && error.message ? error.message : String(error);
          try { socket.close(); } catch (closeError) {}
          return;
        }
        this.clearAckTimer();
        this.ackTimer = setTimeout(() => {
          if (this.ws === socket && !this.authenticated) {
            this.lastError = 'Harness bridge 握手超时';
            try { socket.close(); } catch (error) {}
          }
        }, Math.max(1, this.helloTimeoutMs));
      });

      socket.addEventListener('message', event => {
        if (this.ws !== socket) return;
        const frame = protocol.parseBridgeFrame(event && event.data);
        if (!frame) return;
        if (!this.authenticated) {
          if (frame.t === 'hello.ok') {
            this.authenticated = true;
            this.caps = frame.caps;
            this.attempt = 0;
            this.lastError = '';
            this.clearAckTimer();
            safeInvoke(this.onHelloOk, frame.caps);
            this.emitState('connected');
          } else if (frame.t === 'error') {
            this.lastError = frame.message;
            safeInvoke(this.onFrame, frame);
          }
          return;
        }
        this.handleFrame(frame, socket);
      });

      socket.addEventListener('close', event => {
        if (this.ws !== socket) return;
        this.ws = null;
        this.authenticated = false;
        this.clearAckTimer();
        this.rejectPending(new HarnessBridgeError('bridge-closed', 'Harness bridge 连接已关闭'));
        if (!this.running || generation !== this.generation) {
          this.emitState('stopped');
          return;
        }
        this.lastError = this.lastError || (event && event.reason ? event.reason : 'Harness bridge 连接已关闭');
        this.scheduleReconnect(generation);
      });

      socket.addEventListener('error', () => {
        if (this.ws === socket && !this.lastError) this.lastError = 'Harness bridge WebSocket 连接失败';
      });
    }

    handleFrame(frame, socket) {
      if (frame.t === 'ping') {
        try { socket.send(JSON.stringify({ t: 'pong' })); } catch (error) {}
        return;
      }
      if (frame.t === 'rpc.result') {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        if (frame.ok) {
          pending.settle(pending.resolve, frame.result);
        } else {
          const detail = frame.error || {};
          pending.settle(pending.reject,
            new HarnessBridgeError(detail.code || 'internal', detail.message || 'Harness RPC 失败'));
        }
        return;
      }
      if (frame.t === 'tool.call') {
        this.dispatchTool(frame);
        return;
      }
      if (frame.t === 'tool.cancel') {
        const controller = this.activeTools.get(frame.id);
        if (controller) controller.abort();
        return;
      }
      safeInvoke(this.onFrame, frame);
    }

    dispatchTool(frame) {
      if (frame.expiresAt <= Date.now()) {
        this.sendToolError(frame.id, 'timeout', '浏览器工具调用已过期');
        return;
      }
      const controller = new AbortController();
      this.activeTools.set(frame.id, controller);
      Promise.resolve()
        .then(() => this.onToolCall(frame, controller.signal))
        .then(result => {
          if (!controller.signal.aborted) this.sendToolResult(frame.id, result);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          this.sendToolError(frame.id,
            error && error.code ? error.code : 'action-failed',
            error && error.message ? error.message : String(error));
        })
        .finally(() => {
          if (this.activeTools.get(frame.id) === controller) this.activeTools.delete(frame.id);
        });
    }

    sendToolResult(id, result) {
      if (result && result.ok === false && result.error) {
        this.sendToolError(id, result.error.code || 'action-failed', result.error.message || '浏览器工具失败');
        return;
      }
      this.send({ t: 'tool.result', id, ok: true, result });
    }

    sendToolError(id, code, message) {
      this.send({
        t: 'tool.result',
        id,
        ok: false,
        error: { code: String(code || 'internal'), message: String(message || '浏览器工具失败') }
      });
    }

    rejectPending(error) {
      const entries = [...this.pending.values()];
      for (const pending of entries) pending.settle(pending.reject, error);
    }

    scheduleReconnect(generation) {
      if (!this.running || generation !== this.generation) return;
      if (!this.reconnect) {
        this.emitState('stopped');
        return;
      }
      this.clearRetryTimer();
      this.emitState('reconnecting');
      this.attempt += 1;
      const cap = Math.min(this.backoffMaxMs,
        this.backoffBaseMs * 2 ** Math.max(0, this.attempt - 1));
      const delay = cap === 0 ? 0 : cap / 2 + Math.random() * (cap / 2);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect(generation);
      }, delay);
    }

    clearRetryTimer() {
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    }

    clearAckTimer() {
      if (this.ackTimer !== null) {
        clearTimeout(this.ackTimer);
        this.ackTimer = null;
      }
    }

    emitState(state) {
      this.state = state;
      safeInvoke(this.onStateChange, state);
    }
  }

  function probeBridge(options) {
    const config = options || {};
    const timeoutMs = Number.isFinite(config.timeoutMs)
      ? Math.max(1, config.timeoutMs) : DEFAULT_HELLO_TIMEOUT_MS + 1000;
    let client = null;
    let timer = null;
    let settled = false;

    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (client) client.stop();
        callback(value);
      };

      client = new DeepSeekHarnessBridgeClient({
        WebSocketImpl: config.WebSocketImpl,
        reconnect: false,
        helloTimeoutMs: Math.min(timeoutMs, DEFAULT_HELLO_TIMEOUT_MS),
        onStateChange: state => {
          if (settled) return;
          if (state === 'connected') {
            finish(resolve, { connected: true, caps: client.caps });
          } else if (state === 'stopped' && client.lastError) {
            finish(reject, new HarnessBridgeError('bridge-unavailable', client.lastError));
          }
        }
      });

      timer = setTimeout(() => {
        finish(reject, new HarnessBridgeError(
          'bridge-unavailable',
          client.lastError || 'Harness bridge 握手超时'
        ));
      }, timeoutMs);

      try {
        client.start(config.url, config.token || '');
      } catch (error) {
        finish(reject, new HarnessBridgeError(
          'bridge-unavailable',
          error && error.message ? error.message : String(error)
        ));
      }
    });
  }

  DeepSeekHarnessBridgeClient.Error = HarnessBridgeError;
  DeepSeekHarnessBridgeClient.probe = probeBridge;
  return DeepSeekHarnessBridgeClient;
});
