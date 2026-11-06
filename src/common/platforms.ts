// 平台适配层：把 BOSS 直聘的原始接口响应归一化为统一岗位对象。
// 字段依据真机逆向样本确定，非猜测。
import { PLATFORM } from './constants.js';
import type { Job, PlatformId } from './types.js';

// 统一岗位 schema：
// { uid, platform, jobId, title, salaryText, salaryMinK, salaryMaxK,
//   city, district, experience, degree, skills[], tags[], welfare[],
//   company, companyIndustry, companyScale, companyType, companyStage,
//   hrName, hrTitle, description, url, publishedAt, raw{关键凭据}, savedAt }

export interface NormalizeOptions {
  /** 详情接口的请求 URL；用于从 query 取 encryptJobId，保证 uid 与「当前岗位」信号一致。 */
  url?: string;
  pageUrl?: string;
  hintJobId?: string;
}

export interface CaptureKeyNote {
  kind: string;
  reason: string;
  uid: string;
  hint: string;
  bodyKey: string;
}

export interface DetailUidDecision {
  jobId: string;
  hintApplied: boolean;
  rejected: boolean;
  reason: string;
  hint: string;
  bodyKey: string;
}

// —— URL 判定：命中即认为是可嗅探的岗位列表/详情接口 ——
export function matchPlatformApi(urlStr: unknown): { platform: PlatformId; kind: 'list' | 'detail' } | null {
  let u: URL;
  try {
    u = new URL(String(urlStr), 'https://x');
  } catch {
    return null;
  }
  const host = u.hostname;
  const path = u.pathname;
  // BOSS 列表：search/joblist、pc/recommend/job/list、mobile/search/joblist
  // BOSS 详情：job/detail、pc/recommend/job/detail、job/card、geek/job/detail
  if (/(^|\.)zhipin\.com$/i.test(host)) {
    if (/\/wapi\/zpgeek\/(search\/joblist|pc\/recommend\/job\/list|mobile\/search\/joblist)\.json/.test(path)) {
      return { platform: PLATFORM.boss, kind: 'list' };
    }
    if (
      /\/wapi\/zpgeek\/(job\/detail(?:\/[a-z]+)?|pc\/recommend\/job\/detail|job\/card|geek\/job\/detail)\.json/.test(path)
    ) {
      return { platform: PLATFORM.boss, kind: 'detail' };
    }
  }
  return null;
}

// —— 从站点 host 推断平台 ——
export function platformOfHost(host = ''): PlatformId | null {
  if (/(^|\.)zhipin\.com$/i.test(host)) return PLATFORM.boss;
  return null;
}

// —— 解析入口：给定平台 + 原始响应，返回归一化岗位数组 ——
export function normalizeResponse(platform: string, payload: unknown, opts: NormalizeOptions = {}): Job[] {
  try {
    if (platform === PLATFORM.boss) return normalizeBoss(payload, opts);
  } catch {
    return [];
  }
  return [];
}

// 从详情请求 URL 里取岗位标识（与 collector.jobKeyFromDetail 同源，保证 uid 对得上）
function jobKeyFromUrl(urlStr: string | undefined): string {
  if (!urlStr) return '';
  try {
    const q = new URL(urlStr, 'https://x').searchParams;
    return str(q.get('encryptJobId') || q.get('jobId') || q.get('jobid'));
  } catch {
    return '';
  }
}

// 用户打开的页面地址。列表页通常提取不到；job_detail/<id>.html 能对上岗位库 uid。
// collector 里有一份相同规则（内容脚本不能 import）。
export function jobKeyFromPageUrl(pageUrl: unknown): string {
  const text = String(pageUrl || '');
  const matched =
    text.match(/job_detail\/([\w-]+)\.html/) ||
    text.match(/[?&]encryptJobId=([\w-]+)/) ||
    text.match(/[?&]jobId=([\w-]+)/) ||
    text.match(/\/job\/(\d+)/) ||
    text.match(/[?&]jobid=(\d+)/i);
  return matched ? (matched[1] ?? '') : '';
}

// 查询参数优先（请求明确指向的岗位）。没有查询参数时，详情页路径上的 id 优先于响应体里的纯数字 id，
// 避免 job/detail 只回了内部 jobId、却和列表里的 encryptJobId 合成两个 uid。
// 列表抽屉不改 URL。点卡时 collector 带上的 hint 只在响应体没有另一条非数字 id 时使用。
// 响应体已有另一条非数字 id 时信响应体，免得详情页上的推荐请求被写进当前岗位。
export function preferDetailJobKey(
  queryKey: unknown,
  pageKey: unknown,
  bodyKey: unknown,
  hintKey: unknown,
): string {
  const query = str(queryKey);
  const page = str(pageKey);
  const body = str(bodyKey);
  const safeHint = safeDetailHint(hintKey);
  if (query) return query;
  if (page && (!body || page === body)) return page;
  if (page && body && /^\d+$/.test(body) && !/^\d+$/.test(page)) return page;
  if (safeHint && (!body || body === safeHint || /^\d+$/.test(body))) return safeHint;
  return body || page || safeHint || '';
}

function safeDetailHint(hintKey: unknown): string {
  const hint = str(hintKey);
  return hint && hint.length <= 80 && !/[/?#\s]/.test(hint) ? hint : '';
}

// 点卡 hint 只在响应体没有另一条非数字 id 时对齐。错配时拒绝把 JD 写到点卡 uid，仍返回响应体自己的 id。
export function detailUidDecision(
  { queryKey, pageKey, bodyKey, hintKey }: Partial<Record<'queryKey' | 'pageKey' | 'bodyKey' | 'hintKey', unknown>> = {},
): DetailUidDecision {
  const jobId = preferDetailJobKey(queryKey, pageKey, bodyKey, hintKey);
  const hint = safeDetailHint(hintKey);
  const body = str(bodyKey);
  const rejected = !!(hint && body && !/^\d+$/.test(body) && body !== hint && jobId !== hint);
  const hintApplied = !!(hint && jobId === hint && body !== hint);
  return {
    jobId,
    hintApplied,
    rejected,
    reason: rejected ? 'uid-mismatch' : hintApplied ? 'uid-hint' : '',
    hint,
    bodyKey: body,
  };
}

// 内容脚本拒绝错配时不把 hint 交给归一化，避免数字 id 规则把别岗写进点卡 uid。
export function acceptedHintJobId(hintJobId: unknown, hintRejected: unknown): string {
  if (str(hintRejected)) return '';
  return str(hintJobId);
}

// 只报告 hint 被采用或被拒绝。不读 JD 字段，也不改岗位对象。
export function captureKeyNotes(platform: string, payload: unknown, opts: NormalizeOptions = {}): CaptureKeyNote[] {
  if (platform !== PLATFORM.boss || !isObj(payload)) return [];
  if (payload.code !== 0 && payload.code !== '0') return [];
  const zp = isObj(payload.zpData) ? payload.zpData : {};
  const notes: CaptureKeyNote[] = [];
  if (isObj(zp.jobInfo)) {
    const note = noteForBossInfo(zp.jobInfo, opts);
    if (note) notes.push(note);
  }
  const card = bossCardPayload(zp);
  if (card && card !== zp.jobInfo) {
    const note = noteForBossInfo(card, opts);
    if (note) notes.push(note);
  }
  return notes;
}

function noteForBossInfo(info: Record<string, unknown>, opts: NormalizeOptions): CaptureKeyNote | null {
  const bodyKey = str(info.encryptId) || str(info.encryptJobId) || str(info.jobId);
  const decision = detailUidDecision({
    queryKey: jobKeyFromUrl(opts.url),
    pageKey: jobKeyFromPageUrl(opts.pageUrl),
    bodyKey,
    hintKey: opts.hintJobId,
  });
  if (!decision.rejected && !decision.hintApplied) return null;
  return {
    kind: decision.rejected ? 'uid-mismatch' : 'uid-hint',
    reason: decision.reason,
    uid: decision.jobId ? `${PLATFORM.boss}:${decision.jobId}` : '',
    hint: decision.hint,
    bodyKey: decision.bodyKey,
  };
}

// ============ BOSS 直聘 ============
// 信封 {code, message, zpData}；code===0 成功；列表在 zpData.jobList[]。
// 列表抽屉的 job/card 把单条放在 zpData.jobCard（字段接近列表项，另带 postDescription），
// 整页详情放在 zpData.jobInfo。两类同时出现时按 uid 合并，JD 以非空为准。
function normalizeBoss(payload: unknown, opts: NormalizeOptions = {}): Job[] {
  if (!isObj(payload)) return [];
  if (payload.code !== 0 && payload.code !== '0') return [];
  const zpData = isObj(payload.zpData) ? payload.zpData : {};
  const jobs: Job[] = [];
  const list = zpData.jobList || zpData.recommendJobList || (Array.isArray(zpData) ? zpData : []);
  if (Array.isArray(list) && list.length) {
    for (const item of list) {
      const job = bossJob(item);
      if (job) jobs.push(job);
    }
  }
  if (isObj(zpData.jobInfo)) {
    const one = bossDetailJob(zpData, opts);
    if (one) jobs.push(one);
  }
  const card = bossCardPayload(zpData);
  if (card) {
    const one = bossCardJob(card, opts);
    if (one) jobs.push(one);
  }
  return mergeBossSameUid(jobs);
}

// 卡片 / 同类详情包。jobInfo 已由 bossDetailJob 处理，这里不再把 jobDetail 再解析成第二条。
function bossCardPayload(zp: Record<string, unknown>): Record<string, unknown> | null {
  if (isObj(zp.jobCard)) return zp.jobCard;
  if (!isObj(zp.jobInfo) && isObj(zp.jobDetail)) return zp.jobDetail;
  const hasList =
    (Array.isArray(zp.jobList) && zp.jobList.length > 0) ||
    (Array.isArray(zp.recommendJobList) && zp.recommendJobList.length > 0);
  if (!isObj(zp.jobInfo) && !hasList && bossDescription(zp)) return zp;
  return null;
}

// 同一响应里列表项和卡片/详情可能是同一岗位：后者补上 JD，空字段不回盖。
function mergeBossSameUid(jobs: Job[]): Job[] {
  const byUid = new Map<string, Job>();
  for (const job of jobs) {
    const prev = byUid.get(job.uid);
    if (!prev) {
      byUid.set(job.uid, job);
      continue;
    }
    const raw = { ...(prev.raw || {}), ...(job.raw || {}) };
    const merged: Job = {
      ...prev,
      ...job,
      description: job.description || prev.description,
    };
    const prunedRaw = pruneEmpty(raw, []);
    if (Object.keys(prunedRaw).length) merged.raw = prunedRaw;
    byUid.set(job.uid, merged);
  }
  return [...byUid.values()];
}

// 详情响应结构与列表不同：岗位在 zpData.jobInfo，公司在 zpData.brandComInfo，HR 在 zpData.bossInfo。
// 字段名依真机探针记录（showSkills/degreeName/locationName…）。
// 关键：只回填「非空」字段——mergeJobs 是 {...prev,...raw} 覆盖式合并，空串会抹掉列表已抓到的好数据。
function bossDetailJob(zp: Record<string, unknown>, opts: NormalizeOptions = {}): Job | null {
  const info = isObj(zp.jobInfo) ? zp.jobInfo : {};
  const brand = isObj(zp.brandComInfo) ? zp.brandComInfo : {};
  const boss = isObj(zp.bossInfo) ? zp.bossInfo : {};
  // uid 必须与「当前岗位」和列表里的 encryptJobId 一致，否则打开原岗位后描述写进另一条记录，侧栏仍是空的。
  const bodyKey = str(info.encryptId) || str(info.encryptJobId) || str(info.jobId);
  const jobId = preferDetailJobKey(jobKeyFromUrl(opts.url), jobKeyFromPageUrl(opts.pageUrl), bodyKey, opts.hintJobId);
  if (!jobId) return null;
  const salaryText = str(info.salaryDesc);
  const [minK, maxK] = parseSalary(salaryText);
  const full = {
    uid: `${PLATFORM.boss}:${jobId}`,
    platform: PLATFORM.boss,
    jobId,
    title: str(info.jobName),
    salaryText,
    salaryMinK: minK,
    salaryMaxK: maxK,
    city: str(info.locationName) || str(info.cityName),
    district: joinNonEmpty([info.areaDistrict, info.businessDistrict], '·'),
    experience: str(info.experienceName) || str(info.jobExperience),
    degree: str(info.degreeName) || str(info.jobDegree),
    skills: arrStr(info.showSkills) || arrStr(info.skills),
    tags: arrStr(info.jobLabels),
    welfare: arrStr(brand.welfareList) || arrStr(info.welfareList),
    company: str(brand.brandName),
    companyIndustry: str(brand.industryName) || str(brand.brandIndustry),
    companyScale: str(brand.scaleName) || str(brand.brandScaleName),
    companyStage: str(brand.stageName) || str(brand.brandStageName),
    hrName: str(boss.name) || str(boss.bossName),
    hrTitle: str(boss.title) || str(boss.bossTitle),
    description: bossDescription(info, zp.jobDetail),
    url: jobId ? `https://www.zhipin.com/job_detail/${jobId}.html` : '',
    raw: {
      encryptJobId: jobId,
      securityId: str(info.securityId),
      encryptBrandId: str(brand.encryptBrandId),
    },
  };
  // 剔除空值，避免覆盖列表已有数据（uid/platform/jobId 始终保留）。
  // pruneEmpty 丢掉了字面量形状，这里按归一化 schema 收回 Job。
  return pruneEmpty(full, ['uid', 'platform', 'jobId']) as unknown as Job;
}

// 去掉空字符串、空数组、null/undefined 的字段（keep 列表里的键无条件保留）
function pruneEmpty(obj: Record<string, unknown>, keep: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keep.includes(k)) {
      out[k] = v;
      continue;
    }
    if (v == null) continue;
    if (typeof v === 'string' && v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isObj(v)) {
      const inner = pruneEmpty(v, []);
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return out;
}

// 列表抽屉 job/card：字段名接近列表项（encryptJobId/cityName/brandName），JD 在 postDescription。
// jobDetail 对象是同类详情包，字段名可能更接近 jobInfo。空字段剔除，避免盖掉列表已有值。
function bossCardJob(card: Record<string, unknown>, opts: NormalizeOptions = {}): Job | null {
  if (!isObj(card)) return null;
  const bodyKey = str(card.encryptJobId) || str(card.encryptId) || str(card.jobId);
  const jobId = preferDetailJobKey(jobKeyFromUrl(opts.url), jobKeyFromPageUrl(opts.pageUrl), bodyKey, opts.hintJobId);
  if (!jobId) return null;
  const salaryText = str(card.salaryDesc);
  const [minK, maxK] = parseSalary(salaryText);
  const showSkills = arrStr(card.showSkills);
  const full = {
    uid: `${PLATFORM.boss}:${jobId}`,
    platform: PLATFORM.boss,
    jobId,
    title: str(card.jobName),
    salaryText,
    salaryMinK: minK,
    salaryMaxK: maxK,
    city: str(card.cityName) || str(card.locationName),
    district: joinNonEmpty([card.areaDistrict, card.businessDistrict], '·'),
    experience: str(card.jobExperience) || str(card.experienceName),
    degree: str(card.jobDegree) || str(card.degreeName),
    skills: showSkills.length ? showSkills : arrStr(card.skills),
    tags: arrStr(card.jobLabels),
    welfare: arrStr(card.welfareList),
    company: str(card.brandName),
    companyIndustry: str(card.brandIndustry) || str(card.industryName),
    companyScale: str(card.brandScaleName) || str(card.scaleName),
    companyStage: str(card.brandStageName) || str(card.stageName),
    hrName: str(card.bossName),
    hrTitle: str(card.bossTitle),
    description: bossDescription(card),
    url: `https://www.zhipin.com/job_detail/${jobId}.html`,
    raw: {
      securityId: str(card.securityId),
      encryptJobId: jobId,
      encryptBrandId: str(card.encryptBrandId),
      lid: str(card.lid),
    },
  };
  return pruneEmpty(full, ['uid', 'platform', 'jobId']) as unknown as Job;
}

// JD 正文。卡片用 postDescription；详情还有 jobDesc/postDesc，少数包把正文放在 jobDetail。
function bossDescription(...sources: unknown[]): string {
  for (const info of sources) {
    const text = readBossDescription(info);
    if (text) return text;
  }
  return '';
}

function readBossDescription(info: unknown): string {
  if (typeof info === 'string') return str(info);
  if (!isObj(info)) return '';
  const direct = str(info.postDescription) || str(info.jobDesc) || str(info.postDesc) || str(info.jobDescription);
  if (direct) return direct;
  const detail = info.jobDetail;
  if (typeof detail === 'string') {
    const text = str(detail);
    if (text) return text;
  } else if (isObj(detail)) {
    const nested =
      str(detail.postDescription) ||
      str(detail.jobDesc) ||
      str(detail.postDesc) ||
      str(detail.jobDescription) ||
      (typeof detail.content === 'string' ? str(detail.content) : '');
    if (nested) return nested;
  }
  return typeof info.content === 'string' ? str(info.content) : '';
}

function bossJob(o: unknown): Job | null {
  if (!isObj(o)) return null;
  const jobId = str(o.encryptJobId) || str(o.jobId);
  if (!jobId && !str(o.jobName)) return null;
  const salaryText = str(o.salaryDesc);
  const [minK, maxK] = parseSalary(salaryText);
  const url = o.encryptJobId ? `https://www.zhipin.com/job_detail/${o.encryptJobId}.html` : str(o.jobHref);
  return {
    uid: `${PLATFORM.boss}:${jobId}`,
    platform: PLATFORM.boss,
    jobId,
    title: str(o.jobName),
    salaryText,
    salaryMinK: minK,
    salaryMaxK: maxK,
    city: str(o.cityName),
    district: joinNonEmpty([o.areaDistrict, o.businessDistrict], '·'),
    experience: str(o.jobExperience),
    degree: str(o.jobDegree),
    skills: arrStr(o.skills),
    tags: arrStr(o.jobLabels),
    welfare: arrStr(o.welfareList),
    company: str(o.brandName),
    companyIndustry: str(o.brandIndustry),
    companyScale: str(o.brandScaleName),
    companyType: '',
    companyStage: str(o.brandStageName),
    hrName: str(o.bossName),
    hrTitle: str(o.bossTitle),
    description: '', // BOSS 列表不含 JD 正文，需详情接口
    url,
    publishedAt: '',
    raw: {
      securityId: str(o.securityId),
      encryptJobId: str(o.encryptJobId),
      encryptBrandId: str(o.encryptBrandId),
      lid: str(o.lid),
    },
  };
}

// ============ 工具函数 ============
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim();
}

function arrStr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of x) {
    const s = str(isObj(v) ? (v.name ?? v.jobTagName ?? v.labelName) : v);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function joinNonEmpty(arr: unknown[], sep: string): string {
  return arr.map(str).filter(Boolean).join(sep);
}

// 解析中文薪资串："1.1-1.8万·13薪" / "10-13K·13薪" / "5千-1万" / "8-12k"
// 返回 [minK, maxK]（千元/月）。解析不出返回 [null, null]。
export function parseSalary(text: unknown): [number | null, number | null] {
  const s = str(text);
  if (!s) return [null, null];
  // 抓取 "数字[单位]-数字[单位]" 或单值
  const unit = (u: string | undefined): number | null =>
    u === '万' || u === 'w' || u === 'W' ? 10 : u === '千' || u === 'k' || u === 'K' ? 1 : null;
  const re = /(\d+(?:\.\d+)?)\s*([万千kKwW])?\s*[-~到]\s*(\d+(?:\.\d+)?)\s*([万千kKwW])?/;
  const m = s.match(re);
  if (m) {
    const u2 = unit(m[4] ?? undefined) ?? unit(m[2] ?? undefined) ?? 1; // 末位单位优先，缺省按千元
    const u1 = unit(m[2] ?? undefined) ?? u2;
    let lo = parseFloat(m[1] ?? '0') * u1;
    let hi = parseFloat(m[3] ?? '0') * u2;
    lo = round1(lo);
    hi = round1(hi);
    if (lo > hi) [lo, hi] = [hi, lo];
    return [lo, hi];
  }
  // 单值
  const m2 = s.match(/(\d+(?:\.\d+)?)\s*([万千kKwW])/);
  if (m2) {
    const v = round1(parseFloat(m2[1] ?? '0') * (unit(m2[2] ?? undefined) ?? 1));
    return [v, v];
  }
  return [null, null];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
