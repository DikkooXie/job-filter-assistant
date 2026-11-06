import { useEffect, useRef, useState } from 'react';
import { createSaveQueue } from './saveQueue.js';

export function useSaveQueue(report) {
  const reportRef = useRef(report);
  reportRef.current = report;
  const aliveRef = useRef(true);
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createSaveQueue((message, isError = false) => {
      if (!aliveRef.current) return;
      reportRef.current(message, isError);
    });
  }
  const [status, setStatus] = useState(() => queueRef.current.snapshot());
  useEffect(() => queueRef.current.subscribe(setStatus), []);
  useEffect(() => () => {
    aliveRef.current = false;
    queueRef.current.dispose();
  }, []);
  return {
    enqueue: queueRef.current.enqueue,
    flush: queueRef.current.flush,
    retry: queueRef.current.retry,
    status,
  };
}
