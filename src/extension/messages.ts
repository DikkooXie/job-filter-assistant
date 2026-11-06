// 扩展运行时适配层：向 background 发消息。
// 带超时：MV3 service worker 可能在长任务中被回收，导致回调永不触发。
// 超时后 reject，避免上层 await 永久挂起（进而卡住 batchBusy 之类的状态）。
export interface MessageResponse {
  ok?: boolean;
  error?: string;
  data?: unknown;
}

export function send<T = unknown>(type: string, extra: Record<string, unknown> = {}, timeoutMs = 120000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (ok: boolean, value: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok) resolve(value as T);
      else reject(value);
    };
    const timer = setTimeout(
      () => finish(false, new Error('操作超时（后台无响应），请重试')),
      timeoutMs,
    );
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (resp: MessageResponse | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) return finish(false, new Error(err.message));
        if (!resp) return finish(false, new Error('无响应（后台可能未就绪）'));
        if (!resp.ok) return finish(false, new Error(resp.error || '操作失败'));
        finish(true, resp.data);
      });
    } catch (e) {
      finish(false, e instanceof Error ? e : new Error(String(e)));
    }
  });
}
