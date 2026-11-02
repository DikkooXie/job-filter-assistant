// AI 接口页的纯状态。存储字段仍由 sanitizeProvider 决定，这里只处理界面上的选择、删除和展示。

import { PROTOCOL_LABELS } from '../../common/ai/providers.js';

export const PROTOCOL_SHORT_LABELS = {
  'openai-chat': 'OpenAI 兼容',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export function protocolShortLabel(protocol) {
  return PROTOCOL_SHORT_LABELS[protocol] || PROTOCOL_LABELS[protocol] || protocol || '未知协议';
}

export function providerHost(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) return '未填写地址';
  try {
    return new URL(value).host || '未填写地址';
  } catch {
    const stripped = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];
    return stripped || '未填写地址';
  }
}

export function providerMeta(provider) {
  const protocol = protocolShortLabel(provider && provider.protocol);
  const model = String((provider && provider.model) || '').trim() || '未填模型';
  const host = providerHost(provider && provider.baseUrl);
  return { protocol, model, host, text: `${protocol} · ${model} · ${host}` };
}

export function initialSelectedId(providers, activeProviderId, currentId = '') {
  const list = Array.isArray(providers) ? providers : [];
  if (currentId && list.some((provider) => provider.id === currentId)) return currentId;
  if (activeProviderId && list.some((provider) => provider.id === activeProviderId)) return activeProviderId;
  return list[0]?.id || '';
}

// 删除一个接口后的列表、正在使用和当前编辑。正在使用被删掉时落到剩余第一个，没有剩余则清空。
export function removeProviderState({ providers, activeProviderId, selectedId, removedId }) {
  const list = Array.isArray(providers) ? providers : [];
  const nextProviders = list.filter((provider) => provider && provider.id !== removedId);
  const nextActive = activeProviderId === removedId ? (nextProviders[0]?.id || '') : (activeProviderId || '');
  let nextSelected = selectedId || '';
  if (!nextProviders.some((provider) => provider.id === nextSelected)) {
    const activeRemains = nextActive && nextProviders.some((provider) => provider.id === nextActive);
    nextSelected = (activeRemains ? nextActive : nextProviders[0]?.id) || '';
  }
  return { providers: nextProviders, activeProviderId: nextActive, selectedId: nextSelected };
}

export function parseExtraHeaders(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: true, headers: {} };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: '请输入有效的 JSON 对象' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '请输入有效的 JSON 对象' };
  }
  const headers = {};
  for (const [key, item] of Object.entries(value)) {
    const name = String(key).trim();
    if (!name) continue;
    if (item != null && typeof item === 'object') return { ok: false, error: '请输入有效的 JSON 对象' };
    headers[name] = item == null ? '' : String(item).trim();
  }
  return { ok: true, headers };
}

// 耗时只接受界面自己量到的毫秒，不读取接口响应里的字段。
export function formatElapsed(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 100) {
    const text = (n / 1000).toFixed(2);
    return text === '0.00' && n > 0 ? '<0.01 秒' : `${text} 秒`;
  }
  const tenths = Math.round(n / 100);
  if (tenths < 100) return `${(tenths / 10).toFixed(1)} 秒`;
  return `${Math.round(n / 1000)} 秒`;
}

export function formatConnectionResult({ ok, message, sample, elapsedMs } = {}) {
  const time = formatElapsed(elapsedMs);
  const timing = time ? ` · ${time}` : '';
  if (ok) {
    const reply = typeof sample === 'string' ? sample.trim() : '';
    return { ok: true, text: `连接正常${timing}`, detail: reply ? `模型回复：${reply}` : '' };
  }
  return { ok: false, text: `连接失败${timing}`, detail: typeof message === 'string' ? message : '' };
}

export function formatModelsResult({ count, elapsedMs, error } = {}) {
  const time = formatElapsed(elapsedMs);
  const timing = time ? ` · ${time}` : '';
  if (error) {
    return {
      ok: false,
      text: `拉取失败${timing}`,
      detail: `${error}（部分供应商不支持列模型，可手动填写模型 ID）`,
    };
  }
  return { ok: true, text: `已拉取 ${Number(count) || 0} 个模型${timing}`, detail: '' };
}
