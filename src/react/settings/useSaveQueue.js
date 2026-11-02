import { useCallback, useEffect, useRef } from 'react';

// Serialize saves and retain the latest snapshot, so rapid edits and navigation cannot overwrite each other.
export function useSaveQueue(report) {
  const queues = useRef({});
  const enqueue = useCallback((key, task, delay = 500) => {
    const q = queues.current[key] || (queues.current[key] = { chain: Promise.resolve(), timer: null, task: null });
    clearTimeout(q.timer);
    q.task = task;
    q.timer = setTimeout(() => {
      q.timer = null;
      const pending = q.task; q.task = null;
      q.chain = q.chain.catch(() => {}).then(pending);
      q.chain.catch((e) => { report(e.message, true); });
    }, delay);
  }, [report]);
  const flush = useCallback(async (key) => {
    const q = queues.current[key];
    if (!q) return;
    clearTimeout(q.timer); q.timer = null;
    if (q.task) { const pending = q.task; q.task = null; q.chain = q.chain.catch(() => {}).then(pending); }
    await q.chain;
  }, []);
  useEffect(() => () => { Object.values(queues.current).forEach((q) => { clearTimeout(q.timer); if (q.task) q.chain.catch(() => {}).then(q.task).catch(() => {}); }); }, []);
  return { enqueue, flush };
}
