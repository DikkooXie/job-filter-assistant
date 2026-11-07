// AI 供应商、提示词、匹配规整与隐私脱敏

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { validateProvider, providerFromPreset, isProviderUsable, PRESETS, PROTOCOLS } from '../../src/common/ai/providers.js';
import {
  formatConnectionResult, formatElapsed, formatModelsResult, initialSelectedId, parseExtraHeaders, providerHost, providerMeta, removeProviderState,
} from '../../src/pages/options/aiState.js';
import { sanitizeMatch, scoreToVerdict, normalizeGreetings, normalizeDims, sanitizeTailor } from '../../src/common/ai/prompts.js';
import { redactText } from '../../src/common/ai/privacy.js';
import { test, section, ROOT } from './harness.js';

section('AI 供应商配置');
test('预设创建 OpenAI', () => {
  const p = providerFromPreset('openai');
  assert.equal(p.protocol, 'openai-chat');
  assert.ok(p.baseUrl.includes('openai.com'));
});
test('anthropic 预设带 version', () => {
  const p = providerFromPreset('anthropic');
  assert.equal(p.protocol, 'anthropic');
  assert.equal(p.anthropicVersion, '2023-06-01');
});
test('校验：缺 model 报错', () => {
  const v = validateProvider({ name: 'x', baseUrl: 'https://api.x.com', model: '' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('模型')));
});
test('校验：http 非 localhost 报错', () => {
  const v = validateProvider({ name: 'x', baseUrl: 'http://api.x.com', model: 'm' });
  assert.equal(v.ok, false);
});
test('校验：localhost http 放行', () => {
  const v = validateProvider({ name: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' });
  assert.equal(v.ok, true);
});
test('本地模型无需 key 即可用', () => {
  assert.equal(isProviderUsable({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', apiKey: '' }), true);
});
test('远程模型缺 key 不可用', () => {
  assert.equal(isProviderUsable({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '' }), false);
});
test('四种协议和全部预设都能生成接口', () => {
  assert.deepEqual(PROTOCOLS, ['openai-chat', 'openai-responses', 'anthropic', 'gemini']);
  assert.ok(PRESETS.length >= 4);
  for (const preset of PRESETS) {
    const provider = providerFromPreset(preset.key);
    assert.equal(provider.protocol, preset.protocol);
    assert.ok(PROTOCOLS.includes(provider.protocol));
    assert.equal(provider.name, preset.name);
    assert.equal(provider.apiKey, '');
    assert.ok(provider.id.startsWith('prov-'));
  }
});

// ---------- AI 接口页状态 ----------
section('AI 接口页状态');
test('删除正在使用的接口时落到剩余第一个', () => {
  const providers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const next = removeProviderState({ providers, activeProviderId: 'b', selectedId: 'b', removedId: 'b' });
  assert.deepEqual(next.providers.map((item) => item.id), ['a', 'c']);
  assert.equal(next.activeProviderId, 'a');
  assert.equal(next.selectedId, 'a');
  assert.deepEqual(providers.map((item) => item.id), ['a', 'b', 'c']);
});
test('删除排在第一且正在使用的接口时启用新的第一个', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }], activeProviderId: 'a', selectedId: 'a', removedId: 'a',
  });
  assert.equal(next.activeProviderId, 'b');
  assert.equal(next.selectedId, 'b');
});
test('删除非使用中的接口时保留使用状态', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], activeProviderId: 'a', selectedId: 'c', removedId: 'b',
  });
  assert.equal(next.activeProviderId, 'a');
  assert.equal(next.selectedId, 'c');
  assert.deepEqual(next.providers.map((item) => item.id), ['a', 'c']);
});
test('删除正在使用的接口时，正在编辑的另一个接口保持选中', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], activeProviderId: 'a', selectedId: 'c', removedId: 'a',
  });
  assert.equal(next.activeProviderId, 'b');
  assert.equal(next.selectedId, 'c');
});
test('删除唯一接口时清空使用状态', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }], activeProviderId: 'a', selectedId: 'a', removedId: 'a',
  });
  assert.deepEqual(next.providers, []);
  assert.equal(next.activeProviderId, '');
  assert.equal(next.selectedId, '');
});
test('已有接口时优先保持当前编辑，否则选中正在使用的', () => {
  const providers = [{ id: 'a' }, { id: 'b' }];
  assert.equal(initialSelectedId(providers, 'b', 'a'), 'a');
  assert.equal(initialSelectedId(providers, 'b', ''), 'b');
  assert.equal(initialSelectedId(providers, '', 'missing'), 'a');
  assert.equal(initialSelectedId([], 'a', 'a'), '');
});
test('额外请求头只接受 JSON 对象', () => {
  assert.deepEqual(parseExtraHeaders(''), { ok: true, headers: {} });
  assert.deepEqual(parseExtraHeaders('  {"X-Demo":"1"} '), { ok: true, headers: { 'X-Demo': '1' } });
  assert.equal(parseExtraHeaders('{').ok, false);
  assert.equal(parseExtraHeaders('[]').ok, false);
  assert.equal(parseExtraHeaders('null').ok, false);
  assert.equal(parseExtraHeaders('{"X":{"nested":true}}').ok, false);
  const broken = parseExtraHeaders('{');
  assert.ok(!broken.ok);
  assert.match(broken.error, /JSON/);
});
test('连接耗时由调用方传入的毫秒决定', () => {
  assert.equal(formatElapsed(40), '0.04 秒');
  assert.equal(formatElapsed(800), '0.8 秒');
  assert.equal(formatElapsed(1200), '1.2 秒');
  assert.equal(formatElapsed(10500), '11 秒');
  assert.equal(formatElapsed(-1), '');
  // 多带一个 duration 字段，确认它不参与耗时计算。
  const input = { ok: true, sample: '正常', elapsedMs: 800, duration: 9 };
  const ok = formatConnectionResult(input);
  assert.equal(ok.text, '连接正常 · 0.8 秒');
  assert.equal(ok.detail, '模型回复：正常');
  const failed = formatConnectionResult({ ok: false, message: '网络请求失败', elapsedMs: 1200 });
  assert.equal(failed.text, '连接失败 · 1.2 秒');
  assert.equal(failed.detail, '网络请求失败');
  assert.equal(formatModelsResult({ count: 2, elapsedMs: 500 }).text, '已拉取 2 个模型 · 0.5 秒');
});
test('列表行展示协议、模型和主机', () => {
  const meta = providerMeta({ protocol: 'openai-chat', model: 'demo-small', baseUrl: 'https://invalid.example/v1' });
  assert.equal(meta.text, 'OpenAI 兼容 · demo-small · invalid.example');
  assert.equal(providerHost(''), '未填写地址');
  assert.equal(providerHost('not a url'), 'not a url');
});
test('AI 接口页保留原字段、自动保存，并且自己计时', () => {
  const root = ROOT;
  const ui = fs.readFileSync(path.join(root, 'src/pages/options/AiTab.tsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/common/ai/client.ts'), 'utf8');
  for (const field of ['baseUrl', 'apiKey', 'model', 'anthropicVersion', 'temperature', 'maxTokens', 'requestUrl', 'modelsUrl', 'extraHeaders', 'discoveredModels', 'activeProviderId']) {
    assert.match(ui, new RegExp(field));
  }
  assert.match(ui, /updateProviders/);
  assert.match(ui, /PRESETS\.map/);
  assert.match(ui, /PROTOCOLS\.map/);
  assert.match(ui, /AI_PROVIDER_TEST/);
  assert.match(ui, /AI_PROVIDER_MODELS/);
  assert.match(ui, /performance\.now\(\)/);
  assert.match(ui, /formatConnectionResult/);
  assert.doesNotMatch(ui, /<button\b[^>]*>\s*保存/);
  assert.doesNotMatch(client, /elapsedMs/);
});

// ---------- 匹配结果规整 ----------
section('AI 匹配结果规整');
test('分数越界收敛到 0-100', () => {
  assert.equal(sanitizeMatch({ score: 150 }).score, 100);
  assert.equal(sanitizeMatch({ score: -3 }).score, 0);
});
test('verdict 缺失按分数推断', () => {
  assert.equal(sanitizeMatch({ score: 85 }).verdict, 'strong');
  assert.equal(scoreToVerdict(50), 'fair');
});
test('数组截断到 6 条', () => {
  const m = sanitizeMatch({ score: 70, reasons: Array(10).fill('r') });
  assert.ok(m.reasons!.length <= 6);
});
test('三档招呼语：新结构原样保留', () => {
  const m = sanitizeMatch({ score: 80, greetings: { short: '短', standard: '中', detailed: '长' } });
  assert.equal(m.greetings!.short, '短');
  assert.equal(m.greetings!.standard, '中');
  assert.equal(m.greetings!.detailed, '长');
  assert.equal(m.greeting, '中'); // 兼容字段取标准版
});
test('三档招呼语：旧单字段视作标准版并兜底其它档', () => {
  const m = sanitizeMatch({ score: 80, greeting: '旧开场白' });
  assert.equal(m.greetings!.standard, '旧开场白');
  assert.equal(m.greetings!.short, '旧开场白'); // 缺失档位兜底
  assert.equal(m.greetings!.detailed, '旧开场白');
});
test('normalizeGreetings：全空得到三个空串且不抛错', () => {
  const g = normalizeGreetings({});
  assert.equal(g.short, '');
  assert.equal(g.standard, '');
  assert.equal(g.detailed, '');
});
test('normalizeGreetings：仅详细版时用它兜底标准/精简', () => {
  const g = normalizeGreetings({ greetings: { detailed: '详细内容' } });
  assert.equal(g.standard, '详细内容');
  assert.equal(g.short, '详细内容');
});

// ---------- 硬门槛 + 四维分（job-evaluate 方法论） ----------
section('匹配：硬门槛与分项');
test('有 blockers 时 eligible 判为 false', () => {
  const m = sanitizeMatch({ score: 40, blockers: ['要求5年经验，画像仅2年'] });
  assert.equal(m.eligible, false);
  assert.deepEqual(m.blockers, ['要求5年经验，画像仅2年']);
});
test('显式 eligible:false 被保留（即使无 blockers）', () => {
  assert.equal(sanitizeMatch({ score: 50, eligible: false }).eligible, false);
});
test('旧缓存无 eligible 字段默认视为 eligible', () => {
  const m = sanitizeMatch({ score: 70 });
  assert.equal(m.eligible, true);
  assert.deepEqual(m.blockers, []);
});
test('normalizeDims：分项越界收敛到 0-100', () => {
  const d = normalizeDims({ skill: 120, experience: -5, requirement: 60, location: 88 });
  assert.deepEqual(d, { skill: 100, experience: 0, requirement: 60, location: 88 });
});
test('normalizeDims：全空返回 null（旧缓存无分项）', () => {
  assert.equal(normalizeDims({}), null);
  assert.equal(normalizeDims(undefined), null);
});
test('sanitizeMatch 带 dims 时挂上分项', () => {
  const m = sanitizeMatch({ score: 80, dims: { skill: 90 } });
  assert.equal(m.dims!.skill, 90);
  assert.equal(m.dims!.experience, null);
});

// ---------- 简历定制建议 ----------
section('简历定制建议规整');
test('sanitizeTailor 规整各字段并截断', () => {
  const t = sanitizeTailor({
    matchedSkills: ['React', '', 'TS', 'Vue', 'Node', 'CSS', 'HTML', 'Git', '溢出'],
    missingSkills: ['SSR'],
    keywordsToAlign: ['中后台', '组件化'],
    summaryDraft: '  4年前端经验……  ',
    bulletSuggestions: ['突出组件库'],
    tips: ['准备量化案例'],
    note: '画像信息偏少',
  });
  assert.equal(t.matchedSkills.length, 8, 'matchedSkills 上限8、空串剔除');
  assert.ok(!t.matchedSkills.includes(''));
  assert.deepEqual(t.missingSkills, ['SSR']);
  assert.equal(t.summaryDraft, '4年前端经验……', '首尾空白 trim');
  assert.equal(t.note, '画像信息偏少');
  assert.ok(t.at, '带时间戳');
});
test('sanitizeTailor 容忍空输入', () => {
  const t = sanitizeTailor(null);
  assert.deepEqual(t.matchedSkills, []);
  assert.deepEqual(t.bulletSuggestions, []);
  assert.equal(t.summaryDraft, '');
  assert.equal(t.note, '');
});

// ---------- 脱敏 ----------
section('隐私脱敏');
test('手机号/邮箱/微信被隐藏', () => {
  const out = redactText('联系我 13800138000，邮箱 a@b.com，微信：abc12345');
  assert.ok(!out.includes('13800138000'));
  assert.ok(!out.includes('a@b.com'));
  assert.ok(out.includes('已隐藏'));
});

// ---------- 扩展内更新 ----------
