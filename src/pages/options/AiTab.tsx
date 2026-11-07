import React, { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MutableRefObject } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { MSG } from '../../common/constants.js';
import { PRESETS, PROTOCOLS, PROTOCOL_LABELS, providerFromPreset, validateProvider } from '../../common/ai/providers.js';
import { send } from '../../extension/messages.js';
import type { AIProvider, Settings } from '../../common/types.js';
import {
  formatConnectionResult,
  formatElapsed,
  formatModelsResult,
  initialSelectedId,
  parseExtraHeaders,
  protocolShortLabel,
  providerMeta,
  removeProviderState,
} from './aiState.js';
import type { FormattedResult } from './aiState.js';
import type { Report, RequestConfirm, RunAction, UpdateSettings } from './types.js';
import { cn } from '../../lib/cn.js';
import { button, fieldGrid, fieldHint, fieldLabel, groupTitle, hint } from './recipes.js';

/** 分组：组与组之间一条分隔线，第一组贴顶。 */
const group = 'm-0 border-t border-line pt-7 pb-[30px] first:border-t-0 first:pt-0';

/** 一行字段：上下各留 11px。 */
const field = `${fieldGrid} py-[11px]`;

/** 输入框、下拉框、多行文本共用的外观；出错时红框优先于聚焦色。 */
const control = 'h-9 w-full rounded-lg border border-line-strong bg-field px-2.5 text-body leading-[1.4] text-ink-1 tabular-nums outline-none placeholder:text-ink-3 focus:border-brand focus:shadow-focus aria-invalid:border-danger';

/** 下拉框：去掉原生箭头，用两块斜切渐变拼出「⌄」。 */
const select = [
  control,
  'appearance-none pr-7 bg-no-repeat bg-size-[5px_5px]',
  'bg-[linear-gradient(45deg,transparent_50%,var(--s-ink-3)_50%),linear-gradient(135deg,var(--s-ink-3)_50%,transparent_50%)]',
  'bg-[position:calc(100%_-_16px)_15px,calc(100%_-_11px)_15px]',
].join(' ');

const numberInput = cn(control, 'h-[34px] w-[88px]');

/** 输入框和右侧按钮并排；输入框占满剩余宽度。 */
const inline = 'flex items-center gap-2';
const inlineInput = cn(control, 'min-w-0 flex-1');

/** 失败原因：红字，长地址可在任意位置换行。 */
const detail = 'text-hint leading-[1.6] text-danger wrap-anywhere';

const badge = 'inline-flex h-5 items-center rounded-[5px] px-1.5 text-micro leading-none font-medium whitespace-nowrap';
const badgeTone = {
  on: 'bg-brand-soft text-brand before:mr-[5px] before:size-[5px] before:rounded-full before:bg-current',
  live: 'bg-well text-ink-2',
  ok: 'bg-[color-mix(in_srgb,var(--s-up)_14%,transparent)] text-ok',
  bad: 'bg-danger-soft text-danger',
};

/** 列表里的「设为使用」「编辑」：无边框，但文字用正文色，不用 ghost 默认的次要色。 */
const rowButton = cn(button({ variant: 'ghost', size: 'sm' }), 'text-ink-1');

/** 协议分段：灰底胶囊里一排选项，选中的那格浮起。radio 只留给读屏和键盘。 */
const segmentItem = [
  'relative flex min-h-[30px] flex-[1_1_40%] cursor-pointer items-center justify-center rounded-[7px] border px-2 py-1',
  'text-center text-control leading-[1.3] wide:flex-[1_1_0]',
  'focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
].join(' ');

/** 「高级设置」折叠标题：去掉原生三角，用 ::before 画「›」，展开时转 90°。 */
const advancedSummary = [
  'flex cursor-pointer list-none items-center gap-1.5 py-3 text-note leading-[1.4] text-ink-2 [&::-webkit-details-marker]:hidden',
  "before:inline-block before:text-[14px] before:leading-none before:text-ink-3 before:content-['›'] before:rotate-0 group-open:before:rotate-90",
  'motion-safe:before:transition-transform motion-safe:before:duration-150 motion-safe:before:ease-[ease]',
].join(' ');

type OperationKind = 'test' | 'models';

interface PendingOperation {
  id: string;
  kind: OperationKind;
  started: number;
  token: number;
}

interface TestResponse {
  ok?: boolean;
  message?: unknown;
  sample?: unknown;
}

export interface AiTabProps {
  action: RunAction;
  updateProviders: (next: AIProvider[]) => void;
  providersRef: MutableRefObject<AIProvider[]>;
  flush: (key: string) => Promise<void>;
  settingsRef: MutableRefObject<Settings | null>;
  updateSettings: UpdateSettings;
  report: Report;
  providers: AIProvider[];
  settings: Settings;
  setConfirm: RequestConfirm;
}

// AI 接口页：上方列表，下方只编辑选中的一条。沿用自动保存，不提供保存按钮。
export default function AiTab({
  action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, setConfirm,
}: AiTabProps) {
  const [preset, setPreset] = useState(() => PRESETS[0]?.key ?? '');
  const [selectedId, setSelectedId] = useState(() => initialSelectedId(providers, settings.activeProviderId));
  const [focusNonce, setFocusNonce] = useState(0);
  const [results, setResults] = useState<Record<string, FormattedResult>>({});
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [, setClock] = useState(0);
  const opRef = useRef(0);

  useEffect(() => {
    setSelectedId((current) => initialSelectedId(providers, settings.activeProviderId, current));
  }, [providers, settings.activeProviderId]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setClock((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, [pending]);

  const selected = providers.find((provider) => provider.id === selectedId) || null;

  const changeProvider = (id: string, patch: Partial<AIProvider>) => {
    updateProviders(providersRef.current.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)));
  };

  const addProvider = () => action(async () => {
    const created = providerFromPreset(preset);
    updateProviders([...providersRef.current, created]);
    await flush('providers');
    if (!settingsRef.current?.activeProviderId) {
      updateSettings({ activeProviderId: created.id });
      await flush('settings');
    }
    setSelectedId(created.id);
    setFocusNonce((value) => value + 1);
    report('已添加，请填写 API Key 与模型');
  });

  const runOperation = async (provider: AIProvider, kind: OperationKind) => {
    if (kind === 'test') {
      const valid = validateProvider(provider);
      if (!valid.ok) {
        setSelectedId(provider.id);
        setResults((current) => ({
          ...current,
          [provider.id]: { ok: false, text: '配置有误', detail: valid.errors.join('；') },
        }));
        return;
      }
    }
    const token = ++opRef.current;
    const started = performance.now();
    setSelectedId(provider.id);
    setPending({ id: provider.id, kind, started, token });
    try {
      if (kind === 'test') {
        const result = await send<TestResponse>(MSG.AI_PROVIDER_TEST, { provider });
        if (opRef.current !== token) return;
        const view = formatConnectionResult({
          ok: !!result?.ok,
          message: result?.message,
          sample: result?.sample,
          elapsedMs: performance.now() - started,
        });
        setResults((current) => ({ ...current, [provider.id]: view }));
      } else {
        const response = await send<unknown>(MSG.AI_PROVIDER_MODELS, { provider });
        const models: string[] = Array.isArray(response) ? (response as string[]) : [];
        if (opRef.current !== token) return;
        changeProvider(provider.id, { discoveredModels: models });
        setResults((current) => ({
          ...current,
          [provider.id]: formatModelsResult({ count: models.length, elapsedMs: performance.now() - started }),
        }));
      }
    } catch (error) {
      if (opRef.current !== token) return;
      const elapsedMs = performance.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const view = kind === 'test'
        ? formatConnectionResult({ ok: false, message, elapsedMs })
        : formatModelsResult({ error: message, elapsedMs });
      setResults((current) => ({ ...current, [provider.id]: view }));
    } finally {
      if (opRef.current === token) setPending(null);
    }
  };

  const askDelete = (provider: AIProvider) => {
    const current = settingsRef.current;
    const active = settings.activeProviderId === provider.id;
    setConfirm({
      title: '删除这个接口？',
      body: active
        ? `将删除「${provider.name}」。它正在使用，删除后会改用剩余列表中的第一个；没有剩余接口时不再标记正在使用。此操作不可撤销。`
        : `将删除「${provider.name}」，不可撤销。`,
      run: async () => {
        const next = removeProviderState({
          providers: providersRef.current,
          activeProviderId: current?.activeProviderId,
          selectedId,
          removedId: provider.id,
        });
        updateProviders(next.providers);
        await flush('providers');
        if (next.activeProviderId !== settingsRef.current?.activeProviderId) {
          updateSettings({ activeProviderId: next.activeProviderId });
          await flush('settings');
        }
        setSelectedId(next.selectedId);
        setResults((previous) => {
          if (!previous[provider.id]) return previous;
          const copy = { ...previous };
          delete copy[provider.id];
          return copy;
        });
        report('已删除');
      },
    });
  };

  const liveElapsed = pending ? performance.now() - pending.started : 0;

  return <TabsContent value="ai" className="w-full flex-none text-ink-1">
    <section className={group} aria-labelledby="ai-list-title">
      <h2 id="ai-list-title" className={`${groupTitle} scroll-mt-[72px]`}>已添加的接口</h2>
      <div className="flex items-center gap-2">
        <select className={`${select} min-w-0 flex-1`} aria-label="接口预设" data-ai="preset" value={preset} onChange={(event) => setPreset(event.target.value)}>
          {PRESETS.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>
        <button type="button" className={button({ variant: 'primary' })} data-ai="add" onClick={addProvider}>添加</button>
      </div>
      {!providers.length && <p className="mt-3.5 text-control leading-[1.6] text-ink-3">还没有接口</p>}
      {!!providers.length && <div className="mt-1">
        {providers.map((provider) => {
          const meta = providerMeta(provider);
          const active = settings.activeProviderId === provider.id;
          const editing = provider.id === selected?.id;
          return <div className="flex flex-col justify-between gap-4 border-t border-line py-3.5 wide:flex-row wide:items-center" key={provider.id} data-ai="row" data-provider-id={provider.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-body leading-normal font-medium text-ink-1">
                <span>{provider.name}</span>
                {active && <span className={cn(badge, badgeTone.on)}>正在使用</span>}
              </div>
              <p className="mt-0.5 text-hint leading-normal text-ink-3 wrap-anywhere">
                {meta.protocol}
                {' · '}
                <span className="rounded-sm bg-well px-1 font-mono text-hint text-ink-2">{meta.model}</span>
                {' · '}
                {meta.host}
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-1.5 wide:justify-end">
              <button type="button" className={button({ size: 'sm' })} data-ai="test" disabled={!!pending} onClick={() => runOperation(provider, 'test')}>
                {pending?.id === provider.id && pending.kind === 'test' ? '测试中…' : '测试连接'}
              </button>
              {!active && <button type="button" className={rowButton} data-ai="use" onClick={() => updateSettings({ activeProviderId: provider.id })}>设为使用</button>}
              <button type="button" className={rowButton} data-ai="edit" aria-pressed={editing} aria-controls="ai-editor" onClick={() => { setSelectedId(provider.id); setFocusNonce((value) => value + 1); }}>编辑</button>
            </div>
          </div>;
        })}
      </div>}
    </section>
    {selected && <ProviderEditor
      key={selected.id}
      provider={selected}
      focusNonce={focusNonce}
      pending={pending?.id === selected.id ? pending : null}
      elapsed={pending?.id === selected.id ? liveElapsed : 0}
      result={results[selected.id]}
      onChange={(patch) => changeProvider(selected.id, patch)}
      onModels={() => runOperation(selected, 'models')}
    />}
    {selected && <section className="flex flex-col justify-between gap-4 border-t border-line pt-[22px] pb-2 wide:flex-row wide:items-center" aria-labelledby="ai-delete-title">
      <div>
        <h2 id="ai-delete-title" className={cn(groupTitle, 'mb-0')}>删除这个接口</h2>
        <p className="mt-1 text-note leading-[1.65] text-ink-3">删除后无法恢复。若它正在使用，会改用剩余的第一个接口。</p>
      </div>
      <button type="button" className={`${button({ variant: 'danger' })} self-start wide:self-auto`} data-ai="delete" onClick={() => askDelete(selected)}>删除</button>
    </section>}
  </TabsContent>;
}

type ProviderField = 'name' | 'baseUrl' | 'model' | 'apiKey' | 'anthropicVersion' | 'requestUrl' | 'modelsUrl' | 'temperature' | 'maxTokens';

interface ProviderEditorProps {
  provider: AIProvider;
  focusNonce: number;
  pending: PendingOperation | null;
  elapsed: number;
  result?: FormattedResult;
  onChange: (patch: Partial<AIProvider>) => void;
  onModels: () => void;
}

function ProviderEditor({ provider, focusNonce, pending, elapsed, result, onChange, onModels }: ProviderEditorProps) {
  const [showKey, setShowKey] = useState(false);
  const [headers, setHeaders] = useState(() => (Object.keys(provider.extraHeaders || {}).length ? JSON.stringify(provider.extraHeaders) : ''));
  const [headersError, setHeadersError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const listId = `models-${provider.id}`;

  useEffect(() => {
    if (focusNonce) nameRef.current?.focus();
  }, [focusNonce]);

  const bind = (key: ProviderField, type: 'text' | 'number' = 'text') => ({
    value: (provider[key] ?? '') as string | number,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ [key]: type === 'number' ? Number(event.target.value) : event.target.value } as Partial<AIProvider>),
  });

  const liveText = pending
    ? `${pending.kind === 'test' ? '测试中' : '拉取中'} · ${formatElapsed(elapsed)}`
    : '';

  return <section className={group} id="ai-editor" aria-labelledby="ai-editor-title">
    <h2 id="ai-editor-title" className={groupTitle}>编辑</h2>
    <div className={field}>
      <label className={fieldLabel} htmlFor={`name-${provider.id}`}>名称</label>
      <input className={control} id={`name-${provider.id}`} data-ai="name" ref={nameRef} autoComplete="off" {...bind('name')} />
    </div>
    <div className={field}>
      <span className={fieldLabel} id={`protocol-label-${provider.id}`}>协议</span>
      <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-well p-[3px]" role="radiogroup" aria-labelledby={`protocol-label-${provider.id}`} data-ai="protocol">
        {PROTOCOLS.map((value) => <label key={value} className={cn(segmentItem, provider.protocol === value ? 'border-line-strong bg-surface font-medium text-ink-1 shadow-card' : 'border-transparent text-ink-2')} title={PROTOCOL_LABELS[value]}>
          <input
            className="sr-only"
            type="radio"
            name={`protocol-${provider.id}`}
            value={value}
            checked={provider.protocol === value}
            onChange={() => onChange({
              protocol: value,
              ...(value === 'anthropic' && !provider.anthropicVersion ? { anthropicVersion: '2023-06-01' } : {}),
            })}
          />
          {protocolShortLabel(value)}
        </label>)}
      </div>
    </div>
    <div className={field}>
      <label className={fieldLabel} htmlFor={`base-${provider.id}`}>接口地址</label>
      <div>
        <input className={control} id={`base-${provider.id}`} data-ai="base" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" {...bind('baseUrl')} />
        <p className={fieldHint}>填到 /v1 为止</p>
      </div>
    </div>
    <div className={field}>
      <label className={fieldLabel} htmlFor={`model-${provider.id}`}>模型</label>
      <div className={inline}>
        <input className={inlineInput} id={`model-${provider.id}`} data-ai="model" list={listId} autoComplete="off" spellCheck={false} placeholder="如 gpt-4o-mini" {...bind('model')} />
        <datalist id={listId}>
          {(provider.discoveredModels || []).map((model) => <option key={model} value={model} />)}
        </datalist>
        <button type="button" className={`${button()} flex-none`} data-ai="models" disabled={!!pending} onClick={onModels}>拉取模型</button>
      </div>
    </div>
    <div className={field}>
      <label className={fieldLabel} htmlFor={`key-${provider.id}`}>API Key</label>
      <div>
        <div className={inline}>
          <input className={inlineInput} id={`key-${provider.id}`} data-ai="key" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} {...bind('apiKey')} />
          <button type="button" className={`${button()} flex-none`} data-ai="key-toggle" aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</button>
        </div>
        {provider.protocol === 'gemini' && <p className={fieldHint}>Gemini 的 Key 走查询参数。</p>}
      </div>
    </div>
    <div className="flex min-h-8 flex-wrap items-center gap-2 pt-1.5" data-ai="result" role={result && !result.ok && !pending ? 'alert' : 'status'} aria-live={result && !result.ok ? 'assertive' : 'polite'}>
      {pending && <span className={cn(badge, badgeTone.live)}>{liveText}</span>}
      {!pending && result && <span className={cn(badge, result.ok ? badgeTone.ok : badgeTone.bad)}>{result.text}</span>}
      {!pending && result?.detail && <p className={cn(result.ok ? hint : detail, 'flex-[1_0_100%]')}>{result.detail}</p>}
    </div>
    <details className="group mt-2 border-t border-dashed border-line-strong">
      <summary className={advancedSummary}>高级设置</summary>
      {provider.protocol === 'anthropic' && <div className={field}>
        <label className={fieldLabel} htmlFor={`anthropic-${provider.id}`}>anthropic-version</label>
        <input className={control} id={`anthropic-${provider.id}`} data-ai="anthropic" autoComplete="off" placeholder="2023-06-01" {...bind('anthropicVersion')} />
      </div>}
      <div className={field}>
        <label className={fieldLabel} htmlFor={`temperature-${provider.id}`}>temperature</label>
        <input id={`temperature-${provider.id}`} className={numberInput} data-ai="temperature" type="number" {...bind('temperature', 'number')} />
      </div>
      <div className={field}>
        <label className={fieldLabel} htmlFor={`tokens-${provider.id}`}>maxTokens</label>
        <input id={`tokens-${provider.id}`} className={numberInput} data-ai="max-tokens" type="number" {...bind('maxTokens', 'number')} />
      </div>
      <div className={field}>
        <label className={fieldLabel} htmlFor={`request-${provider.id}`}>请求地址</label>
        <div>
          <input className={control} id={`request-${provider.id}`} data-ai="request" autoComplete="off" spellCheck={false} {...bind('requestUrl')} />
          <p className={fieldHint}>留空则按接口地址自动拼接</p>
        </div>
      </div>
      <div className={field}>
        <label className={fieldLabel} htmlFor={`models-url-${provider.id}`}>模型列表地址</label>
        <div>
          <input className={control} id={`models-url-${provider.id}`} data-ai="models-url" autoComplete="off" spellCheck={false} {...bind('modelsUrl')} />
          <p className={fieldHint}>留空则使用接口地址下的模型列表</p>
        </div>
      </div>
      <div className={field}>
        <label className={fieldLabel} htmlFor={`headers-${provider.id}`}>额外请求头</label>
        <div>
          <textarea
            className={cn(control, 'block h-auto min-h-[76px] resize-y py-2')}
            id={`headers-${provider.id}`}
            data-ai="headers"
            rows={3}
            spellCheck={false}
            aria-invalid={headersError ? true : undefined}
            placeholder={'{"X-Custom":"value"}'}
            value={headers}
            onChange={(event) => {
              const next = event.target.value;
              setHeaders(next);
              const parsed = parseExtraHeaders(next);
              if (!parsed.ok) {
                setHeadersError(parsed.error);
                return;
              }
              setHeadersError('');
              onChange({ extraHeaders: parsed.headers });
            }}
          />
          {headersError && <p className={`${detail} mt-1.5`} role="alert">{headersError}</p>}
        </div>
      </div>
    </details>
  </section>;
}
