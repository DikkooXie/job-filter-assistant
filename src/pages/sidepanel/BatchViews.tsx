import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { drawerModel, queueRowCopy, visibleSections } from './batchQueue.js';
import type { Batch, BatchItem, StripModel } from './batchQueue.js';

export function BatchStrip({ model, onOpenQueue, onRetryFailed }: {
  model: StripModel | null | undefined;
  onOpenQueue: () => void;
  onRetryFailed: () => void;
}) {
  if (!model?.visible) return null;
  return (
    <div className={`batch-strip is-${model.tone}`} role="status" data-batch-strip={model.tone} aria-live="polite">
      <button type="button" className="batch-strip-main" onClick={onOpenQueue}>
        {model.tone === 'running' && <i className="batch-spin" aria-hidden="true" />}
        {model.auto && <span className="batch-auto">自动</span>}
        <span className="batch-strip-label">{model.label}</span>
      </button>
      <span className="batch-strip-actions">
        {model.tone !== 'success' && (
          <button type="button" className="batch-queue-btn" aria-haspopup="dialog" onClick={onOpenQueue}>
            队列<ChevronUp aria-hidden="true" />
          </button>
        )}
        {model.tone === 'failed' && (
          <button type="button" className="batch-retry-btn" onClick={onRetryFailed}>重试失败</button>
        )}
      </span>
    </div>
  );
}

function QueueSection({ id, title, count, open, onToggle, children }: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`queue-section is-${id}${open ? ' is-open' : ''}`} data-queue-section={id}>
      <button type="button" className="queue-section-toggle" aria-expanded={open} onClick={onToggle}>
        <span>{title}</span>
        <span className="queue-section-meta">{count}<ChevronUp aria-hidden="true" /></span>
      </button>
      {open && <div className="queue-section-body">{children}</div>}
    </section>
  );
}

function QueueJob({ item, batch, failed = false, onRetry }: {
  item: BatchItem;
  batch: Batch;
  failed?: boolean;
  onRetry?: (uid: string) => void;
}) {
  return (
    <div className={`queue-job${failed ? ' is-failed' : ''}${item.status === 'running' ? ' is-running' : ''}`}>
      <div className="queue-job-copy">
        <strong>{item.title || '未命名岗位'}</strong>
        <span>{queueRowCopy(batch, item)}</span>
      </div>
      {failed && (
        <button type="button" className="batch-retry-btn" onClick={() => onRetry?.(item.uid)}>重试</button>
      )}
    </div>
  );
}

interface QueueSections {
  running: boolean;
  failed: boolean;
  queued: boolean;
  done: boolean;
}

export function QueueDrawer({ batch, onCancel, onRetry, onClose }: {
  batch: Batch;
  onCancel: () => void;
  onRetry: (uid: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [chip, setChip] = useState('all');
  const [open, setOpen] = useState<QueueSections>({ running: true, failed: true, queued: true, done: false });
  const model = drawerModel(batch);
  const view = visibleSections(batch, chip);
  useEffect(() => {
    const root = ref.current;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    root?.addEventListener('keydown', onKey);
    root?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => root?.removeEventListener('keydown', onKey);
  }, []);
  const toggle = (id: keyof QueueSections) => setOpen((current) => ({ ...current, [id]: !current[id] }));
  return (
    <div className="absolute inset-0 z-[12] flex items-end bg-queue-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="queue-drawer flex h-[52%] max-h-[52%] min-h-0 w-full flex-col rounded-t-[16px] bg-queue-surface text-queue-ink shadow-[0_-12px_32px_rgba(0,0,0,.28)] [animation:sheet-up_220ms_ease]" role="dialog" aria-modal="true" aria-labelledby="queue-title" data-queue-drawer="half" ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <header className="queue-head">
          <div className="queue-head-row">
            <h2 id="queue-title">{model.head}</h2>
            <button type="button" className="queue-cancel" disabled={!model.canCancel} onClick={onCancel}>取消剩余</button>
          </div>
          <div className="queue-bar" aria-hidden="true"><span style={{ width: `${Math.round(model.progress * 100)}%` }} /></div>
          <p className="queue-summary">
            <span>{model.summary}</span>
            {model.estimate && <span className="queue-estimate">{model.estimate}</span>}
          </p>
        </header>
        <div className="queue-chips" role="toolbar" aria-label="筛选队列">
          <button type="button" className={`queue-chip${chip === 'all' ? ' is-on' : ''}`} aria-pressed={chip === 'all'} onClick={() => setChip('all')}>全部</button>
          <button type="button" className={`queue-chip${chip === 'running' ? ' is-on' : ''}`} aria-pressed={chip === 'running'} onClick={() => setChip('running')}>进行中</button>
          <button type="button" className={`queue-chip${model.failed.length ? ' is-failed' : ''}${chip === 'failed' ? ' is-on' : ''}`} aria-pressed={chip === 'failed'} onClick={() => setChip('failed')}>失败 {model.failed.length}</button>
        </div>
        <div className="queue-scroll">
          {chip !== 'failed' && (
            <QueueSection id="running" title="进行中" count={view.running.length} open={open.running} onToggle={() => toggle('running')}>
              {view.running.length === 0 && <p className="queue-empty">没有进行中的岗位</p>}
              {view.running.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
            </QueueSection>
          )}
          {chip !== 'running' && (chip === 'failed' || view.failed.length > 0) && (
            <QueueSection id="failed" title="失败" count={view.failed.length} open={open.failed} onToggle={() => toggle('failed')}>
              {view.failed.length === 0 && <p className="queue-empty">没有失败的岗位</p>}
              {view.failed.map((item) => <QueueJob key={item.uid} item={item} batch={batch} failed onRetry={onRetry} />)}
            </QueueSection>
          )}
          {chip === 'all' && (
            <QueueSection id="queued" title="排队" count={model.queued} open={open.queued} onToggle={() => toggle('queued')}>
              {view.queuedPreview.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
              {view.queuedHidden > 0 && <p className="queue-more" data-queue-hidden={view.queuedHidden}>还有 {view.queuedHidden} 条</p>}
              {model.queued === 0 && <p className="queue-empty">没有排队的岗位</p>}
            </QueueSection>
          )}
          {chip === 'all' && (
            <QueueSection id="done" title="已完成" count={model.done.length} open={open.done} onToggle={() => toggle('done')}>
              {view.done.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
              {model.done.length === 0 && <p className="queue-empty">还没有完成的岗位</p>}
            </QueueSection>
          )}
        </div>
        <footer className="queue-foot">
          <button type="button" className="batch-queue-btn" onClick={onClose}>收起</button>
        </footer>
      </section>
    </div>
  );
}
