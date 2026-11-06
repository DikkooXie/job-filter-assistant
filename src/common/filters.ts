// 本地岗位筛选（不消耗 AI）：关键词、薪资、城市、经验、学历、屏蔽公司、风险词标注。
// 用于在 AI 打分之前先粗筛，或在列表里即时过滤。
import type { FilterResult, Job, JobFilters } from './types.js';

// 对单个岗位应用筛选，返回 { keep, matchedInclude[], matchedExclude[], risks[], reasons[] }
export function evaluateJob(job: Job, filters: JobFilters | null | undefined): FilterResult {
  const f: Partial<JobFilters> = filters || {};
  const hay = jobText(job);
  const result: FilterResult = { keep: true, matchedInclude: [], matchedExclude: [], risks: [], reasons: [] };

  // 屏蔽公司
  const company = (job.company || '').toLowerCase();
  for (const c of arr(f.excludeCompanies)) {
    if (c && company.includes(c.toLowerCase())) {
      result.keep = false;
      result.reasons.push(`公司被屏蔽：${c}`);
    }
  }

  // 排除关键词（命中即弃）
  for (const kw of arr(f.keywordsExclude)) {
    if (kw && hay.includes(kw.toLowerCase())) {
      result.matchedExclude.push(kw);
      result.keep = false;
      result.reasons.push(`命中排除词：${kw}`);
    }
  }

  // 包含关键词（有配置时，须命中任一）
  const inc = arr(f.keywordsInclude);
  if (inc.length) {
    const hit = inc.filter((kw) => kw && hay.includes(kw.toLowerCase()));
    result.matchedInclude = hit;
    if (hit.length === 0) {
      result.keep = false;
      result.reasons.push('未命中任何包含关键词');
    }
  }

  // 城市
  const cities = arr(f.cities);
  if (cities.length) {
    const jc = (job.city || '') + (job.district || '');
    const hit = cities.some((c) => c && jc.includes(c));
    if (!hit) {
      result.keep = false;
      result.reasons.push('城市不匹配');
    }
  }

  // 薪资（岗位薪资区间与期望有交集即可）
  const wantMinK = num(f.salaryMinK);
  const wantMaxK = num(f.salaryMaxK);
  if (wantMinK || wantMaxK) {
    const jobMin = num(job.salaryMinK);
    const jobMax = num(job.salaryMaxK);
    if (jobMin != null || jobMax != null) {
      const wantMin = wantMinK ?? 0;
      const jMax = jobMax ?? jobMin;
      if (jMax != null && jMax < wantMin) {
        result.keep = false;
        result.reasons.push(`薪资低于期望下限 ${wantMin}k`);
      }
    }
  }

  // 经验/学历（软匹配：有配置且岗位有值且不含任一档位则记原因，但不强制排除，避免误杀）
  const exps = arr(f.experience);
  if (exps.length && job.experience) {
    const experience = job.experience;
    if (!exps.some((e) => experience.includes(e))) result.reasons.push('经验档位不在偏好内');
  }
  const degs = arr(f.degrees);
  if (degs.length && job.degree) {
    const degree = job.degree;
    if (!degs.some((d) => degree.includes(d))) result.reasons.push('学历档位不在偏好内');
  }

  // 风险词标注（不排除，仅提示）
  for (const rk of arr(f.riskKeywords)) {
    if (rk && hay.includes(rk.toLowerCase())) result.risks.push(rk);
  }

  return result;
}

// 批量：评估结果挂在 _filter 上。
// 开启过滤时只返回 keep 的岗位；关闭时全部返回，keep:false 的岗位带着命中原因供列表标注。
export function applyFilters(jobs: readonly Job[], filters?: JobFilters | null): Job[] {
  const enabled = !!(filters && filters.enabled);
  const out: Job[] = [];
  for (const j of jobs) {
    const ev = evaluateJob(j, filters);
    if (!enabled || ev.keep) out.push({ ...j, _filter: ev });
  }
  return out;
}

// 自动打分的候选：过滤开启时跳过会被隐藏的岗位，关闭时全部打分。
export function autoScoreUids(jobs: readonly Job[], filters?: JobFilters | null): string[] {
  return applyFilters(jobs, filters).map((j) => j.uid);
}

// 岗位全文（小写），供筛选与偏好的字面匹配共用。
export function jobText(job: Job): string {
  return [
    job.title,
    job.company,
    job.companyIndustry,
    job.description,
    (job.skills || []).join(' '),
    (job.tags || []).join(' '),
    (job.welfare || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function arr(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null;
}
