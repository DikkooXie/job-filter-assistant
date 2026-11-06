// 批量分析队列的纯展示规则。不读写存储，也不发消息。
// 细条、半高抽屉和列表卡共用这一份状态：进行中 / 排队 / 失败 / 完成。
import type { Job } from '../../common/types.js';

export const QUEUE_PREVIEW = 4;
export const ESTIMATE_SECONDS = 16;
export const SUCCESS_HOLD_MS = 1600;

export type BatchStatus = 'queued' | 'running' | 'done' | 'failed';
export type BatchPhase = 'idle' | 'running' | 'success' | 'failed';
export type BatchSource = 'manual' | 'auto';

export interface BatchItem {
  uid: string;
  title: string;
  status: BatchStatus;
  error: string;
  source: BatchSource;
  force: boolean;
}

export interface Batch {
  items: BatchItem[];
  phase: BatchPhase;
}

export interface StripModel {
  visible: boolean;
  tone: 'idle' | 'running' | 'success' | 'failed';
  auto: boolean;
  label: string;
  progress: number;
}

export interface DrawerModel {
  failed: BatchItem[];
  queued: number;
  running: BatchItem[];
  total: number;
  finished: number;
  done: BatchItem[];
  head: string;
  progress: number;
  estimate: string;
  summary: string;
  queuedPreview: BatchItem[];
  queuedHidden: number;
  canCancel: boolean;
}

export interface CardCopy {
  kind: 'running' | 'queued' | 'failed';
  label: string;
  hint?: string;
}

type JobLike = Partial<Pick<Job, 'uid' | 'title'>> | null | undefined;

export function emptyBatch(): Batch {
  return { items: [], phase: 'idle' };
}

export function isPending(batch: Batch | null | undefined): boolean {
  return (batch?.items || []).some((item) => item.status === 'queued' || item.status === 'running');
}

export function enqueueBatch(
  batch: Batch | null | undefined,
  jobs: ReadonlyArray<JobLike>,
  { source = 'manual', force = false }: { source?: BatchSource; force?: boolean } = {},
): Batch {
  const items = (batch?.items || []).slice();
  let added = 0;
  for (const job of jobs || []) {
    if (!job?.uid) continue;
    const index = items.findIndex((item) => item.uid === job.uid);
    const next: BatchItem = {
      uid: job.uid,
      title: job.title || '未命名岗位',
      status: 'queued',
      error: '',
      source,
      force: !!force,
    };
    if (index === -1) {
      items.push(next);
      added += 1;
      continue;
    }
    const current = items[index];
    if (!current) continue;
    if (current.status === 'queued' || current.status === 'running') continue;
    if (current.status === 'done' && !force) continue;
    items.splice(index, 1);
    items.push(next);
    added += 1;
  }
  if (!added) return batch?.items ? batch : emptyBatch();
  return { items, phase: 'running' };
}

export function hydrateTitles(batch: Batch | null | undefined, jobs: ReadonlyArray<JobLike>): Batch {
  const titles = new Map((jobs || []).map((job) => [job?.uid, job?.title]));
  let changed = false;
  const items = (batch?.items || []).map((item) => {
    const title = titles.get(item.uid);
    if (!title || title === item.title) return item;
    changed = true;
    return { ...item, title };
  });
  if (!changed) return batch?.items ? batch : emptyBatch();
  return { ...(batch || emptyBatch()), items };
}

export function markRunning(batch: Batch | null | undefined, uid: string): Batch {
  let changed = false;
  const items = (batch?.items || []).map((item) => {
    if (item.uid !== uid || item.status !== 'queued') return item;
    changed = true;
    return { ...item, status: 'running' as const, error: '' };
  });
  if (!changed) return batch?.items ? batch : emptyBatch();
  return { ...(batch || emptyBatch()), items, phase: 'running' };
}

export function takeNext(batch: Batch | null | undefined): BatchItem | null {
  return (batch?.items || []).find((item) => item.status === 'queued') || null;
}

export function settle(
  batch: Batch | null | undefined,
  uid: string,
  { ok = false, error = '' }: { ok?: boolean; error?: string } = {},
): Batch {
  let changed = false;
  const items = (batch?.items || []).map((item) => {
    if (item.uid !== uid || item.status === 'done' || item.status === 'failed') return item;
    changed = true;
    return ok
      ? { ...item, status: 'done' as const, error: '' }
      : { ...item, status: 'failed' as const, error: error || '分析失败' };
  });
  if (!changed) return batch?.items ? batch : emptyBatch();
  return { ...(batch || emptyBatch()), items };
}

export function cancelRemaining(batch: Batch | null | undefined): Batch {
  const items = (batch?.items || []).filter((item) => item.status !== 'queued');
  return { ...(batch || emptyBatch()), items };
}

export function retryFailed(batch: Batch | null | undefined, uid: string | null = null): Batch {
  const again: BatchItem[] = [];
  const rest: BatchItem[] = [];
  for (const item of batch?.items || []) {
    if (item.status === 'failed' && (uid == null || item.uid === uid)) again.push({ ...item, status: 'queued', error: '' });
    else rest.push(item);
  }
  if (!again.length) return batch?.items ? batch : emptyBatch();
  return { items: [...rest, ...again], phase: 'running' };
}

export function finishPhase(batch: Batch | null | undefined): Batch {
  const current = batch?.items ? batch : emptyBatch();
  if (isPending(current)) return current;
  if (!current.items.length) return emptyBatch();
  if (current.phase === 'success' || current.phase === 'failed' || current.phase === 'idle') return current;
  const failed = current.items.some((item) => item.status === 'failed');
  return { ...current, phase: failed ? 'failed' : 'success' };
}

export function batchCounts(batch: Batch | null | undefined): {
  done: number;
  failed: number;
  queued: number;
  running: number;
  total: number;
  finished: number;
} {
  const items = batch?.items || [];
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const queued = items.filter((item) => item.status === 'queued').length;
  const running = items.filter((item) => item.status === 'running').length;
  return { done, failed, queued, running, total: items.length, finished: done + failed };
}

export function itemPosition(batch: Batch | null | undefined, uid: string): number {
  const index = (batch?.items || []).findIndex((item) => item.uid === uid);
  return index < 0 ? 0 : index + 1;
}

export function estimateMinutes(remaining: number): number {
  if (!remaining) return 0;
  return Math.max(1, Math.round((remaining * ESTIMATE_SECONDS) / 60));
}

function showsAuto(batch: Batch | null | undefined, activeOnly: boolean): boolean {
  return (batch?.items || []).some((item) => item.source === 'auto' && (!activeOnly || item.status === 'queued' || item.status === 'running'));
}

export function stripModel(batch: Batch | null | undefined): StripModel {
  const current = batch?.items ? batch : emptyBatch();
  const counts = batchCounts(current);
  if (current.phase === 'idle' || counts.total === 0) return { visible: false, tone: 'idle', auto: false, label: '', progress: 0 };
  if (current.phase === 'failed') {
    return {
      visible: true,
      tone: 'failed',
      auto: showsAuto(current, false),
      label: `${counts.failed} 失败 · ${counts.done} 完成`,
      progress: 1,
    };
  }
  if (current.phase === 'success') {
    return {
      visible: true,
      tone: 'success',
      auto: showsAuto(current, false),
      label: `${counts.done} 完成`,
      progress: 1,
    };
  }
  const running = current.items.find((item) => item.status === 'running');
  const n = running ? itemPosition(current, running.uid) : Math.min(counts.total, counts.finished + (counts.queued ? 1 : 0));
  return {
    visible: true,
    tone: 'running',
    auto: showsAuto(current, true),
    label: `${n}/${counts.total} · 分析中`,
    progress: counts.total ? n / counts.total : 0,
  };
}

export function drawerModel(batch: Batch | null | undefined): DrawerModel {
  const current = batch?.items ? batch : emptyBatch();
  const counts = batchCounts(current);
  const runningItem = current.items.find((item) => item.status === 'running');
  const n = runningItem ? itemPosition(current, runningItem.uid) : counts.finished;
  const queued = current.items.filter((item) => item.status === 'queued');
  const preview = queued.slice(0, QUEUE_PREVIEW);
  const remaining = counts.queued + counts.running;
  const minutes = estimateMinutes(remaining);
  let head = `分析中 ${n}/${counts.total}`;
  if (current.phase === 'failed') head = `${counts.failed} 失败 · ${counts.done} 完成`;
  else if (current.phase === 'success') head = `${counts.done} 完成`;
  return {
    ...counts,
    head,
    progress: counts.total ? (current.phase === 'running' ? n / counts.total : 1) : 0,
    estimate: minutes ? `约 ${minutes} 分` : '',
    summary: `已完成 ${counts.done} · 失败 ${counts.failed} · 排队 ${counts.queued}`,
    running: current.items.filter((item) => item.status === 'running'),
    failed: current.items.filter((item) => item.status === 'failed'),
    queuedPreview: preview,
    queuedHidden: Math.max(0, queued.length - preview.length),
    done: current.items.filter((item) => item.status === 'done'),
    canCancel: counts.queued > 0,
  };
}

export function visibleSections(batch: Batch | null | undefined, chip = 'all'): DrawerModel {
  const model = drawerModel(batch);
  if (chip === 'running') {
    return { ...model, failed: [], queuedPreview: [], queuedHidden: 0, done: [] };
  }
  if (chip === 'failed') {
    return { ...model, running: [], queuedPreview: [], queuedHidden: 0, done: [] };
  }
  return model;
}

export function cardCopy(batch: Batch | null | undefined, uid: string): CardCopy | null {
  const items = batch?.items || [];
  const index = items.findIndex((item) => item.uid === uid);
  if (index < 0) return null;
  const item = items[index];
  if (!item) return null;
  const total = items.length;
  const n = index + 1;
  if (item.status === 'running') {
    const prefix = item.source === 'auto' ? '自动分析 · ' : '';
    return { kind: 'running', label: `${prefix}正在匹配画像与 JD · 第 ${n}/${total}` };
  }
  if (item.status === 'queued') {
    return { kind: 'queued', label: item.source === 'auto' ? '自动 · 排队中' : '排队中' };
  }
  if (item.status === 'failed') {
    return { kind: 'failed', label: '分析失败', hint: '可从队列重试' };
  }
  return null;
}

export function queueRowCopy(batch: Batch | null | undefined, item: BatchItem): string {
  const n = itemPosition(batch, item.uid);
  if (item.status === 'running') return item.source === 'auto' ? '自动分析中…' : '分析中…';
  if (item.status === 'queued') return `排队 #${n}`;
  if (item.status === 'failed') {
    const reason = item.error || '分析失败';
    return reason.includes('可重试') ? reason : `${reason} · 可重试`;
  }
  return '已完成';
}
