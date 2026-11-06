// 岗位筛选页的表单补丁。salaryMaxK 仍保存在 filters 里，但页面不再编辑它。
import { toList } from '../../common/text.js';
import type { JobFilters } from '../../common/types.js';

export const FILTER_FORM_KEYS = [
  'enabled',
  'keywordsInclude',
  'keywordsExclude',
  'riskKeywords',
  'excludeCompanies',
  'cities',
  'salaryMinK',
  'experience',
  'degrees',
] as const;

export type FilterFormKey = (typeof FILTER_FORM_KEYS)[number];

/** 只保留表单编辑的字段；值的合法性由 settingsStore 的合并逻辑兜底。 */
export function filterSettingsPatch(partial: unknown): { filters: Partial<JobFilters> } {
  const filters: Record<string, unknown> = {};
  if (!partial || typeof partial !== 'object') return { filters: filters as Partial<JobFilters> };
  const src = partial as Record<string, unknown>;
  for (const key of FILTER_FORM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) filters[key] = src[key];
  }
  return { filters: filters as Partial<JobFilters> };
}

// 把页面上的改动叠到已有 filters 上。传入的 salaryMaxK 一律忽略。
export function mergeFilterPatch(current: unknown, partial: unknown): Record<string, unknown> {
  const base = current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  const { filters } = filterSettingsPatch(partial);
  return { ...base, ...filters, salaryMaxK: base.salaryMaxK ?? null };
}

export function commitTags(value: unknown, input: unknown): string[] {
  const base = Array.isArray(value) ? (value as string[]) : [];
  const next = [...base];
  for (const part of toList(input)) {
    if (!next.some((item) => String(item).toLowerCase() === part.toLowerCase())) next.push(part);
  }
  return next.length === base.length ? base : next;
}

export function removeLastTag(value: unknown, input: unknown): string[] {
  const list = Array.isArray(value) ? (value as string[]) : [];
  if (input || !list.length) return list;
  return list.slice(0, -1);
}

export function parseSalaryMinK(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
