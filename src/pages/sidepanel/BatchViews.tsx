import React, { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { drawerModel, queueRowCopy, visibleSections } from './batchQueue.js';
import type { Batch, BatchItem, StripModel } from './batchQueue.js';
import { cn } from '../../lib/cn.js';

// browse.css 的 `.job-panel button` 重置不在任何层里，会压过 Tailwind 工具类，
// 所以按钮上被重置过的属性（边框、背景、内边距、字体、颜色）都要加 `!`。
const queueButton = 'inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-lg !border !bg-transparent !px-2.5 !py-[3px] !text-hint !font-[650] [&_svg]:!size-[14px]';
const tealButton = cn(queueButton, '!border-[rgba(45,212,191,.45)] !text-queue-accent');
const amberButton = cn(queueButton, '!border-[rgba(240,180,41,.55)] !text-queue-warn');

function chipClass(on: boolean, failed = false) {
  return cn(
    'min-h-[26px] rounded-full !border !bg-queue-raised !px-2.5 !py-[2px] !text-hint !font-[650]',
    failed ? '!border-[rgba(240,180,41,.55)] !text-queue-warn' : on ? '!border-[rgba(45,212,191,.6)] !text-queue-accent' : '!border-[rgba(231,237,240,.16)] !text-queue-chip',
    failed && on && '!bg-[rgba(240,180,41,.12)]',
  );
}

export function BatchStrip({ model, onOpenQueue, onRetryFailed }: {
  model: StripModel | null | undefined;
  onOpenQueue: () => void;
  onRetryFailed: () => void;
}) {
  if (!model?.visible) return null;
  const failed = model.tone === 'failed';
  return (
    <div
      className={cn(
        'batch-strip flex min-h-9 shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5',
        failed ? 'border-t-[rgba(240,180,41,.5)] bg-queue-raised text-queue-warn' : 'border-t-[rgba(45,212,191,.35)] bg-queue-surface text-queue-accent',
      )}
      role="status"
      data-batch-strip={model.tone}
      aria-live="polite"
    >
      <button type="button" className="inline-flex min-w-0 items-center gap-2 text-left" onClick={onOpenQueue}>
        {model.tone === 'running' && <i className="batch-spin" aria-hidden="true" />}
        {model.auto && <span className="shrink-0 rounded-full border border-[rgba(45,212,191,.45)] bg-[rgba(45,212,191,.12)] px-[7px] text-[11px] leading-[18px] font-bold text-queue-accent">自动</span>}
        <span className="text-control font-[650] whitespace-nowrap">{model.label}</span>
      </button>
      <span className="inline-flex min-w-0 items-center gap-2">
        {model.tone !== 'success' && (
          <button type="button" className={failed ? amberButton : tealButton} aria-haspopup="dialog" onClick={onOpenQueue}>
            队列<ChevronUp aria-hidden="true" />
          </button>
        )}
        {failed && (
          <button type="button" className={amberButton} onClick={onRetryFailed}>重试失败</button>
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
    <section className="border-t border-queue-divider" data-queue-section={id}>
      <button
        type="button"
        className={cn('flex min-h-[34px] w-full items-center justify-between gap-2 !text-control !font-[650]', id === 'failed' ? '!text-queue-warn' : '!text-queue-ink')}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className={cn('inline-flex items-center gap-1 font-semibold text-queue-muted [&_svg]:!size-[14px]', !open && '[&_svg]:[transform:rotate(180deg)]')}>{count}<ChevronUp aria-hidden="true" /></span>
      </button>
      {open && <div className="flex flex-col gap-1.5 pb-2">{children}</div>}
    </section>
  );
}

function QueueJob({ item, batch, failed = false, onRetry }: {
  item: BatchItem;
  batch: Batch;
  failed?: boolean;
  onRetry?: (uid: string) => void;
}) {
  const running = item.status === 'running';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-[10px] bg-queue-raised px-2.5 py-2',
        running && 'bg-[rgba(45,212,191,.1)]',
        failed && 'border border-[rgba(240,180,41,.35)] bg-[rgba(240,180,41,.1)]',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="truncate text-control font-[650]">{item.title || '未命名岗位'}</strong>
        <span className={cn('text-[11px]', failed ? 'text-queue-warn' : running ? 'text-queue-accent' : 'text-queue-muted')}>{queueRowCopy(batch, item)}</span>
      </div>
      {failed && (
        <button type="button" className={amberButton} onClick={() => onRetry?.(item.uid)}>重试</button>
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
      <section className="flex h-[52%] max-h-[52%] min-h-0 w-full flex-col rounded-t-[16px] bg-queue-surface text-queue-ink shadow-[0_-12px_32px_rgba(0,0,0,.28)] [animation:sheet-up_220ms_ease]" role="dialog" aria-modal="true" aria-labelledby="queue-title" data-queue-drawer="half" ref={ref}>
        <div className="mx-auto mt-2.5 mb-3 h-1 w-9 rounded-[2px] bg-jp-line-strong" aria-hidden="true" />
        <header className="shrink-0 px-[14px]">
          <div className="flex items-center justify-between gap-2">
            <h2 id="queue-title" className="text-section font-[650] text-queue-accent">{model.head}</h2>
            <button type="button" className={cn(tealButton, 'disabled:opacity-40')} disabled={!model.canCancel} onClick={onCancel}>取消剩余</button>
          </div>
          <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-queue-track" aria-hidden="true"><span className="block h-full bg-queue-accent" style={{ width: `${Math.round(model.progress * 100)}%` }} /></div>
          <p className="!mt-3 flex justify-between gap-2 text-hint text-queue-muted">
            <span>{model.summary}</span>
            {model.estimate && <span className="whitespace-nowrap text-queue-accent">{model.estimate}</span>}
          </p>
        </header>
        <div className="mt-4 mb-3 flex shrink-0 gap-1.5 px-[14px]" role="toolbar" aria-label="筛选队列">
          <button type="button" className={chipClass(chip === 'all')} aria-pressed={chip === 'all'} onClick={() => setChip('all')}>全部</button>
          <button type="button" className={chipClass(chip === 'running')} aria-pressed={chip === 'running'} onClick={() => setChip('running')}>进行中</button>
          <button type="button" className={chipClass(chip === 'failed', model.failed.length > 0)} aria-pressed={chip === 'failed'} onClick={() => setChip('failed')}>失败 {model.failed.length}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-[14px] pb-2">
          {chip !== 'failed' && (
            <QueueSection id="running" title="进行中" count={view.running.length} open={open.running} onToggle={() => toggle('running')}>
              {view.running.length === 0 && <p className="text-hint text-queue-muted">没有进行中的岗位</p>}
              {view.running.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
            </QueueSection>
          )}
          {chip !== 'running' && (chip === 'failed' || view.failed.length > 0) && (
            <QueueSection id="failed" title="失败" count={view.failed.length} open={open.failed} onToggle={() => toggle('failed')}>
              {view.failed.length === 0 && <p className="text-hint text-queue-muted">没有失败的岗位</p>}
              {view.failed.map((item) => <QueueJob key={item.uid} item={item} batch={batch} failed onRetry={onRetry} />)}
            </QueueSection>
          )}
          {chip === 'all' && (
            <QueueSection id="queued" title="排队" count={model.queued} open={open.queued} onToggle={() => toggle('queued')}>
              {view.queuedPreview.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
              {view.queuedHidden > 0 && <p className="text-hint text-queue-muted" data-queue-hidden={view.queuedHidden}>还有 {view.queuedHidden} 条</p>}
              {model.queued === 0 && <p className="text-hint text-queue-muted">没有排队的岗位</p>}
            </QueueSection>
          )}
          {chip === 'all' && (
            <QueueSection id="done" title="已完成" count={model.done.length} open={open.done} onToggle={() => toggle('done')}>
              {view.done.map((item) => <QueueJob key={item.uid} item={item} batch={batch} />)}
              {model.done.length === 0 && <p className="text-hint text-queue-muted">还没有完成的岗位</p>}
            </QueueSection>
          )}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-queue-divider px-[14px] pt-2 pb-3">
          <button type="button" className={tealButton} onClick={onClose}>收起</button>
        </footer>
      </section>
    </div>
  );
}
