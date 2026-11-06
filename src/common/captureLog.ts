// 补抓和嗅探失败的原因。只记种类、原因和岗位标识，不记 JD 正文、令牌或完整 URL。
// 存储键沿用 STORAGE_KEYS.lastReport，不改已有岗位库的字段。
import { STORAGE_KEYS } from './constants.js';

export const CAPTURE_LOG_LIMIT = 100;

const ENTRY_FIELDS = ['at', 'kind', 'reason', 'uid', 'action', 'scrape', 'code', 'api', 'hint', 'bodyKey'] as const;

type CaptureField = (typeof ENTRY_FIELDS)[number];

export interface CaptureLogEntry extends Partial<Record<CaptureField, string>> {
  kind: string;
}

export interface CaptureLog {
  version: number;
  entries: CaptureLogEntry[];
}

export function emptyCaptureLog(): CaptureLog {
  return { version: 1, entries: [] };
}

export function sanitizeCaptureEntry(entry: unknown): CaptureLogEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Record<string, unknown>;
  const out: Partial<Record<CaptureField, string>> = {};
  for (const key of ENTRY_FIELDS) {
    const raw = source[key];
    if (raw == null || raw === '') continue;
    const text = String(raw)
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!text) continue;
    out[key] = text;
  }
  if (!out.kind) return null;
  return out as CaptureLogEntry;
}

export function normalizeCaptureLog(raw: unknown): CaptureLog {
  const source = raw && typeof raw === 'object' ? (raw as { entries?: unknown }) : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const clean: CaptureLogEntry[] = [];
  for (const entry of entries) {
    const next = sanitizeCaptureEntry(entry);
    if (next) clean.push(next);
  }
  return { version: 1, entries: clean.slice(-CAPTURE_LOG_LIMIT) };
}

export function appendCaptureEntry(log: unknown, entry: unknown, limit = CAPTURE_LOG_LIMIT): CaptureLog {
  const base = normalizeCaptureLog(log);
  const clean = sanitizeCaptureEntry(entry);
  if (!clean) return base;
  const cap = Number(limit) > 0 ? Number(limit) : CAPTURE_LOG_LIMIT;
  return { version: 1, entries: base.entries.concat(clean).slice(-cap) };
}

export function captureLogJson(log: unknown): string {
  return JSON.stringify(normalizeCaptureLog(log), null, 2);
}

// 只留接口种类。查询串里的 securityId 不进日志。
export function captureApiKind(url: unknown): string {
  let path = '';
  try {
    path = new URL(String(url || ''), 'https://x').pathname;
  } catch {
    path = String(url || '').split('?')[0] || '';
  }
  if (/\/job\/card\.json/.test(path)) return 'card';
  if (/\/job\/detail/.test(path)) return 'detail';
  if (/joblist|\/job\/list|search-(pc|h5)/.test(path)) return 'list';
  return 'other';
}

// BOSS 信封 code 不是 0，或根本不是 JSON 对象。不返回 message / zpData。
export function classifyBossDrop(
  platform: string,
  payload: unknown,
): { reason: string; code?: string } | null {
  if (platform !== 'boss') return null;
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { reason: 'non-json' };
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'code')) return null;
  const codeValue = (payload as { code?: unknown }).code;
  if (codeValue === 0 || codeValue === '0') return null;
  const code = String(codeValue)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 16);
  return { reason: 'code', code: code || 'invalid' };
}

export function ensureLogEntry(uid: unknown, result: Record<string, unknown> = {}): CaptureLogEntry | null {
  return sanitizeCaptureEntry({
    kind: 'ensure',
    uid,
    action: result.action || '',
    scrape: result.scrape || '',
    reason: result.reason || '',
  });
}

let captureWrite: Promise<unknown> = Promise.resolve();

function withCaptureWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = captureWrite.then(task, task);
  captureWrite = run.then(
    () => {},
    () => {},
  );
  return run;
}

export async function loadCaptureLog(): Promise<CaptureLog> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.lastReport);
  return normalizeCaptureLog(got[STORAGE_KEYS.lastReport]);
}

export async function appendCaptureLog(entry: Record<string, unknown>): Promise<CaptureLog> {
  return withCaptureWrite(async () => {
    const current = await loadCaptureLog();
    const next = appendCaptureEntry(current, {
      ...entry,
      at: entry && entry.at ? entry.at : new Date().toISOString(),
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.lastReport]: next });
    return next;
  });
}
