import { useEffect, useRef, useState } from 'react';
import { TabsContent } from '@/components/ui/tabs';
import { MSG } from '../../common/constants.js';
import { PRESETS, PROTOCOLS, PROTOCOL_LABELS, providerFromPreset, validateProvider } from '../../common/ai/providers.js';
import { send } from '../../ui/ui-common.js';
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
import './ai.css';

// AI 接口页：上方列表，下方只编辑选中的一条。沿用自动保存，不提供保存按钮。
export default function AiTab({
  action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, setConfirm,
}) {
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [selectedId, setSelectedId] = useState(() => initialSelectedId(providers, settings.activeProviderId));
  const [focusNonce, setFocusNonce] = useState(0);
  const [results, setResults] = useState({});
  const [pending, setPending] = useState(null);
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

  const changeProvider = (id, patch) => {
    updateProviders(providersRef.current.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)));
  };

  const addProvider = () => action(async () => {
    const created = providerFromPreset(preset);
    updateProviders([...providersRef.current, created]);
    await flush('providers');
    if (!settingsRef.current.activeProviderId) {
      updateSettings({ activeProviderId: created.id });
      await flush('settings');
    }
    setSelectedId(created.id);
    setFocusNonce((value) => value + 1);
    report('已添加，请填写 API Key 与模型');
  });

  const runOperation = async (provider, kind) => {
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
        const result = await send(MSG.AI_PROVIDER_TEST, { provider });
        if (opRef.current !== token) return;
        const view = formatConnectionResult({
          ok: !!result?.ok,
          message: result?.message,
          sample: result?.sample,
          elapsedMs: performance.now() - started,
        });
        setResults((current) => ({ ...current, [provider.id]: view }));
      } else {
        const models = await send(MSG.AI_PROVIDER_MODELS, { provider });
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

  const askDelete = (provider) => {
    const active = settings.activeProviderId === provider.id;
    setConfirm({
      title: '删除这个接口？',
      body: active
        ? `将删除「${provider.name}」。它正在使用，删除后会改用剩余列表中的第一个；没有剩余接口时不再标记正在使用。此操作不可撤销。`
        : `将删除「${provider.name}」，不可撤销。`,
      run: async () => {
        const next = removeProviderState({
          providers: providersRef.current,
          activeProviderId: settingsRef.current.activeProviderId,
          selectedId,
          removedId: provider.id,
        });
        updateProviders(next.providers);
        await flush('providers');
        if (next.activeProviderId !== settingsRef.current.activeProviderId) {
          updateSettings({ activeProviderId: next.activeProviderId });
          await flush('settings');
        }
        setSelectedId(next.selectedId);
        setResults((current) => {
          if (!current[provider.id]) return current;
          const copy = { ...current };
          delete copy[provider.id];
          return copy;
        });
        report('已删除');
      },
    });
  };

  const liveElapsed = pending ? performance.now() - pending.started : 0;

  return <TabsContent value="ai" className="ai-page">
    <section className="ai-group" aria-labelledby="ai-list-title">
      <h2 id="ai-list-title">已添加的接口</h2>
      <div className="ai-add">
        <select aria-label="接口预设" data-ai="preset" value={preset} onChange={(event) => setPreset(event.target.value)}>
          {PRESETS.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>
        <button type="button" className="ai-btn ai-btn-primary" data-ai="add" onClick={addProvider}>添加</button>
      </div>
      {!providers.length && <p className="ai-empty">还没有接口</p>}
      {!!providers.length && <div className="ai-list">
        {providers.map((provider) => {
          const meta = providerMeta(provider);
          const active = settings.activeProviderId === provider.id;
          const editing = provider.id === selected?.id;
          return <div className="ai-row" key={provider.id} data-ai="row" data-provider-id={provider.id}>
            <div className="ai-row-main">
              <div className="ai-row-name">
                <span>{provider.name}</span>
                {active && <span className="ai-badge is-on">正在使用</span>}
              </div>
              <p className="ai-row-meta">
                {meta.protocol}
                {' · '}
                <span className="ai-model">{meta.model}</span>
                {' · '}
                {meta.host}
              </p>
            </div>
            <div className="ai-row-actions">
              <button type="button" className="ai-btn ai-btn-outline ai-btn-sm" data-ai="test" disabled={!!pending} onClick={() => runOperation(provider, 'test')}>
                {pending?.id === provider.id && pending.kind === 'test' ? '测试中…' : '测试连接'}
              </button>
              {!active && <button type="button" className="ai-btn ai-btn-ghost ai-btn-sm" data-ai="use" onClick={() => updateSettings({ activeProviderId: provider.id })}>设为使用</button>}
              <button type="button" className="ai-btn ai-btn-ghost ai-btn-sm" data-ai="edit" aria-pressed={editing} aria-controls="ai-editor" onClick={() => { setSelectedId(provider.id); setFocusNonce((value) => value + 1); }}>编辑</button>
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
    {selected && <section className="ai-danger" aria-labelledby="ai-delete-title">
      <div>
        <h2 id="ai-delete-title">删除这个接口</h2>
        <p>删除后无法恢复。若它正在使用，会改用剩余的第一个接口。</p>
      </div>
      <button type="button" className="ai-btn ai-btn-danger" data-ai="delete" onClick={() => askDelete(selected)}>删除</button>
    </section>}
  </TabsContent>;
}

function ProviderEditor({ provider, focusNonce, pending, elapsed, result, onChange, onModels }) {
  const [showKey, setShowKey] = useState(false);
  const [headers, setHeaders] = useState(() => (Object.keys(provider.extraHeaders || {}).length ? JSON.stringify(provider.extraHeaders) : ''));
  const [headersError, setHeadersError] = useState('');
  const nameRef = useRef(null);
  const listId = `models-${provider.id}`;

  useEffect(() => {
    if (focusNonce) nameRef.current?.focus();
  }, [focusNonce]);

  const bind = (key, type = 'text') => ({
    value: provider[key] ?? '',
    onChange: (event) => onChange({ [key]: type === 'number' ? Number(event.target.value) : event.target.value }),
  });

  const liveText = pending
    ? `${pending.kind === 'test' ? '测试中' : '拉取中'} · ${formatElapsed(elapsed)}`
    : '';

  return <section className="ai-group" id="ai-editor" aria-labelledby="ai-editor-title">
    <h2 id="ai-editor-title">编辑</h2>
    <div className="ai-field">
      <label htmlFor={`name-${provider.id}`}>名称</label>
      <input id={`name-${provider.id}`} data-ai="name" ref={nameRef} autoComplete="off" {...bind('name')} />
    </div>
    <div className="ai-field">
      <span className="ai-label" id={`protocol-label-${provider.id}`}>协议</span>
      <div className="ai-segment" role="radiogroup" aria-labelledby={`protocol-label-${provider.id}`} data-ai="protocol">
        {PROTOCOLS.map((value) => <label key={value} className={provider.protocol === value ? 'is-on' : ''} title={PROTOCOL_LABELS[value]}>
          <input
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
    <div className="ai-field">
      <label htmlFor={`base-${provider.id}`}>接口地址</label>
      <div>
        <input id={`base-${provider.id}`} data-ai="base" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" {...bind('baseUrl')} />
        <p className="ai-hint">填到 /v1 为止</p>
      </div>
    </div>
    <div className="ai-field">
      <label htmlFor={`model-${provider.id}`}>模型</label>
      <div className="ai-inline">
        <input id={`model-${provider.id}`} data-ai="model" list={listId} autoComplete="off" spellCheck={false} placeholder="如 gpt-4o-mini" {...bind('model')} />
        <datalist id={listId}>
          {(provider.discoveredModels || []).map((model) => <option key={model} value={model} />)}
        </datalist>
        <button type="button" className="ai-btn ai-btn-outline" data-ai="models" disabled={!!pending} onClick={onModels}>拉取模型</button>
      </div>
    </div>
    <div className="ai-field">
      <label htmlFor={`key-${provider.id}`}>API Key</label>
      <div>
        <div className="ai-inline">
          <input id={`key-${provider.id}`} data-ai="key" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} {...bind('apiKey')} />
          <button type="button" className="ai-btn ai-btn-outline" data-ai="key-toggle" aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</button>
        </div>
        {provider.protocol === 'gemini' && <p className="ai-hint">Gemini 的 Key 走查询参数。</p>}
      </div>
    </div>
    <div className="ai-outcome" data-ai="result" role={result && !result.ok && !pending ? 'alert' : 'status'} aria-live={result && !result.ok ? 'assertive' : 'polite'}>
      {pending && <span className="ai-badge is-live">{liveText}</span>}
      {!pending && result && <span className={`ai-badge ${result.ok ? 'is-ok' : 'is-bad'}`}>{result.text}</span>}
      {!pending && result?.detail && <p className={result.ok ? 'ai-hint' : 'ai-detail'}>{result.detail}</p>}
    </div>
    <details className="ai-advanced">
      <summary>高级设置</summary>
      {provider.protocol === 'anthropic' && <div className="ai-field">
        <label htmlFor={`anthropic-${provider.id}`}>anthropic-version</label>
        <input id={`anthropic-${provider.id}`} data-ai="anthropic" autoComplete="off" placeholder="2023-06-01" {...bind('anthropicVersion')} />
      </div>}
      <div className="ai-field">
        <label htmlFor={`temperature-${provider.id}`}>temperature</label>
        <input id={`temperature-${provider.id}`} className="ai-num" data-ai="temperature" type="number" {...bind('temperature', 'number')} />
      </div>
      <div className="ai-field">
        <label htmlFor={`tokens-${provider.id}`}>maxTokens</label>
        <input id={`tokens-${provider.id}`} className="ai-num" data-ai="max-tokens" type="number" {...bind('maxTokens', 'number')} />
      </div>
      <div className="ai-field">
        <label htmlFor={`request-${provider.id}`}>请求地址</label>
        <div>
          <input id={`request-${provider.id}`} data-ai="request" autoComplete="off" spellCheck={false} {...bind('requestUrl')} />
          <p className="ai-hint">留空则按接口地址自动拼接</p>
        </div>
      </div>
      <div className="ai-field">
        <label htmlFor={`models-url-${provider.id}`}>模型列表地址</label>
        <div>
          <input id={`models-url-${provider.id}`} data-ai="models-url" autoComplete="off" spellCheck={false} {...bind('modelsUrl')} />
          <p className="ai-hint">留空则使用接口地址下的模型列表</p>
        </div>
      </div>
      <div className="ai-field">
        <label htmlFor={`headers-${provider.id}`}>额外请求头</label>
        <div>
          <textarea
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
          {headersError && <p className="ai-detail" role="alert">{headersError}</p>}
        </div>
      </div>
    </details>
  </section>;
}
