// 设置与 AI 供应商列表的 storage 读写。
import { STORAGE_KEYS, defaultSettings, defaultFilters, MODE } from './constants.js';
import { sanitizeProviderList } from './ai/providers.js';
import { pickActiveProvider } from './profileFingerprint.js';
import { normalizeUpdateChannel } from './update.js';
import type { AIProvider, Mode, Settings } from './types.js';

const SET_KEY = STORAGE_KEYS.settings;
const PROV_KEY = STORAGE_KEYS.aiProviders;

export type SettingsPatch = Partial<Omit<Settings, 'filters' | 'privacy'>> & {
  filters?: Partial<Settings['filters']>;
  privacy?: Partial<Settings['privacy']>;
};

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SET_KEY);
  return mergeSettings(got[SET_KEY]);
}

export async function saveSettings(patch: SettingsPatch = {}): Promise<Settings> {
  const cur = await loadSettings();
  const next = mergeSettings({
    ...cur,
    ...patch,
    filters: { ...cur.filters, ...(patch && patch.filters) },
    privacy: { ...cur.privacy, ...(patch && patch.privacy) },
  });
  await chrome.storage.local.set({ [SET_KEY]: next });
  return next;
}

export function mergeSettings(input: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(input)) return d;
  const src = input as Record<string, unknown>;
  // 存储里的历史数据形状不受类型约束，逐字段归一后落回 Settings。
  return {
    ...d,
    ...src,
    // 归一运行模式：已移除的平台（如旧的 qcwy）落回 auto，存储键与结构不变。
    mode: (Object.values(MODE) as string[]).includes(String(src.mode)) ? (src.mode as Mode) : d.mode,
    privacy: { ...d.privacy, ...(isObj(src.privacy) ? src.privacy : {}) },
    filters: { ...defaultFilters(), ...(isObj(src.filters) ? src.filters : {}) },
    updateChannel: normalizeUpdateChannel(src.updateChannel),
  } as Settings;
}

export async function loadProviders(): Promise<AIProvider[]> {
  const got = await chrome.storage.local.get(PROV_KEY);
  return sanitizeProviderList(got[PROV_KEY]);
}

export async function saveProviders(list: unknown): Promise<AIProvider[]> {
  const clean = sanitizeProviderList(list);
  await chrome.storage.local.set({ [PROV_KEY]: clean });
  return clean;
}

// 取当前启用的供应商（settings.activeProviderId 指向；否则取第一个可用）
export async function getActiveProvider(): Promise<AIProvider | null> {
  const [settings, providers] = await Promise.all([loadSettings(), loadProviders()]);
  return pickActiveProvider(providers, settings.activeProviderId);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
