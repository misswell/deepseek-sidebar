(function attachHarnessExtensionTransport(root) {
  function request(request) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let removeAbortListener = null;
      const onAbort = () => {
        const error = new Error('任务已停止');
        error.name = 'AbortError';
        finish(reject, error);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (removeAbortListener) removeAbortListener();
        callback(value);
      };

      if (request.signal) {
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => request.signal.removeEventListener('abort', onAbort);
      }

      chrome.runtime.sendMessage({
        source: 'deepseek-sidebar-harness-host',
        command: 'rpc',
        baseUrl: request.baseUrl,
        method: request.method,
        payload: request.payload
      }, response => {
        const error = chrome.runtime.lastError;
        if (error) {
          finish(reject, new Error(error.message));
          return;
        }
        if (!response || response.ok !== true) {
          finish(reject, new Error(response && response.error ? response.error : 'Harness 宿主没有返回结果'));
          return;
        }
        finish(resolve, response.value);
      });
    });
  }

  root.DeepSeekHarnessTransport = { request };
})(typeof globalThis !== 'undefined' ? globalThis : window);
