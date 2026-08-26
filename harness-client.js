(function attachHarnessClient(root) {
  const protocol = root.DeepSeekHarnessProtocol ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./harness-protocol.js')
      : null);
  if (!protocol) throw new Error('harness-protocol.js must load before harness-client.js');

  class DeepSeekHarnessClient {
    constructor(baseUrl, options) {
      this.baseUrl = protocol.normalizeHarnessUrl(baseUrl);
      const config = options || {};
      this.fetchImpl = config.fetchImpl || root.fetch.bind(root);
      this.transport = config.transport || null;
      this.timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000;
      this.pollMs = Number.isFinite(config.pollMs) ? config.pollMs : 700;
      this.maxWaitMs = Number.isFinite(config.maxWaitMs) ? config.maxWaitMs : 120000;
    }

    async request(method, payload, options) {
      const config = options || {};
      if (this.transport) return await this.requestThroughTransport(method, payload, config);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || this.timeoutMs);
      let removeAbortListener = null;

      if (config.signal) {
        const onAbort = () => controller.abort();
        if (config.signal.aborted) controller.abort();
        else {
          config.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => config.signal.removeEventListener('abort', onAbort);
        }
      }

      try {
        const response = await this.fetchImpl(protocol.harnessApiUrl(this.baseUrl, method), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(protocol.createRpcEnvelope(method, payload)),
          signal: controller.signal
        });
        const raw = await response.text();
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (error) {
          throw new Error('Harness 返回了无法解析的响应');
        }
        if (!response.ok) {
          throw new Error('Harness 请求失败（HTTP ' + response.status + '）');
        }
        return protocol.unwrapRpcResponse(body);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(config.signal && config.signal.aborted ? '任务已停止' : 'Harness 请求超时');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (removeAbortListener) removeAbortListener();
      }
    }

    async requestThroughTransport(method, payload, options) {
      const config = options || {};
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || this.timeoutMs);
      let removeAbortListener = null;

      if (config.signal) {
        const onAbort = () => controller.abort();
        if (config.signal.aborted) controller.abort();
        else {
          config.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => config.signal.removeEventListener('abort', onAbort);
        }
      }

      try {
        const raw = await this.transport({
          baseUrl: this.baseUrl,
          method,
          payload: payload || {},
          timeoutMs: config.timeoutMs || this.timeoutMs,
          signal: controller.signal
        });
        return protocol.unwrapRpcResponse(raw);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(config.signal && config.signal.aborted ? '任务已停止' : 'Harness 请求超时');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (removeAbortListener) removeAbortListener();
      }
    }

    describe(options) {
      return this.request('host.describe', {}, options);
    }

    listSessions(options) {
      return this.request('session.list', {}, options);
    }

    history(sessionId, options) {
      return this.request('session.history', { sessionId }, options);
    }

    createSession(options) {
      return this.request('session.create', {}, options);
    }

    prompt(sessionId, text, options) {
      return this.request('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: String(text || '') }]
      }, options);
    }

    cancel(sessionId, options) {
      return this.request('session.cancel', { sessionId }, options);
    }

    async ensureSession(sessionId, options) {
      if (sessionId) {
        try {
          await this.history(sessionId, options);
          return sessionId;
        } catch (error) {
          // The local server may have been restarted and discarded the old session.
        }
      }
      const created = await this.createSession(options);
      if (!created || !created.sessionId) throw new Error('Harness 没有返回 sessionId');
      return created.sessionId;
    }

    async waitForResponse(sessionId, afterSeq, options) {
      const config = options || {};
      const startedAt = Date.now();
      let latestText = '';
      let latestHistory = null;

      while (Date.now() - startedAt < (config.maxWaitMs || this.maxWaitMs)) {
        if (config.signal && config.signal.aborted) throw new Error('任务已停止');
        latestHistory = await this.history(sessionId, config);
        const events = latestHistory && Array.isArray(latestHistory.events) ? latestHistory.events : [];
        const responseText = protocol.extractAssistantText(events, afterSeq);
        if (responseText) latestText = responseText;

        const finished = events.some(item => protocol.isAfterSeq(item, afterSeq) && [
          'turn/finish',
          'turn/error',
          'agent/error'
        ].includes(protocol.eventType(item)));
        const running = await this.isSessionRunning(sessionId, config);

        if (finished || (latestText && running === false)) {
          if (!latestText) throw new Error(this.errorTextFromHistory(events, afterSeq) || 'Harness 没有返回文本结果');
          return { text: latestText, history: latestHistory };
        }

        await new Promise(resolve => setTimeout(resolve, this.pollMs));
      }
      throw new Error('Harness 任务等待超时');
    }

    async isSessionRunning(sessionId, options) {
      const list = await this.listSessions(options);
      const item = list && Array.isArray(list.items)
        ? list.items.find(session => session.sessionId === sessionId)
        : null;
      return item && typeof item.running === 'boolean' ? item.running : null;
    }

    errorTextFromHistory(events, afterSeq) {
      const errorEvent = (Array.isArray(events) ? events : []).find(item =>
        protocol.isAfterSeq(item, afterSeq) && ['turn/error', 'agent/error'].includes(protocol.eventType(item))
      );
      const data = errorEvent && errorEvent.event && errorEvent.event.data;
      return data && (data.message || data.error) ? String(data.message || data.error) : '';
    }

    async runPrompt(text, options) {
      const config = options || {};
      const sessionId = await this.ensureSession(config.sessionId, config);
      if (typeof config.onSessionId === 'function') config.onSessionId(sessionId);
      const before = await this.history(sessionId, config);
      const afterSeq = protocol.maxEventSeq(before && before.events);
      await this.prompt(sessionId, text, config);
      const result = await this.waitForResponse(sessionId, afterSeq, config);
      return { sessionId, ...result };
    }
  }

  root.DeepSeekHarnessClient = DeepSeekHarnessClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = DeepSeekHarnessClient;
})(typeof globalThis !== 'undefined' ? globalThis : window);
