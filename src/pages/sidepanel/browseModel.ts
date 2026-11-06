// 岗位浏览的纯展示规则。不读写存储，也不发起分析或流程推进。
import { hasJobDescription } from '../../common/ensureDescription.js';
import type { Job, Match } from '../../common/types.js';

export const FLOW_STATUS_LABELS: Record<string, string> = {
  prepared: '招呼语已准备',
  opened: '待确认发送',
  sent: '已发送（手动确认）',
};

export const FLOW_ENTRY_LABELS: Record<string, string> = {
  prepared: '继续流程',
  opened: '确认发送',
  sent: '查看流程',
};

export function flowStatusLabel(status?: string | null): string {
  return (status && FLOW_STATUS_LABELS[status]) || '待打招呼';
}

export function flowEntryLabel(status?: string | null): string {
  return (status && FLOW_ENTRY_LABELS[status]) || '打招呼';
}

// 读取中、读取失败、空库互斥。失败不能落到空库或「无搜索结果」。
export function librarySurface({ loading, loadError, jobCount }: { loading?: boolean; loadError?: unknown; jobCount: number }): 'loading' | 'error' | 'empty' | 'ready' {
  if (loading) return 'loading';
  if (loadError) return 'error';
  if (!jobCount) return 'empty';
  return 'ready';
}

// 原岗位还在可见列表里就回到它的标题；被移除时落到第一条；列表空了回到搜索。
export function returnFocusTarget(visibleUids: string[], returnedUid?: string | null): { kind: 'job'; uid: string } | { kind: 'search' } {
  if (returnedUid && visibleUids.includes(returnedUid)) return { kind: 'job', uid: returnedUid };
  const first = visibleUids[0];
  if (first) return { kind: 'job', uid: first };
  return { kind: 'search' };
}

export interface DeleteContext {
  screen?: string;
  selectedUid?: string | null;
  deletedUid?: string | null;
  jobs?: ReadonlyArray<Pick<Job, 'uid'> | null | undefined>;
  screenNow?: string;
  selectedUidNow?: string | null;
}

// 详情两步删除成功，且删掉的就是当前这份详情时，回到列表。
// 列表单条删除、批量删除、删除没生效，或等待期间已经离开这份详情，都留在当前屏幕。
export function shouldReturnToListAfterDelete({
  screen,
  selectedUid,
  deletedUid,
  jobs,
  screenNow = screen,
  selectedUidNow = selectedUid,
}: DeleteContext): boolean {
  if (screen !== 'detail' || !deletedUid || selectedUid !== deletedUid) return false;
  if (screenNow !== 'detail') return false;
  if (selectedUidNow !== deletedUid && selectedUidNow != null) return false;
  return !(jobs || []).some((job) => job && job.uid === deletedUid);
}

export interface BrowseView {
  search?: string;
  platform?: string;
  verdict?: string;
  sort?: string;
}

export function viewConditionsChanged(view?: BrowseView | null): boolean {
  return Boolean(
    String(view?.search || '').trim()
    || (view?.platform && view.platform !== 'all')
    || (view?.verdict && view.verdict !== 'all')
    || (view?.sort && view.sort !== 'recent'),
  );
}

export function filterVisibleJobs(jobs: readonly Job[], view?: BrowseView | null): Job[] {
  const platform = view?.platform || 'all';
  const verdict = view?.verdict || 'all';
  const sort = view?.sort || 'recent';
  let list = jobs.filter((job) => platform === 'all' || job.platform === platform);
  const query = String(view?.search || '').trim().toLowerCase();
  if (query) {
    list = list.filter((job) => [job.title, job.company, job.city, ...(job.skills || []), ...(job.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(query));
  }
  if (verdict !== 'all') {
    list = list.filter((job) => (
      verdict === 'unscored' ? !isCompleteAnalysis(job) : isCompleteAnalysis(job) && job.match?.verdict === verdict
    ));
  }
  const recent = (a: Job, b: Job) => String(b.lastSeenAt || b.savedAt || '').localeCompare(String(a.lastSeenAt || a.savedAt || ''));
  const scoreOf = (job: Job) => (isCompleteAnalysis(job) ? job.match?.score : null);
  const score = (a: Job, b: Job) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1);
  const salary = (a: Job, b: Job) => (b.salaryMaxK ?? b.salaryMinK ?? 0) - (a.salaryMaxK ?? a.salaryMinK ?? 0);
  return list.sort(sort === 'score' ? score : sort === 'salary' ? salary : recent);
}

export function riskLines(job?: Job | null): string[] {
  const lines: string[] = [];
  for (const word of job?._filter?.risks || []) {
    if (word) lines.push(`含「${word}」，沟通时确认相关安排`);
  }
  for (const line of job?.match?.risks || []) {
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

export function exclusionReasons(job?: Job | null): string[] {
  if (!job?._filter || job._filter.keep !== false) return [];
  return (job._filter.reasons || []).filter(Boolean);
}

export interface WarningItem {
  kind: 'filter' | 'warn';
  text: string;
}

export interface WarningZone {
  chip: 'filter' | 'warn';
  label: string;
  items: WarningItem[];
}

// 列表警示区方案 A。条目都在分析框里。
// 命中过滤时只露红 chip「命中过滤条件」；否则有警示才露琥珀「含 N 项警示」。
// 两种 chip 不同时出现。悬停再展开 items。没有条目时返回 null。
export function warningZone(job?: Job | null): WarningZone | null {
  const warnings = riskLines(job);
  const filters = exclusionReasons(job);
  if (!warnings.length && !filters.length) return null;
  const items: WarningItem[] = [
    ...filters.map((text) => ({ kind: 'filter' as const, text })),
    ...warnings.map((text) => ({ kind: 'warn' as const, text })),
  ];
  if (filters.length) return { chip: 'filter', label: '命中过滤条件', items };
  return { chip: 'warn', label: `含 ${warnings.length} 项警示`, items };
}

export function platformLabel(platform?: string | null): string {
  // 只收录 BOSS；旧数据里的其他平台标识仍可显示，但不再新增。
  return platform === 'boss' ? 'BOSS' : '其他平台';
}

export interface DescriptionGap {
  label: string;
  detail: string;
}

// 空描述上的分数不是完整分析。有 match 只说明跑过打分，不代表用了 JD。
export function descriptionGap(job?: Job | null): DescriptionGap | null {
  if (hasJobDescription(job) || !job?.match) return null;
  return {
    label: '缺描述',
    detail: '没有岗位描述，这次没有完成分析',
  };
}

export function jobDescriptionText(job?: Job | null): string {
  if (hasJobDescription(job)) return String(job?.description ?? '').trim();
  if (descriptionGap(job)) return '没有读到岗位描述，这次没有按 JD 完成分析。打开原岗位后再试一次。';
  return '暂无岗位描述，可打开原岗位查看完整 JD。';
}

export function isCompleteAnalysis(job?: Job | null): boolean {
  if (!hasJobDescription(job)) return false;
  if (job?.match?.incomplete === 'missing-description') return false;
  return analysisGrade(job?.match) != null;
}

export interface AnalysisGrade {
  score: number;
  filled: number;
  tone: 'low' | 'mid' | 'high';
  label: string;
}

// 列表方案 E 的分级展示。只读已有 match.score，不另存档位。
// ≤20 一格、≤40 两格为「偏低」；≤60 三格「一般」；≤80 四格「沟通确认」；高于 80 五格「匹配」。
export function analysisGrade(match?: Match | null): AnalysisGrade | null {
  if (!match) return null;
  const value: unknown = match.score;
  if (value == null || value === '') return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const score = Math.min(100, Math.max(0, Math.round(raw)));
  if (score <= 20) return { score, filled: 1, tone: 'low', label: '偏低' };
  if (score <= 40) return { score, filled: 2, tone: 'low', label: '偏低' };
  if (score <= 60) return { score, filled: 3, tone: 'mid', label: '一般' };
  if (score <= 80) return { score, filled: 4, tone: 'mid', label: '沟通确认' };
  return { score, filled: 5, tone: 'high', label: '匹配' };
}

export interface AnalysisSummary {
  grade: AnalysisGrade | null;
  summary: string;
  warnLabel: string;
}

// 岗位 Tab 摘要卡。没有分数时不造分级、不造警示计数。
export function analysisSummary(job?: Job | null): AnalysisSummary {
  if (descriptionGap(job)) return { grade: null, summary: '', warnLabel: '' };
  const grade = analysisGrade(job?.match);
  if (!grade) return { grade: null, summary: '', warnLabel: '' };
  const count = riskLines(job).length;
  return {
    grade,
    summary: String(job?.match?.summary || ''),
    warnLabel: count ? `含 ${count} 项警示` : '',
  };
}

// 新收录提示展开后自动收回的时间。点击提示或滚动列表会提前收回。
export const FRESH_CAPSULE_MS = 8000;
// 提示收回后，新岗位行在列表里连续可见这么久，就清掉这一条 NEW。
export const FRESH_MARK_VISIBLE_MS = 2000;

function idSet(value: unknown): Set<string> {
  if (value instanceof Set) return new Set(value as Set<string>);
  if (Array.isArray(value)) return new Set(value.filter(Boolean) as string[]);
  return new Set();
}

export interface CaptureSession {
  ready?: boolean;
  seen?: unknown;
  fresh?: unknown;
}

export interface CapturedNote {
  ready: true;
  seen: Set<string>;
  fresh: Set<string>;
  arrived: string[];
}

// 会话内比较岗位 id。首次成功读取只建立基线，不算新收录；之后多出来的 id 记入 fresh。
// 不读写存储。岗位从库里消失时，同步从 fresh 去掉。
export function noteCapturedJobs(session: CaptureSession | null | undefined, jobs?: ReadonlyArray<Pick<Job, 'uid'> | null | undefined>): CapturedNote {
  const present = new Set<string>();
  const order: string[] = [];
  for (const job of jobs || []) {
    const uid = job?.uid;
    if (!uid || present.has(uid)) continue;
    present.add(uid);
    order.push(uid);
  }
  const fresh = idSet(session?.fresh);
  for (const uid of fresh) if (!present.has(uid)) fresh.delete(uid);
  if (session?.ready !== true) {
    return { ready: true, seen: present, fresh, arrived: [] };
  }
  const seen = idSet(session?.seen);
  const arrived: string[] = [];
  for (const uid of order) {
    if (seen.has(uid)) continue;
    seen.add(uid);
    fresh.add(uid);
    arrived.push(uid);
  }
  return { ready: true, seen, fresh, arrived };
}

// 智能分析抽屉的范围。unscored 只跑已选里还没有分析结果的岗位；force 原样返回已选。
// fingerprint：没有匹配结果，或结果上的画像戳不是当前指纹。调用方对该批传 force，避免旧缓存短路。
export function analysisTargets(jobs: readonly Job[] | null | undefined, mode: string, fingerprint?: string | null): Job[] {
  const list = (jobs || []).filter((job) => job?.uid);
  if (mode === 'force') return list.slice();
  if (mode === 'unscored') return list.filter((job) => !isCompleteAnalysis(job));
  if (mode === 'fingerprint') {
    const fp = String(fingerprint ?? '');
    return list.filter((job) => !isCompleteAnalysis(job) || String(job.match?.profileFp ?? '') !== fp);
  }
  return [];
}

// 当前画像下未分析、以及全部重跑，都不能复用旧的匹配缓存。
export function analysisUsesForce(mode: string): boolean {
  return mode === 'force' || mode === 'fingerprint';
}

// 这一批没有可分析岗位时的提示。fingerprint 在确实选了岗位时说明它们已盖上当前画像戳。
export function analysisEmptyMessage(mode: string, selectedCount: number): string {
  if (mode === 'unscored') return '所选岗位都已有分析结果';
  if (mode === 'fingerprint' && selectedCount) return '所选岗位都已在当前画像下分析过';
  return '未选择岗位';
}
