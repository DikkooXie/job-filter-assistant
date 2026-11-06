import { useEffect, useRef, useState } from 'react';
import { createSaveQueue } from './saveQueue.js';
import type { ReportFn, SaveStatus } from './saveQueue.js';

export interface SaveQueueHandle {
  enqueue: (key: string, task: () => unknown, delay?: number) => void;
  flush: (key: string) => Promise<void>;
  retry: () => Promise<void[]>;
  status: SaveStatus;
}

export function useSaveQueue(report: ReportFn): SaveQueueHandle {
  const reportRef = useRef(report);
  reportRef.current = report;
  const aliveRef = useRef(true);
  const queueRef = useRef<ReturnType<typeof createSaveQueue> | null>(null);
  if (!queueRef.current) {
    queueRef.current = createSaveQueue((message, isError = false) => {
      if (!aliveRef.current) return;
      reportRef.current(message, isError);
    });
  }
  const queue = queueRef.current;
  const [status, setStatus] = useState<SaveStatus>(() => queue.snapshot());
  useEffect(() => queue.subscribe(setStatus), [queue]);
  useEffect(() => () => {
    aliveRef.current = false;
    queue.dispose();
  }, [queue]);
  return {
    enqueue: queue.enqueue,
    flush: queue.flush,
    retry: queue.retry,
    status,
  };
}
