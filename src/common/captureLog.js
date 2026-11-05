// 补抓和嗅探失败的原因。只记种类、原因和岗位标识，不记 JD 正文、令牌或完整 URL。
// 存储键沿用 STORAGE_KEYS.lastReport，不改已有岗位库的字段。
import { STORAGE_KEYS } from './constants.js';

export const CAPTURE_LOG_LIMIT = 100;

const ENTRY_FIELDS = ['at', 'kind', 'reason', 'uid', 'action', 'scrape', 'code', 'api', 'hint', 'bodyKey'];

export function emptyCaptureLog() {
  return { version: 1, entries: [] };
}

export function sanitizeCaptureEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const out = {};
  for (const key of ENTRY_FIELDS) {
    const raw = entry[key];
    if (raw == null || raw === '') continue;
    const text = String(raw).replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    if (!text) continue;
    out[key] = text;
  }
  if (!out.kind) return null;
  return out;
}

export function normalizeCaptureLog(raw) {
  const entries = raw && typeof raw === 'object' && Array.isArray(raw.entries) ? raw.entries : [];
  const clean = [];
  for (const entry of entries) {
    const next = sanitizeCaptureEntry(entry);
    if (next) clean.push(next);
  }
  return { version: 1, entries: clean.slice(-CAPTURE_LOG_LIMIT) };
}

export function appendCaptureEntry(log, entry, limit = CAPTURE_LOG_LIMIT) {
  const base = normalizeCaptureLog(log);
  const clean = sanitizeCaptureEntry(entry);
  if (!clean) return base;
  const cap = Number(limit) > 0 ? Number(limit) : CAPTURE_LOG_LIMIT;
  return { version: 1, entries: base.entries.concat(clean).slice(-cap) };
}

export function captureLogJson(log) {
  return JSON.stringify(normalizeCaptureLog(log), null, 2);
}

// 只留接口种类。查询串里的 securityId 不进日志。
export function captureApiKind(url) {
  let path = '';
  try {
    path = new URL(String(url || ''), 'https://x').pathname;
  } catch {
    path = String(url || '').split('?')[0];
  }
  if (/\/job\/card\.json/.test(path)) return 'card';
  if (/\/job\/detail/.test(path)) return 'detail';
  if (/joblist|\/job\/list|search-(pc|h5)/.test(path)) return 'list';
  return 'other';
}

// BOSS 信封 code 不是 0，或根本不是 JSON 对象。不返回 message / zpData。
export function classifyBossDrop(platform, payload) {
  if (platform !== 'boss') return null;
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { reason: 'non-json' };
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'code')) return null;
  if (payload.code === 0 || payload.code === '0') return null;
  const code = String(payload.code).replace(/[\r\n]+/g, ' ').trim().slice(0, 16);
  return { reason: 'code', code: code || 'invalid' };
}

export function ensureLogEntry(uid, result = {}) {
  return sanitizeCaptureEntry({
    kind: 'ensure',
    uid,
    action: result.action || '',
    scrape: result.scrape || '',
    reason: result.reason || '',
  });
}

let captureWrite = Promise.resolve();

function withCaptureWrite(task) {
  const run = captureWrite.then(task, task);
  captureWrite = run.then(() => {}, () => {});
  return run;
}

export async function loadCaptureLog() {
  const got = await chrome.storage.local.get(STORAGE_KEYS.lastReport);
  return normalizeCaptureLog(got[STORAGE_KEYS.lastReport]);
}

export async function appendCaptureLog(entry) {
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
