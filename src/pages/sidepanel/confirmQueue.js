/** 把确认文案拆成标题和其余正文，字句保持原样。 */
export function splitConfirmCopy(message) {
  const text = String(message ?? '');
  const breakAt = text.indexOf('\n');
  if (breakAt === -1) return { title: text, body: '' };
  return { title: text.slice(0, breakAt), body: text.slice(breakAt + 1).replace(/^\n/, '') };
}

/** 一次只展示一条确认；取消 resolve false，确认 resolve true。 */
export function createConfirmQueue() {
  let listener = null;
  let active = null;
  const waiting = [];
  const pump = () => {
    if (active || !listener) return;
    active = waiting.shift() || null;
    listener(active);
  };
  return {
    ask(message, options = {}) {
      return new Promise((resolve) => {
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

export function askConfirm(message, options) {
  return confirmQueue.ask(message, options);
}
