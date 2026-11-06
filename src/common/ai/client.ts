// 多协议 AI 客户端：把统一的「消息 + 参数」翻译成各协议的 HTTP 请求，
// 并把各协议响应解析回纯文本 / JSON。运行在 background（有跨域权限）。
import { sanitizeProvider } from './providers.js';
import type { AIProvider, Protocol } from '../types.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  /** 作为 system 消息前置（与 messages 内已有的 system 合并）。 */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** 期望模型返回 JSON。 */
  json?: boolean;
  signal?: AbortSignal;
}

export interface RequestSpec {
  url: string;
  init: RequestInit;
}

export interface TestProviderResult {
  ok: boolean;
  message: string;
  sample?: string;
}

export class AiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

// 统一入口：给定 provider + prompt，返回模型文本。
// opts: { system, temperature, maxTokens, json(bool 期望 JSON), signal }
export async function chat(providerInput: unknown, prompt: string | ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const p = sanitizeProvider(providerInput);
  const base: ChatMessage[] = Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }];
  // 支持文档化的 opts.system：作为 system 消息前置（与 messages 内已有的 system 合并）
  const messages: ChatMessage[] = opts.system ? [{ role: 'system', content: String(opts.system) }, ...base] : base;
  const req = buildRequest(p, messages, opts);
  const res = await doFetch(req.url, req.init, opts.signal);
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new AiError(errMessage(p, data, res.status), res.status);
  return extractText(p.protocol, data);
}

// 期望 JSON：调用 chat 后解析出对象（带 ```json 围栏容错）
export async function chatJson(providerInput: unknown, prompt: string | ChatMessage[], opts: ChatOptions = {}): Promise<unknown> {
  const text = await chat(providerInput, prompt, { ...opts, json: true });
  return parseModelJson(text);
}

// 连通性测试：最小请求，返回 {ok, message, sample}
export async function testProvider(providerInput: unknown, opts: { signal?: AbortSignal } = {}): Promise<TestProviderResult> {
  try {
    const text = await chat(providerInput, [{ role: 'user', content: '请只回复两个字：正常' }], {
      maxTokens: 16,
      temperature: 0,
      signal: opts.signal,
    });
    return { ok: true, message: '连接成功', sample: (text || '').slice(0, 40) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// 拉取模型列表（协议相关）。返回 string[] 模型 id。
export async function listModels(providerInput: unknown, opts: { signal?: AbortSignal } = {}): Promise<string[]> {
  const p = sanitizeProvider(providerInput);
  const { url, init } = buildModelsRequest(p);
  const res = await doFetch(url, init, opts.signal);
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new AiError(errMessage(p, data, res.status), res.status);
  return extractModelList(p.protocol, data);
}

// ============ 请求构造 ============
function buildRequest(p: AIProvider, messages: ChatMessage[], opts: ChatOptions): RequestSpec {
  const temperature = opts.temperature ?? p.temperature ?? 0.3;
  const maxTokens = opts.maxTokens ?? p.maxTokens ?? 2048;
  const wantJson = !!opts.json;
  const { system, chatMsgs } = splitSystem(messages);
  const extraHeaders = p.extraHeaders || {};

  if (p.protocol === 'anthropic') {
    return {
      url: reqUrl(p, 'messages'),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': p.apiKey,
          'anthropic-version': p.anthropicVersion || '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...extraHeaders,
        },
        body: JSON.stringify({
          model: p.model,
          system: system || undefined,
          messages: chatMsgs.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          temperature,
          max_tokens: maxTokens,
        }),
      },
    };
  }

  if (p.protocol === 'gemini') {
    // key 走 query，system 用 systemInstruction
    const base = reqUrl(p, `models/${encodeURIComponent(p.model)}:generateContent`);
    const url = p.apiKey ? `${base}?key=${encodeURIComponent(p.apiKey)}` : base;
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: chatMsgs.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: wantJson ? 'application/json' : undefined,
          },
        }),
      },
    };
  }

  if (p.protocol === 'openai-responses') {
    return {
      url: reqUrl(p, 'responses'),
      init: {
        method: 'POST',
        headers: authHeaders(p),
        body: JSON.stringify({
          model: p.model,
          instructions: system || undefined,
          input: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
          temperature,
          max_output_tokens: maxTokens,
          text: wantJson ? { format: { type: 'json_object' } } : undefined,
        }),
      },
    };
  }

  // 默认 openai-chat
  return {
    url: reqUrl(p, 'chat/completions'),
    init: {
      method: 'POST',
      headers: authHeaders(p),
      body: JSON.stringify({
        model: p.model,
        messages: system ? [{ role: 'system', content: system }, ...chatMsgs] : chatMsgs,
        temperature,
        max_tokens: maxTokens,
        response_format: wantJson ? { type: 'json_object' } : undefined,
      }),
    },
  };
}

function buildModelsRequest(p: AIProvider): RequestSpec {
  const extraHeaders = p.extraHeaders || {};
  if (p.modelsUrl) return { url: p.modelsUrl, init: { method: 'GET', headers: authHeaders(p, true) } };
  if (p.protocol === 'gemini') {
    const base = joinUrl(p.baseUrl, 'models');
    return { url: p.apiKey ? `${base}?key=${encodeURIComponent(p.apiKey)}` : base, init: { method: 'GET' } };
  }
  if (p.protocol === 'anthropic') {
    return {
      url: joinUrl(p.baseUrl, 'models'),
      init: {
        method: 'GET',
        headers: {
          'x-api-key': p.apiKey,
          'anthropic-version': p.anthropicVersion || '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...extraHeaders,
        },
      },
    };
  }
  // openai 系
  return { url: joinUrl(p.baseUrl, 'models'), init: { method: 'GET', headers: authHeaders(p, true) } };
}

function authHeaders(p: AIProvider, getOnly = false): Record<string, string> {
  const h: Record<string, string> = { ...(p.extraHeaders || {}) };
  if (!getOnly) h['content-type'] = 'application/json';
  if (p.apiKey) h['authorization'] = `Bearer ${p.apiKey}`;
  return h;
}

// baseUrl + endpoint 拼接；requestUrl 非空则直接用
function reqUrl(p: AIProvider, endpoint: string): string {
  if (p.requestUrl) return p.requestUrl;
  return joinUrl(p.baseUrl, endpoint);
}
function joinUrl(base: string, path: string): string {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function splitSystem(messages: ChatMessage[]): { system: string; chatMsgs: ChatMessage[] } {
  let system = '';
  const chatMsgs: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n' : '') + m.content;
    else chatMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
  }
  if (chatMsgs.length === 0) chatMsgs.push({ role: 'user', content: system || '你好' });
  return { system, chatMsgs };
}

// ============ 响应解析 ============
function textOf(item: unknown): string {
  return isObj(item) && typeof item.text === 'string' ? item.text : '';
}

function extractText(protocol: Protocol, data: unknown): string {
  if (!isObj(data)) return '';
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.map(textOf).join('').trim();
  }
  if (protocol === 'gemini') {
    const cand = Array.isArray(data.candidates) ? data.candidates[0] : null;
    const content: Record<string, unknown> = isObj(cand) && isObj(cand.content) ? cand.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    return parts.map(textOf).join('').trim();
  }
  if (protocol === 'openai-responses') {
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    const out = Array.isArray(data.output) ? data.output : [];
    return out
      .flatMap((o) => (isObj(o) && Array.isArray(o.content) ? o.content : []))
      .map(textOf)
      .join('')
      .trim();
  }
  // openai-chat
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  const msg: Record<string, unknown> = isObj(first) && isObj(first.message) ? first.message : {};
  if (typeof msg.content === 'string') return msg.content.trim();
  // 少数网关返回 content 数组
  if (Array.isArray(msg.content)) {
    return msg.content.map(textOf).join('').trim();
  }
  return '';
}

function extractModelList(protocol: Protocol, data: unknown): string[] {
  if (!isObj(data)) return [];
  let raw: unknown[] = [];
  if (protocol === 'gemini') raw = Array.isArray(data.models) ? data.models : [];
  else raw = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const ids = raw
    .map((m) => {
      if (typeof m === 'string') return m;
      if (!isObj(m)) return '';
      // gemini 的 name 形如 "models/gemini-1.5-flash"
      const id = m.id || m.name || m.model || '';
      return typeof id === 'string' ? id.replace(/^models\//, '') : '';
    })
    .filter(Boolean) as string[];
  return Array.from(new Set(ids)).sort();
}

// ============ JSON 解析容错 ============
export function parseModelJson(text: unknown): unknown {
  const t = String(text || '').trim();
  if (!t) throw new Error('模型返回为空');
  // 去掉 ```json 围栏
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? (fenced[1] ?? t) : t;
  try {
    return JSON.parse(body);
  } catch {
    // 截取第一个 { 到最后一个 }
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(body.slice(first, last + 1));
    }
    throw new Error('无法解析模型返回的 JSON');
  }
}

// ============ 底层 ============
async function doFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new AiError(`网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}
function errMessage(p: AIProvider, data: unknown, status: number): string {
  let detail: unknown = '';
  if (isObj(data)) {
    const error = data.error;
    const fromError = isObj(error) ? error.message || error.type || '' : '';
    detail =
      fromError ||
      data.message ||
      (isObj(error) ? JSON.stringify(error) : '') ||
      (typeof data.__raw === 'string' ? data.__raw.slice(0, 300) : '');
  }
  const text = typeof detail === 'string' ? detail : detail ? String(detail) : '';
  const hint = status === 401 || status === 403 ? '（请检查 API Key 与权限）' : '';
  return `请求失败 ${status || ''}${text ? '：' + text : ''}${hint}`;
}
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
