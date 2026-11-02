// 画像导入：体积限制、JSON 字段校验、多材料分段合并。
// 不改画像存储结构；合并规则与设置页原实现一致。
import { emptyProfile, mergeDraft, sanitizeProfile } from './profile.js';

export const MAX_PROFILE_IMPORT_BYTES = 10 * 1024 * 1024;
export const MATERIAL_CHUNK_CHARS = 10000;

const PROFILE_KEYS = ['target', 'basics', 'capabilities', 'workSummary', 'projectSummary', 'highlights', 'preference'];

const NESTED = {
  target: {
    lists: ['jobTitles', 'cities', 'industries', 'companySizes', 'workModes'],
    numbers: ['salaryMinK', 'salaryMaxK'],
    positive: ['salaryMinK', 'salaryMaxK'],
  },
  basics: {
    texts: ['name', 'education', 'currentTitle'],
    numbers: ['yearsOfExperience'],
  },
  capabilities: {
    lists: ['skills', 'strengths', 'industryExperience'],
  },
  preference: {
    lists: ['avoidKeywords', 'dealbreakers'],
    texts: ['notes'],
  },
};

export function formatByteSize(bytes) {
  const n = Number(bytes);
  const size = Number.isFinite(n) && n > 0 ? n : 0;
  const mb = size / (1024 * 1024);
  if (mb >= 1) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  const kb = size / 1024;
  if (kb >= 1) return `${(Math.round(kb * 10) / 10).toFixed(1)} KB`;
  return `${Math.round(size)} B`;
}

export function assertFilesWithinLimit(files) {
  const list = Array.from(files || []);
  const oversized = list.filter((file) => Number(file?.size) > MAX_PROFILE_IMPORT_BYTES);
  if (!oversized.length) return list;
  const detail = oversized
    .map((file) => `「${file.name || '未命名文件'}」有 ${formatByteSize(file.size)}`)
    .join('，');
  throw new Error(`${detail}，超过 10 MB，已拒绝导入`);
}

function fileKind(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.doc')) return 'binary';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.json')) return 'json';
  return 'other';
}

export function planResumeFiles(files) {
  const list = assertFilesWithinLimit(files);
  if (!list.length) return { kind: 'empty', files: [] };
  const kinds = list.map((file) => fileKind(file.name));
  if (kinds.includes('json')) throw new Error('画像 JSON 请单独导入');
  if (kinds.includes('other')) {
    const file = list[kinds.indexOf('other')];
    throw new Error(`「${file.name || '未命名文件'}」不是支持的简历文件，请使用 PDF、DOCX、MD 或 TXT`);
  }
  if (kinds.includes('binary') && list.length !== 1) throw new Error('PDF 或 DOCX 请单独导入');
  if (kinds[0] === 'binary') return { kind: 'resume', files: list };
  return { kind: 'materials', files: list };
}

export function planJsonFile(files) {
  const list = assertFilesWithinLimit(files);
  if (!list.length) return null;
  if (list.length !== 1 || fileKind(list[0].name) !== 'json') {
    if (list.length === 1) throw new Error(`「${list[0].name || '未命名文件'}」不是画像 JSON，请单独导入一个 JSON 文件`);
    throw new Error('画像 JSON 请单独导入');
  }
  return list[0];
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isListLike(value) {
  return Array.isArray(value) || typeof value === 'string';
}

function isTextLike(value) {
  return value == null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function numberIssue(path, value, { positive = false } = {}) {
  if (value == null) return '';
  if (typeof value === 'string' && !value.trim()) return '';
  const numeric = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value.trim()) : NaN);
  if (!Number.isFinite(numeric)) return `${path} 不是有效数字`;
  if (positive && numeric <= 0) return `${path} 需要大于 0`;
  if (!positive && numeric < 0) return `${path} 不能为负数`;
  return '';
}

export function parseProfileJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('画像 JSON 无法解析，请检查格式');
  }
  if (!isPlainObject(data)) throw new Error('不是有效的画像 JSON：根节点必须是对象');
  if (!PROFILE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(data, key))) {
    throw new Error('不是有效的画像 JSON：缺少 target、basics、capabilities 等画像字段');
  }
  const errors = [];
  for (const key of Object.keys(NESTED)) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    if (!isPlainObject(data[key])) {
      errors.push(`${key} 应为对象`);
      continue;
    }
    const spec = NESTED[key];
    for (const field of spec.lists || []) {
      if (field in data[key] && !isListLike(data[key][field])) errors.push(`${key}.${field} 应为列表或文本`);
    }
    for (const field of spec.texts || []) {
      if (field in data[key] && !isTextLike(data[key][field])) errors.push(`${key}.${field} 应为文本`);
    }
    for (const field of spec.numbers || []) {
      const issue = numberIssue(`${key}.${field}`, data[key][field], { positive: (spec.positive || []).includes(field) });
      if (issue) errors.push(issue);
    }
  }
  if ('workSummary' in data && !isTextLike(data.workSummary)) errors.push('workSummary 应为文本');
  if ('projectSummary' in data && !isTextLike(data.projectSummary)) errors.push('projectSummary 应为文本');
  if ('highlights' in data && !isListLike(data.highlights)) errors.push('highlights 应为列表或文本');
  if (errors.length) throw new Error(`画像字段校验失败：${errors.join('；')}`);
  return data;
}

export function assertNonEmptyText(name, text) {
  if (!String(text || '').trim()) throw new Error(`「${name || '未命名文件'}」是空文件，请检查后重新选择`);
}

export async function combineMaterialExtracts(items, extract) {
  let combined = emptyProfile();
  for (const item of items) {
    const text = String(item.text || '');
    assertNonEmptyText(item.name, text);
    for (let offset = 0; offset < text.length; offset += MATERIAL_CHUNK_CHARS) {
      const part = text.slice(offset, offset + MATERIAL_CHUNK_CHARS);
      const extracted = sanitizeProfile(await extract(`材料：${item.name}\n${part}`));
      const previous = combined;
      combined = mergeDraft(previous, extracted);
      for (const key of ['workSummary', 'projectSummary']) {
        if (previous[key] && extracted[key] && !previous[key].includes(extracted[key])) {
          combined[key] = `${previous[key]}\n${extracted[key]}`;
        }
      }
    }
  }
  return combined;
}

// 草稿确认：数组去重、空字段补全；工作概述、项目概述和备注保留原内容并追加新内容。
export function applyProfileDraft(current, draft, replace) {
  if (replace) return draft;
  const previous = sanitizeProfile(current);
  const next = mergeDraft(previous, draft);
  const append = (oldText, newText) => (!newText || oldText.includes(newText) ? oldText : oldText ? `${oldText}\n\n${newText}` : newText);
  next.workSummary = append(previous.workSummary, draft?.workSummary);
  next.projectSummary = append(previous.projectSummary, draft?.projectSummary);
  next.preference.notes = append(previous.preference.notes, draft?.preference?.notes);
  return next;
}
