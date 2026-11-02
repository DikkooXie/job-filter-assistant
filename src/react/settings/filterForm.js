// 岗位筛选页的表单补丁。salaryMaxK 仍保存在 filters 里，但页面不再编辑它。
import { toList } from '../../ui/ui-common.js';

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
];

export function filterSettingsPatch(partial) {
  const filters = {};
  if (!partial || typeof partial !== 'object') return { filters };
  for (const key of FILTER_FORM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) filters[key] = partial[key];
  }
  return { filters };
}

// 把页面上的改动叠到已有 filters 上。传入的 salaryMaxK 一律忽略。
export function mergeFilterPatch(current, partial) {
  const base = current && typeof current === 'object' ? current : {};
  const { filters } = filterSettingsPatch(partial);
  return { ...base, ...filters, salaryMaxK: base.salaryMaxK ?? null };
}

export function commitTags(value, input) {
  const base = Array.isArray(value) ? value : [];
  const next = [...base];
  for (const part of toList(input)) {
    if (!next.some((item) => String(item).toLowerCase() === part.toLowerCase())) next.push(part);
  }
  return next.length === base.length ? base : next;
}

export function removeLastTag(value, input) {
  const list = Array.isArray(value) ? value : [];
  if (input || !list.length) return list;
  return list.slice(0, -1);
}

export function parseSalaryMinK(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
