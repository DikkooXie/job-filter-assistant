// 设置页保存队列。
// 同一个 key 串行保存，防抖窗口里只保留最后一次任务，避免旧快照覆盖新编辑。
// 保存失败且期间没有更新的编辑时，按原来的间隔重新排队。
// 页面隐藏、pagehide、beforeunload 时立刻发出还没开始的保存；不能只靠 React 卸载。

export type SavePhase = 'idle' | 'saving' | 'error' | 'saved';

export interface SaveStatus {
  phase: SavePhase;
  savedAt: number | null;
  error: string | null;
}

export type SaveTask = () => unknown;
export type ReportFn = (message: string | null, isError?: boolean) => void;

/** 定时器句柄类型取决于注入的 schedule，默认用浏览器/Node 的 setTimeout。 */
type TimerId = ReturnType<typeof setTimeout>;

export interface LifecycleTarget {
  addEventListener(type: string, fn: () => void, capture?: boolean): void;
  removeEventListener(type: string, fn: () => void, capture?: boolean): void;
}

export interface LifecycleDocument extends LifecycleTarget {
  visibilityState?: string;
}

export interface SaveQueueEnv {
  schedule?: (fn: () => void, ms: number) => TimerId;
  cancel?: (id: TimerId) => void;
  target?: LifecycleTarget | null;
  documentTarget?: LifecycleDocument | null;
  now?: () => number;
}

export interface SaveQueue {
  enqueue(key: string, task: SaveTask, delay?: number): void;
  flush(key: string): Promise<void>;
  retry(): Promise<void[]>;
  snapshot(): SaveStatus;
  subscribe(fn: (status: SaveStatus) => void): () => void;
  flushPendingNow(): void;
  dispose(): void;
}

interface Bucket {
  chain: Promise<unknown>;
  timer: TimerId | null;
  task: SaveTask | null;
  delay: number;
  epoch: number;
  lastError: string | null;
  running: boolean;
  retrying: boolean;
}

export function createSaveQueue(report: ReportFn = () => {}, env: SaveQueueEnv = {}): SaveQueue {
  const schedule = env.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel = env.cancel || ((id) => clearTimeout(id));
  const win = Object.prototype.hasOwnProperty.call(env, 'target')
    ? (env.target ?? null)
    : (typeof window !== 'undefined' ? window : null);
  const doc = Object.prototype.hasOwnProperty.call(env, 'documentTarget')
    ? (env.documentTarget ?? null)
    : (typeof document !== 'undefined' ? document : null);

  const queues = new Map<string, Bucket>();
  const listeners = new Set<(status: SaveStatus) => void>();
  const now = env.now || (() => Date.now());
  let savedAt: number | null = null;
  let disposed = false;

  const bucket = (key: string): Bucket => {
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
  const snapshot = (): SaveStatus => {
    let saving = false;
    let error: string | null = null;
    for (const q of queues.values()) {
      if (q.running || ((q.timer != null || q.task) && !q.retrying)) saving = true;
      if (q.lastError) error = error || q.lastError;
    }
    let phase: SavePhase = 'idle';
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

  const subscribe = (fn: (status: SaveStatus) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const fail = (q: Bucket, pending: SaveTask, epoch: number, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
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
  const track = (q: Bucket, pending: SaveTask, epoch: number, attempt: Promise<unknown>) => {
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
    attempt.catch((error: unknown) => {
      settleRun();
      fail(q, pending, epoch, error);
    });
  };

  const arm = (q: Bucket) => {
    if (q.timer != null) cancel(q.timer);
    q.timer = schedule(() => {
      q.timer = null;
      runSerialized(q);
    }, q.delay);
  };

  // 平时排队：等上一次保存结束再发下一次，避免 read-modify-write 互相覆盖。
  const runSerialized = (q: Bucket) => {
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
  const runImmediate = (q: Bucket) => {
    if (!q.task) return;
    const pending = q.task;
    const epoch = q.epoch;
    q.task = null;
    q.running = true;
    let result: unknown;
    try {
      result = pending();
    } catch (error) {
      result = Promise.reject(error);
    }
    const observed = Promise.resolve(result).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    track(q, pending, epoch, q.chain.catch(() => {}).then(async () => {
      const outcome = await observed;
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    }));
  };

  const enqueue = (key: string, task: SaveTask, delay = 500) => {
    if (disposed) return;
    const q = bucket(key);
    q.epoch += 1;
    q.delay = delay;
    q.task = task;
    q.retrying = false;
    arm(q);
    emit();
  };

  const flush = async (key: string): Promise<void> => {
    const q = queues.get(key);
    if (!q) return;
    if (q.timer != null) cancel(q.timer);
    q.timer = null;
    runSerialized(q);
    await q.chain;
  };

  const retry = (): Promise<void[]> => {
    if (disposed) return Promise.resolve([]);
    const jobs: Promise<void>[] = [];
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

function bindLifecycle(
  win: LifecycleTarget | null,
  doc: LifecycleDocument | null,
  onLeave: () => void,
  onVisibility: () => void,
): () => void {
  const listen = (target: LifecycleTarget | null, type: string, fn: () => void) => {
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener(type, fn, true);
    }
  };
  const unlisten = (target: LifecycleTarget | null, type: string, fn: () => void) => {
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
