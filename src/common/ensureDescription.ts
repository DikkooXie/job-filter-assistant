// 空 JD 在打分前的补抓决策。这里只做纯判断和排队，不发请求、不点页面。
// 真正的点击 / 短开在 background，页面上的接口仍只由被动嗅探读取。
import { jobKeyFromPageUrl } from './platforms.js';
import type { Job, Match } from './types.js';

// 与侧栏队列间隔（约 500ms）、后台批量打分间隔（约 400ms）对齐，取不小于其中较大值。
export const ENSURE_DESC_GAP_MS = 500;
export const ENSURE_DESC_TIMEOUT_MS = 6000;
export const ENSURE_DESC_POLL_MS = 250;

/** 标签页标识。正常来自 chrome.tabs，测试里会用数字或字符串。 */
export type TabId = number | string;

export interface EnsureState {
  lastAt: number;
}

export type EnsureAction = 'skip' | 'open' | 'click' | 'timeout' | 'failed';

export interface EnsureResult {
  job: Job;
  action: EnsureAction;
  scrape: string;
  reason: string;
}

export interface ClickResult {
  clicked?: unknown;
  tabId?: unknown;
}

export interface OpenHandle {
  tabId: TabId;
  close?: boolean;
}

export interface EnsureDeps {
  now: () => number;
  sleep: (ms: number) => unknown;
  clickCard: (job: Job) => unknown;
  openUrl: (job: Job) => unknown;
  closeTab: (tabId: TabId) => unknown;
  waitForDescription: (uid: string) => Promise<Job | null | undefined>;
  /** 短开 / 点卡后的详情页 DOM 刮取。 */
  scrapeDetail?: (tabId: TabId, job: Job) => unknown;
  log?: (result: EnsureResult) => unknown;
}

export function hasJobDescription(job: Job | null | undefined): boolean {
  return typeof job?.description === 'string' && job.description.trim().length > 0;
}

export function jobUrl(job: Job | null | undefined): string {
  const url = String(job?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

export function jobCardId(job: Job | null | undefined): string {
  const raw = job?.raw && typeof job.raw === 'object' ? job.raw : {};
  const direct = String(job?.jobId || raw.encryptJobId || raw.jobId || '').trim();
  if (direct) return direct;
  return jobKeyFromPageUrl(jobUrl(job));
}

// 已有正文的岗位不补抓。没有卡片 id 也没有原链则无法补，直接跳过。
export function jobNeedsDescription(job: Job | null | undefined): boolean {
  if (!job?.uid || hasJobDescription(job)) return false;
  return !!(jobCardId(job) || jobUrl(job));
}

export function ensureGapWait(lastAt: unknown, now: unknown, gap = ENSURE_DESC_GAP_MS): number {
  const previous = Number(lastAt) || 0;
  if (!previous) return 0;
  const current = Number(now) || 0;
  return Math.max(0, gap - (current - previous));
}

// 自动收录关闭时仍允许补已在库里的岗位（打开原岗位后的 JD），不新增。
export function filterCapturedJobs(
  incoming: readonly Job[] | null | undefined,
  existing: readonly Job[] | null | undefined,
  autoCapture = true,
): Job[] {
  const list = (incoming || []).filter((job): job is Job => !!job?.uid);
  if (autoCapture) return list;
  const known = new Set((existing || []).map((job) => job?.uid).filter((uid): uid is string => !!uid));
  return list.filter((job) => known.has(job.uid));
}

export interface MatchCacheProbe {
  force?: boolean;
  cached?: Match | null;
  hadDescription?: boolean;
  hasDescription?: boolean;
}

// 刚补到正文时，不用空 JD 打出来的缓存分。没有正文也不复用旧分。
export function shouldReuseMatchCache({
  force = false,
  cached = null,
  hadDescription = false,
  hasDescription = false,
}: MatchCacheProbe = {}): boolean {
  if (force || !cached || !hasDescription) return false;
  if (cached.incomplete === 'missing-description') return false;
  if (!hadDescription && hasDescription) return false;
  return true;
}

// 空描述不能进入完整打分。#74 允许超时后仍 scoreOne，这里改成降级。
export function scoreGate(job: Job | null | undefined): 'score' | 'degraded' {
  return hasJobDescription(job) ? 'score' : 'degraded';
}

export function missingDescriptionMatch(at = new Date().toISOString()): Match {
  return {
    incomplete: 'missing-description',
    score: null,
    summary: '没有岗位描述，这次没有完成分析',
    at,
  };
}

export interface IncompleteError extends Error {
  incomplete: string;
  match: Match;
}

// 全局串行：批量打分、单条打分和自动打分共用一条链，避免同时点开多张卡。
export function createEnsureQueue<J, R>(run: (job: J, state: EnsureState) => Promise<R>): (job: J) => Promise<R> {
  let chain: Promise<unknown> = Promise.resolve();
  const state: EnsureState = { lastAt: 0 };
  return (job: J) => {
    const result = chain.then(() => run(job, state));
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}

// 短开返回数字 id（关掉）或 { tabId, close }。'existing' 只等待、不关、也不知道刮哪一页。
function openedTab(opened: unknown): OpenHandle | null {
  if (typeof opened === 'number') return { tabId: opened, close: true };
  if (opened && typeof opened === 'object' && 'tabId' in opened) {
    const handle = opened as OpenHandle;
    if (handle.tabId != null) return { tabId: handle.tabId, close: handle.close !== false };
  }
  return null;
}

export function missingDescriptionError(at?: string): IncompleteError {
  const match = missingDescriptionMatch(at);
  const error = new Error(match.summary) as IncompleteError;
  error.incomplete = String(match.incomplete);
  error.match = match;
  return error;
}

function incompleteOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const flag = (value as { incomplete?: unknown }).incomplete;
  return flag ? String(flag) : '';
}

export interface IsolatedResult<T> {
  ok: boolean;
  value: T | null;
  error: string;
  incomplete: string;
}

// 批量里一个岗位补不到或打分失败时，记下来并继续下一个。
export async function isolateCall<T>(run: () => Promise<T> | T): Promise<IsolatedResult<T>> {
  try {
    const value = await run();
    return {
      ok: true,
      value,
      error: '',
      incomplete: incompleteOf(value),
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error || 'failed'),
      incomplete: incompleteOf(error),
    };
  }
}

export interface BatchOptions {
  sleep?: (ms: number) => unknown;
  gap?: number;
}

export async function runIsolatedBatch<T, R>(
  items: readonly T[] | null | undefined,
  run: (item: T, index: number) => Promise<R> | R,
  { sleep = async () => {}, gap = 0 }: BatchOptions = {},
): Promise<Array<IsolatedResult<R> & { index: number }>> {
  const list = Array.isArray(items) ? items : [];
  const results: Array<IsolatedResult<R> & { index: number }> = [];
  for (let index = 0; index < list.length; index++) {
    const item = await isolateCall(() => run(list[index] as T, index));
    results.push({ ...item, index });
    if (gap && index < list.length - 1) await sleep(gap);
  }
  return results;
}

export interface ScrapeResult {
  text: string;
  reason: string;
}

export function readScrapeResult(raw: unknown): ScrapeResult {
  if (raw && typeof raw === 'object') {
    const value = raw as { text?: unknown; reason?: unknown };
    return { text: String(value.text || ''), reason: String(value.reason || '') };
  }
  const text = raw ? String(raw) : '';
  return { text, reason: text ? '' : 'empty-or-mismatch' };
}

function clickOutcome(result: unknown): { clicked: boolean; tabId: TabId | null } {
  if (result && typeof result === 'object') {
    const value = result as ClickResult;
    return { clicked: !!value.clicked, tabId: value.tabId == null ? null : (value.tabId as TabId) };
  }
  return { clicked: !!result, tabId: null };
}

async function tryOpen(deps: EnsureDeps, job: Job): Promise<unknown> {
  try {
    return await deps.openUrl(job);
  } catch {
    return null;
  }
}

interface Trace {
  scrape: string;
  reason: string;
}

// 点卡成功但页面没有岗位标识时，scrape 记为 rejected，不能把看见的正文算到这个 uid。
async function applyScrape(deps: EnsureDeps, tabId: TabId | null, job: Job, trace: Trace): Promise<Job | null> {
  if (typeof deps.scrapeDetail !== 'function') {
    if (!trace.reason) trace.reason = 'no-scrape';
    return null;
  }
  if (tabId == null) {
    if (trace.scrape === 'skipped' && !trace.reason) trace.reason = 'no-tab';
    return null;
  }
  trace.scrape = 'attempted';
  try {
    const parsed = readScrapeResult(await deps.scrapeDetail(tabId, job));
    if (!parsed.text) {
      trace.scrape = 'rejected';
      trace.reason = parsed.reason || 'empty-or-mismatch';
      return null;
    }
    const again = typeof deps.waitForDescription === 'function' ? await deps.waitForDescription(job.uid) : null;
    trace.scrape = 'accepted';
    trace.reason = '';
    if (again && hasJobDescription(again)) return again;
    return { ...job, description: parsed.text };
  } catch {
    trace.scrape = 'rejected';
    trace.reason = 'scrape-error';
    return null;
  }
}

async function finishEnsure(deps: EnsureDeps, result: EnsureResult): Promise<EnsureResult> {
  if (result.action !== 'skip' && typeof deps.log === 'function') {
    try {
      await deps.log(result);
    } catch {
      /* 日志失败不影响补抓结果 */
    }
  }
  return result;
}

// deps：now / sleep / clickCard / openUrl / closeTab / waitForDescription。
// clickCard 可以返回 true，或 { clicked, tabId }。点中后若正文仍空，先刮这一页；
// 抽屉没有岗位标识时刮取会被拒绝。仍然没有正文，再短开原岗位，一次只处理一条。
// 浏览列表入库不走这里。openUrl 返回新标签 id、{ tabId, close } 或 null。
export async function runEnsureDescription(
  job: Job,
  deps: EnsureDeps,
  state?: EnsureState | null,
): Promise<EnsureResult> {
  const current = state || { lastAt: 0 };
  const trace: Trace = { scrape: 'skipped', reason: '' };
  if (!jobNeedsDescription(job)) return { job, action: 'skip', scrape: trace.scrape, reason: trace.reason };
  const waitMs = ensureGapWait(current.lastAt, deps.now());
  if (waitMs) await deps.sleep(waitMs);
  let opened: unknown = null;
  let clicked = false;
  let clickTabId: TabId | null = null;
  try {
    try {
      const click = clickOutcome(await deps.clickCard(job));
      clicked = click.clicked;
      clickTabId = click.tabId;
    } catch {
      clicked = false;
    }
    if (!clicked) opened = await tryOpen(deps, job);
    const firstTab = openedTab(opened);
    if (!clicked && opened == null) {
      return finishEnsure(deps, { job, action: 'failed', scrape: 'skipped', reason: 'no-page' });
    }
    current.lastAt = deps.now();
    let next = (await deps.waitForDescription(job.uid)) || job;
    if (!hasJobDescription(next) && clicked) {
      const scraped = await applyScrape(deps, clickTabId, job, trace);
      if (scraped) next = scraped;
      if (!hasJobDescription(next)) {
        opened = await tryOpen(deps, job);
        const second = openedTab(opened);
        if (second) {
          current.lastAt = deps.now();
          next = (await deps.waitForDescription(job.uid)) || next;
          if (!hasJobDescription(next)) {
            const fromPage = await applyScrape(deps, second.tabId, job, trace);
            if (fromPage) next = fromPage;
          }
        }
      }
    } else if (!hasJobDescription(next) && firstTab) {
      const scraped = await applyScrape(deps, firstTab.tabId, job, trace);
      if (scraped) next = scraped;
    }
    const filled = hasJobDescription(next);
    // 已经有正文时，不再把中途的「没刮到」当成最终原因。没正文才保留拒绝原因。
    if (filled) trace.reason = '';
    else if (!trace.reason) trace.reason = 'timeout';
    return finishEnsure(deps, {
      job: next,
      action: filled ? (opened ? 'open' : 'click') : 'timeout',
      scrape: trace.scrape,
      reason: trace.reason,
    });
  } catch {
    return finishEnsure(deps, { job, action: 'failed', scrape: trace.scrape, reason: trace.reason || 'failed' });
  } finally {
    const tab = openedTab(opened);
    if (tab?.close) {
      try {
        await deps.closeTab(tab.tabId);
      } catch {
        /* 标签可能已经关掉 */
      }
    }
  }
}

// 侧栏「打开原岗位」：已有正文只打开页面；空正文才前台打开并等待嗅探，超时再刮 DOM。
// 打分前的短开仍走 runEnsureDescription（会关标签），这里不复用那条路径。
export function decideOpenOriginal(job: Job | null | undefined): 'skip' | 'open' | 'wait' {
  const raw = String(job?.url || '').trim();
  if (!job?.uid || !raw) return 'skip';
  if (hasJobDescription(job)) return 'open';
  if (!jobUrl(job)) return 'open';
  return 'wait';
}

export function jobKeyFromUid(uid: unknown): string {
  const text = String(uid || '');
  const index = text.indexOf(':');
  if (index <= 0) return '';
  return text.slice(index + 1).trim();
}

// 详情页正文太短通常是按钮文案；过长则截断，避免把整页塞进岗位库。
export const DETAIL_TEXT_MIN = 20;
export const DETAIL_TEXT_MAX = 8000;

export function cleanDetailText(raw: unknown): string {
  let text = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // 只去掉详情区块标题。岗位职责、工作内容是正文开头，留在描述里。
  text = text.replace(/^(?:职位描述|岗位描述|职位信息)\s*[:：]?\s*/, '').trim();
  if (text.length < DETAIL_TEXT_MIN) return '';
  if (text.length > DETAIL_TEXT_MAX) return text.slice(0, DETAIL_TEXT_MAX);
  return text;
}

export interface DetailScrapeInput {
  expectedKey?: unknown;
  pageKey?: unknown;
  description?: unknown;
}

// 页面标识对不上、或正文还没渲染出来时，不采用这次刮取。
export function acceptDetailScrape({ expectedKey, pageKey, description }: DetailScrapeInput = {}): string {
  const text = cleanDetailText(description);
  if (!text) return '';
  const expected = String(expectedKey || '').trim();
  const page = String(pageKey || '').trim();
  if (!expected || !page || page !== expected) return '';
  return text;
}

export interface PatchDescriptionResult {
  jobs: Job[];
  patched: boolean;
}

// 只补已经在库里的那一条。不新建岗位；已有正文（通常来自嗅探）保持不动。
export function patchExistingDescription(
  jobs: readonly Job[] | null | undefined,
  uid: unknown,
  description: unknown,
): PatchDescriptionResult {
  const list = Array.isArray(jobs) ? jobs : [];
  const text = cleanDetailText(description);
  if (!uid || !text) return { jobs: list.slice(), patched: false };
  const index = list.findIndex((job) => job && job.uid === uid);
  if (index < 0 || hasJobDescription(list[index])) return { jobs: list.slice(), patched: false };
  const next = list.slice();
  const target = next[index] as Job;
  next[index] = { ...target, description: text };
  return { jobs: next, patched: true };
}
