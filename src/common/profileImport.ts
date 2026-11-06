// 画像导入：体积限制、JSON 字段校验、多材料分段合并。
// 不改画像存储结构；合并规则与设置页原实现一致。
import { emptyProfile, mergeDraft, sanitizeProfile } from './profile.js';
import type { Profile } from './types.js';

export const MAX_PROFILE_IMPORT_BYTES = 10 * 1024 * 1024;
export const MATERIAL_CHUNK_CHARS = 10000;

const PROFILE_KEYS = ['target', 'basics', 'capabilities', 'workSummary', 'projectSummary', 'highlights', 'preference'];

interface NestedSpec {
  lists?: readonly string[];
  texts?: readonly string[];
  numbers?: readonly string[];
  positive?: readonly string[];
}

const NESTED: Record<string, NestedSpec> = {
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

/** 只依赖 name / size，浏览器 File 与测试里的普通对象都满足。 */
export interface FileLike {
  name?: string;
  size?: number;
}

export type FileCollection = FileList | readonly FileLike[] | null | undefined;

function toFileList(files: FileCollection): FileLike[] {
  if (!files) return [];
  return Array.isArray(files) ? [...(files as readonly FileLike[])] : Array.from(files as ArrayLike<FileLike>);
}

export function formatByteSize(bytes: unknown): string {
  const n = Number(bytes);
  const size = Number.isFinite(n) && n > 0 ? n : 0;
  const mb = size / (1024 * 1024);
  if (mb >= 1) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  const kb = size / 1024;
  if (kb >= 1) return `${(Math.round(kb * 10) / 10).toFixed(1)} KB`;
  return `${Math.round(size)} B`;
}

export function assertFilesWithinLimit(files: FileCollection): FileLike[] {
  const list = toFileList(files);
  const oversized = list.filter((file) => Number(file?.size) > MAX_PROFILE_IMPORT_BYTES);
  if (!oversized.length) return list;
  const detail = oversized
    .map((file) => `「${file.name || '未命名文件'}」有 ${formatByteSize(file.size)}`)
    .join('，');
  throw new Error(`${detail}，超过 10 MB，已拒绝导入`);
}

function fileKind(name: unknown): 'binary' | 'text' | 'json' | 'other' {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.doc')) return 'binary';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.json')) return 'json';
  return 'other';
}

export type ResumePlanKind = 'empty' | 'resume' | 'materials';

export interface ResumePlan {
  kind: ResumePlanKind;
  files: FileLike[];
}

export function planResumeFiles(files: FileCollection): ResumePlan {
  const list = assertFilesWithinLimit(files);
  if (!list.length) return { kind: 'empty', files: [] };
  const kinds = list.map((file) => fileKind(file.name));
  if (kinds.includes('json')) throw new Error('画像 JSON 请单独导入');
  if (kinds.includes('other')) {
    const file = list[kinds.indexOf('other')];
    throw new Error(`「${file?.name || '未命名文件'}」不是支持的简历文件，请使用 PDF、DOCX、MD 或 TXT`);
  }
  if (kinds.includes('binary') && list.length !== 1) throw new Error('PDF 或 DOCX 请单独导入');
  if (kinds[0] === 'binary') return { kind: 'resume', files: list };
  return { kind: 'materials', files: list };
}

export function planJsonFile(files: FileCollection): FileLike | null {
  const list = assertFilesWithinLimit(files);
  if (!list.length) return null;
  const [first] = list;
  if (list.length !== 1 || !first || fileKind(first.name) !== 'json') {
    if (list.length === 1) throw new Error(`「${first?.name || '未命名文件'}」不是画像 JSON，请单独导入一个 JSON 文件`);
    throw new Error('画像 JSON 请单独导入');
  }
  return first;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isListLike(value: unknown): boolean {
  return Array.isArray(value) || typeof value === 'string';
}

function isTextLike(value: unknown): boolean {
  return value == null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function numberIssue(path: string, value: unknown, { positive = false }: { positive?: boolean } = {}): string {
  if (value == null) return '';
  if (typeof value === 'string' && !value.trim()) return '';
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric)) return `${path} 不是有效数字`;
  if (positive && numeric <= 0) return `${path} 需要大于 0`;
  if (!positive && numeric < 0) return `${path} 不能为负数`;
  return '';
}

export function parseProfileJson(text: unknown): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(String(text));
  } catch {
    throw new Error('画像 JSON 无法解析，请检查格式');
  }
  if (!isPlainObject(data)) throw new Error('不是有效的画像 JSON：根节点必须是对象');
  if (!PROFILE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(data, key))) {
    throw new Error('不是有效的画像 JSON：缺少 target、basics、capabilities 等画像字段');
  }
  const errors: string[] = [];
  for (const key of Object.keys(NESTED)) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const group = data[key];
    if (!isPlainObject(group)) {
      errors.push(`${key} 应为对象`);
      continue;
    }
    const spec = NESTED[key];
    if (!spec) continue;
    for (const field of spec.lists || []) {
      if (field in group && !isListLike(group[field])) errors.push(`${key}.${field} 应为列表或文本`);
    }
    for (const field of spec.texts || []) {
      if (field in group && !isTextLike(group[field])) errors.push(`${key}.${field} 应为文本`);
    }
    for (const field of spec.numbers || []) {
      const issue = numberIssue(`${key}.${field}`, group[field], { positive: (spec.positive || []).includes(field) });
      if (issue) errors.push(issue);
    }
  }
  if ('workSummary' in data && !isTextLike(data.workSummary)) errors.push('workSummary 应为文本');
  if ('projectSummary' in data && !isTextLike(data.projectSummary)) errors.push('projectSummary 应为文本');
  if ('highlights' in data && !isListLike(data.highlights)) errors.push('highlights 应为列表或文本');
  if (errors.length) throw new Error(`画像字段校验失败：${errors.join('；')}`);
  return data;
}

export function assertNonEmptyText(name: unknown, text: unknown): void {
  if (!String(text || '').trim()) throw new Error(`「${name || '未命名文件'}」是空文件，请检查后重新选择`);
}

export interface MaterialItem {
  name?: string;
  text?: string;
}

export async function combineMaterialExtracts(
  items: readonly MaterialItem[],
  extract: (prompt: string) => unknown,
): Promise<Profile> {
  let combined = emptyProfile();
  for (const item of items) {
    const text = String(item.text || '');
    assertNonEmptyText(item.name, text);
    for (let offset = 0; offset < text.length; offset += MATERIAL_CHUNK_CHARS) {
      const part = text.slice(offset, offset + MATERIAL_CHUNK_CHARS);
      const extracted = sanitizeProfile(await extract(`材料：${item.name}\n${part}`));
      const previous = combined;
      combined = mergeDraft(previous, extracted);
      for (const key of ['workSummary', 'projectSummary'] as const) {
        if (previous[key] && extracted[key] && !previous[key].includes(extracted[key])) {
          combined[key] = `${previous[key]}\n${extracted[key]}`;
        }
      }
    }
  }
  return combined;
}

// 草稿确认：数组去重、空字段补全；工作概述、项目概述和备注保留原内容并追加新内容。
export function applyProfileDraft(current: unknown, draft: unknown, replace: unknown): Profile {
  // 覆盖导入：保留调用方传入的对象（测试按引用比较，且上游已清洗）。
  if (replace) return draft as Profile;
  const previous = sanitizeProfile(current);
  const incoming = sanitizeProfile(draft);
  const next = mergeDraft(previous, draft);
  const append = (oldText: string, newText: string) =>
    !newText || oldText.includes(newText) ? oldText : oldText ? `${oldText}\n\n${newText}` : newText;
  next.workSummary = append(previous.workSummary, incoming.workSummary);
  next.projectSummary = append(previous.projectSummary, incoming.projectSummary);
  next.preference.notes = append(previous.preference.notes, incoming.preference.notes);
  return next;
}
