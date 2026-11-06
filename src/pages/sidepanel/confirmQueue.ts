/** 一次确认请求。message 保留原文，由调用方决定怎么拆标题和正文。 */
export interface ConfirmItem {
  message: string;
  destructive: boolean;
  resolve: (value: boolean) => void;
  settled: boolean;
}

export interface ConfirmOptions {
  destructive?: boolean;
}

export interface ConfirmQueue {
  ask(message: string, options?: ConfirmOptions): Promise<boolean>;
  attach(listener: (item: ConfirmItem | null) => void): () => void;
  settle(value: boolean): void;
  current(): ConfirmItem | null;
}

/** 把确认文案拆成标题和其余正文，字句保持原样。 */
export function splitConfirmCopy(message: unknown): { title: string; body: string } {
  const text = String(message ?? '');
  const breakAt = text.indexOf('\n');
  if (breakAt === -1) return { title: text, body: '' };
  return { title: text.slice(0, breakAt), body: text.slice(breakAt + 1).replace(/^\n/, '') };
}

/** 一次只展示一条确认；取消 resolve false，确认 resolve true。 */
export function createConfirmQueue(): ConfirmQueue {
  let listener: ((item: ConfirmItem | null) => void) | null = null;
  let active: ConfirmItem | null = null;
  const waiting: ConfirmItem[] = [];
  const pump = () => {
    if (active || !listener) return;
    active = waiting.shift() || null;
    listener(active);
  };
  return {
    ask(message, options = {}) {
      return new Promise<boolean>((resolve) => {
        waiting.push({
          message: String(message ?? ''),
          destructive: !!options.destructive,
          resolve,
          settled: false,
        });
        pump();
      });
    },
    attach(next) {
      listener = next;
      pump();
      return () => {
        if (listener === next) listener = null;
      };
    },
    settle(value) {
      if (!active || active.settled) return;
      active.settled = true;
      const current = active;
      active = null;
      current.resolve(!!value);
      pump();
    },
    current() {
      return active;
    },
  };
}

export const confirmQueue = createConfirmQueue();

export function askConfirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  return confirmQueue.ask(message, options);
}
