// 设置页保存队列。
// 同一个 key 串行保存，防抖窗口里只保留最后一次任务，避免旧快照覆盖新编辑。
// 保存失败且期间没有更新的编辑时，按原来的间隔重新排队。
// 页面隐藏、pagehide、beforeunload 时立刻发出还没开始的保存；不能只靠 React 卸载。

export function createSaveQueue(report = () => {}, env = {}) {
  const schedule = env.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = env.cancel || ((id) => clearTimeout(id));
  const win = Object.prototype.hasOwnProperty.call(env, 'target')
    ? env.target
    : (typeof window !== 'undefined' ? window : null);
  const doc = Object.prototype.hasOwnProperty.call(env, 'documentTarget')
    ? env.documentTarget
    : (typeof document !== 'undefined' ? document : null);

  const queues = new Map();
  const listeners = new Set();
  const now = env.now || (() => Date.now());
  let savedAt = null;
  let disposed = false;

  const bucket = (key) => {
    let q = queues.get(key);
    if (!q) {
      q = {
        chain: Promise.resolve(), timer: null, task: null, delay: 500, epoch: 0,
        lastError: null, running: false, retrying: false,
      };
      queues.set(key, q);
    }
    return q;
  };

  // 保存中优先于失败；自动重试还在等待时保持失败，方便页头提供重试。
  const snapshot = () => {
    let saving = false;
    let error = null;
    for (const q of queues.values()) {
      if (q.running || ((q.timer != null || q.task) && !q.retrying)) saving = true;
      if (q.lastError) error = error || q.lastError;
    }
    let phase = 'idle';
    if (saving) phase = 'saving';
    else if (error) phase = 'error';
    else if (savedAt != null) phase = 'saved';
    return { phase, savedAt, error };
  };

  const emit = () => {
    if (!listeners.size) return;
    const snap = snapshot();
    for (const fn of listeners) {
      try { fn(snap); } catch { /* 界面状态失败不能挡住保存 */ }
    }
  };

  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const fail = (q, pending, epoch, error) => {
    const message = error && error.message ? error.message : String(error);
    q.lastError = message;
    try { report(message, true); } catch { /* 提示失败不能挡住重试 */ }
    if (q.epoch !== epoch || q.task) {
      emit();
      return;
    }
    q.retrying = true;
    q.task = pending;
    arm(q);
    emit();
  };

  // 同一次编辑最终写成功后，撤掉已经过时的失败提示。更新的编辑或别的成功提示不动。
  const track = (q, pending, epoch, attempt) => {
    q.chain = attempt;
    const settleRun = () => {
      if (q.chain === attempt) q.running = false;
    };
    attempt.then(() => {
      settleRun();
      if (q.epoch === epoch) {
        savedAt = now();
        q.retrying = false;
      }
      if (!q.lastError || q.epoch !== epoch) {
        emit();
        return;
      }
      q.lastError = null;
      try { report(null, false); } catch { /* 收起提示失败不影响保存 */ }
      emit();
    }).catch(() => {});
    attempt.catch((error) => {
      settleRun();
      fail(q, pending, epoch, error);
    });
  };

  const arm = (q) => {
    if (q.timer != null) cancel(q.timer);
    q.timer = schedule(() => {
      q.timer = null;
      runSerialized(q);
    }, q.delay);
  };

  // 平时排队：等上一次保存结束再发下一次，避免 read-modify-write 互相覆盖。
  const runSerialized = (q) => {
    if (!q.task) return;
    const pending = q.task;
    const epoch = q.epoch;
    q.task = null;
    q.running = true;
    emit();
    track(q, pending, epoch, q.chain.catch(() => {}).then(() => pending()));
  };

  // 页面关闭时不能等上一次保存的 Promise：文档可能马上被丢掉。
  // 这里同步调用任务，让 chrome.runtime.sendMessage 在事件处理函数返回前发出。
  const runImmediate = (q) => {
    if (!q.task) return;
    const pending = q.task;
    const epoch = q.epoch;
    q.task = null;
    q.running = true;
    let result;
    try {
      result = pending();
    } catch (error) {
      result = Promise.reject(error);
    }
    const observed = Promise.resolve(result).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    track(q, pending, epoch, q.chain.catch(() => {}).then(async () => {
      const outcome = await observed;
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    }));
  };

  const enqueue = (key, task, delay = 500) => {
    if (disposed) return;
    const q = bucket(key);
    q.epoch += 1;
    q.delay = delay;
    q.task = task;
    q.retrying = false;
    arm(q);
    emit();
  };

  const flush = async (key) => {
    const q = queues.get(key);
    if (!q) return;
    if (q.timer != null) cancel(q.timer);
    q.timer = null;
    runSerialized(q);
    await q.chain;
  };

  const retry = () => {
    if (disposed) return Promise.resolve();
    const jobs = [];
    for (const [key, q] of queues) {
      if (q.lastError) jobs.push(flush(key).catch(() => {}));
    }
    return Promise.all(jobs);
  };

  const flushPendingNow = () => {
    for (const q of queues.values()) {
      if (q.timer != null) cancel(q.timer);
      q.timer = null;
      runImmediate(q);
    }
  };

  const onVisibility = () => {
    if (doc && doc.visibilityState === 'hidden') flushPendingNow();
  };

  const unbind = bindLifecycle(win, doc, flushPendingNow, onVisibility);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unbind();
    flushPendingNow();
    listeners.clear();
  };

  return { enqueue, flush, retry, snapshot, subscribe, flushPendingNow, dispose };
}

function bindLifecycle(win, doc, onLeave, onVisibility) {
  const listen = (target, type, fn) => {
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener(type, fn, true);
    }
  };
  const unlisten = (target, type, fn) => {
    if (target && typeof target.removeEventListener === 'function') {
      target.removeEventListener(type, fn, true);
    }
  };
  listen(win, 'pagehide', onLeave);
  listen(win, 'beforeunload', onLeave);
  listen(doc, 'visibilitychange', onVisibility);
  return () => {
    unlisten(win, 'pagehide', onLeave);
    unlisten(win, 'beforeunload', onLeave);
    unlisten(doc, 'visibilitychange', onVisibility);
  };
}
