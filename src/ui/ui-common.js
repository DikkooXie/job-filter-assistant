// UI 层共享小工具：向 background 发消息、列表字段解析。
// 旧版原生 UI（h/esc/toast/debounce 等 DOM 工具）已随旧页面一并删除。

// 向 background 发消息，抛错友好。
// 带超时：MV3 service worker 可能在长任务中被回收，导致回调永不触发。
// 超时后 reject，避免上层 await 永久挂起（进而卡住 batchBusy 之类的状态）。
export function send(type, extra = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('操作超时（后台无响应），请重试')),
      timeoutMs,
    );
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return finish(reject, new Error(err.message));
        if (!resp) return finish(reject, new Error('无响应（后台可能未就绪）'));
        if (!resp.ok) return finish(reject, new Error(resp.error || '操作失败'));
        finish(resolve, resp.data);
      });
    } catch (e) {
      finish(reject, e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// 逗号/换行分隔字符串 -> 数组
export function toList(str) {
  return String(str || '')
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
