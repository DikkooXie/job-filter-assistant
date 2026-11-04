// 空 JD 在打分前的补抓决策。这里只做纯判断和排队，不发请求、不点页面。
// 真正的点击 / 短开在 background，页面上的接口仍只由被动嗅探读取。
import { jobKeyFromPageUrl } from './platforms.js';

// 与侧栏队列间隔（约 500ms）、后台批量打分间隔（约 400ms）对齐，取不小于其中较大值。
export const ENSURE_DESC_GAP_MS = 500;
export const ENSURE_DESC_TIMEOUT_MS = 6000;
export const ENSURE_DESC_POLL_MS = 250;

export function hasJobDescription(job) {
  return typeof job?.description === 'string' && job.description.trim().length > 0;
}

export function jobUrl(job) {
  const url = String(job?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

export function jobCardId(job) {
  const raw = job?.raw && typeof job.raw === 'object' ? job.raw : {};
  const direct = String(job?.jobId || raw.encryptJobId || raw.jobId || '').trim();
  if (direct) return direct;
  return jobKeyFromPageUrl(jobUrl(job));
}

// 已有正文的岗位（含 51 列表自带的 jobDescribe）不补抓。没有卡片 id 也没有原链则无法补，直接跳过。
export function jobNeedsDescription(job) {
  if (!job?.uid || hasJobDescription(job)) return false;
  return !!(jobCardId(job) || jobUrl(job));
}

export function ensureGapWait(lastAt, now, gap = ENSURE_DESC_GAP_MS) {
  const previous = Number(lastAt) || 0;
  if (!previous) return 0;
  const current = Number(now) || 0;
  return Math.max(0, gap - (current - previous));
}

// 自动收录关闭时仍允许补已在库里的岗位（打开原岗位后的 JD），不新增。
export function filterCapturedJobs(incoming, existing, autoCapture = true) {
  const list = (incoming || []).filter((job) => job && job.uid);
  if (autoCapture) return list;
  const known = new Set((existing || []).map((job) => job && job.uid).filter(Boolean));
  return list.filter((job) => known.has(job.uid));
}

// 刚补到正文时，不用空 JD 打出来的缓存分。
export function shouldReuseMatchCache({ force = false, cached = null, hadDescription = false, hasDescription = false } = {}) {
  if (force || !cached) return false;
  if (!hadDescription && hasDescription) return false;
  return true;
}

// 全局串行：批量打分、单条打分和自动打分共用一条链，避免同时点开多张卡。
export function createEnsureQueue(run) {
  let chain = Promise.resolve();
  const state = { lastAt: 0 };
  return (job) => {
    const result = chain.then(() => run(job, state));
    chain = result.then(() => {}, () => {});
    return result;
  };
}

// deps：now / sleep / clickCard / openUrl / closeTab / waitForDescription。
// openUrl 返回新标签 id、'existing'（已有原岗位页，不关闭）或 null（开不了）。
export async function runEnsureDescription(job, deps, state) {
  const current = state || { lastAt: 0 };
  if (!jobNeedsDescription(job)) return { job, action: 'skip' };
  const waitMs = ensureGapWait(current.lastAt, deps.now());
  if (waitMs) await deps.sleep(waitMs);
  let opened = null;
  let clicked = false;
  try {
    try {
      clicked = !!(await deps.clickCard(job));
    } catch {
      clicked = false;
    }
    if (!clicked) {
      try {
        opened = await deps.openUrl(job);
      } catch {
        opened = null;
      }
    }
    if (!clicked && opened == null) return { job, action: 'failed' };
    current.lastAt = deps.now();
    const filled = await deps.waitForDescription(job.uid);
    const next = filled || job;
    if (hasJobDescription(next)) return { job: next, action: clicked ? 'click' : 'open' };
    return { job: next, action: 'timeout' };
  } catch {
    return { job, action: 'failed' };
  } finally {
    if (typeof opened === 'number') {
      try { await deps.closeTab(opened); } catch { /* 标签可能已经关掉 */ }
    }
  }
}
