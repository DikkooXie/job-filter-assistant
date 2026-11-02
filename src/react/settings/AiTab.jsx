import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import { PRESETS, PROTOCOLS, PROTOCOL_LABELS, providerFromPreset } from '../../common/ai/providers.js';
import { Field, Panel, Choice } from './controls.jsx';

export default function AiTab({ preset, setPreset, action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, results, changeProvider, providerOperation }) {
  return <TabsContent value="ai" className="space-y-4"><Panel title="添加供应商" description="兼容 OpenAI / Anthropic / Gemini 等主流协议，可接入任意兼容供应商或本地模型。选择预设或自定义供应商。"><div className="flex flex-wrap gap-2"><div className="min-w-64 flex-1"><Choice label="供应商预设" value={preset} onValueChange={setPreset} options={PRESETS.map((p) => [p.key, p.name + (p.hint ? ` — ${p.hint}` : '')])} /></div><Button onClick={() => action(async () => { const p = providerFromPreset(preset); updateProviders([...providersRef.current, p]); await flush('providers'); if (!settingsRef.current.activeProviderId) { updateSettings({ activeProviderId: p.id }); await flush('settings'); } report('已添加，请填写 API Key 与模型'); })}>添加</Button></div></Panel>
        {!providers.length && <p className="p-6 text-center text-muted-foreground">还没有配置任何 AI 供应商</p>}
        {providers.map((p) => <ProviderCard key={p.id} provider={p} active={settings.activeProviderId === p.id} result={results[p.id]} onChange={(patch) => changeProvider(p.id, patch)} onTest={() => providerOperation(p, 'test')} onModels={() => providerOperation(p, 'models')} onActivate={() => { updateSettings({ activeProviderId: p.id }); report('已设为当前启用'); }} onDelete={() => action(async () => { updateProviders(providersRef.current.filter((x) => x.id !== p.id)); await flush('providers'); if (settingsRef.current.activeProviderId === p.id) { updateSettings({ activeProviderId: providersRef.current[0]?.id || '' }); await flush('settings'); } report('已删除'); })} />)}
      </TabsContent>;
}

function ProviderCard({ provider: p, active, result, onChange, onTest, onModels, onActivate, onDelete }) {
  const [headers, setHeaders] = useState(() => Object.keys(p.extraHeaders || {}).length ? JSON.stringify(p.extraHeaders) : '');
  const [headersInvalid, setHeadersInvalid] = useState(false);
  const bind = (key, type = 'text', placeholder = '') => <Input type={type} placeholder={placeholder} value={p[key] ?? ''} onChange={(e) => onChange({ [key]: type === 'number' ? Number(e.target.value) : e.target.value })} />;
  return <Panel title={<span className="flex flex-wrap items-center gap-2">{p.name} {active && <Badge>当前启用</Badge>} <Badge variant="secondary">{PROTOCOL_LABELS[p.protocol]}</Badge></span>}>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="名称">{bind('name')}</Field><Field label="协议"><Choice label="协议" value={p.protocol} onValueChange={(protocol) => onChange({ protocol })} options={PROTOCOLS.map((v) => [v, PROTOCOL_LABELS[v]])} /></Field></div><Field label="API Base URL">{bind('baseUrl', 'text', 'https://api.example.com/v1')}</Field><div className="grid gap-4 sm:grid-cols-2"><Field label={p.protocol === 'gemini' ? 'API Key（走 query）' : 'API Key'}>{bind('apiKey', 'password', 'sk-...')}</Field><Field label="模型 ID"><Input list={`models-${p.id}`} placeholder="如 gpt-4o-mini" value={p.model} onChange={(e) => onChange({ model: e.target.value })} /><datalist id={`models-${p.id}`}>{p.discoveredModels.map((m) => <option key={m} value={m} />)}</datalist></Field></div>
    <details><summary className="cursor-pointer text-sm font-medium">高级设置</summary><div className="mt-4 space-y-4">{p.protocol === 'anthropic' && <Field label="anthropic-version">{bind('anthropicVersion', 'text', '2023-06-01')}</Field>}<div className="grid gap-4 sm:grid-cols-2"><Field label="temperature">{bind('temperature', 'number', '0.3')}</Field><Field label="max tokens">{bind('maxTokens', 'number', '2048')}</Field></div><Field label="自定义请求 URL（可选，覆盖 Base 拼接）">{bind('requestUrl', 'text', '留空则自动拼接')}</Field><Field label="自定义模型列表 URL（可选）">{bind('modelsUrl', 'text', '留空则用 Base/models')}</Field><Field label="额外请求头（JSON，可选）"><Textarea rows={2} aria-invalid={headersInvalid} placeholder={'{"X-Custom":"value"}'} value={headers} onChange={(e) => { const v = e.target.value; setHeaders(v); try { const obj = v.trim() ? JSON.parse(v) : {}; if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(); setHeadersInvalid(false); onChange({ extraHeaders: obj }); } catch { setHeadersInvalid(true); } }} /></Field>{headersInvalid && <p className="text-sm text-destructive">请输入有效的 JSON 对象</p>}</div></details>
    <div className="flex flex-wrap gap-2"><Button onClick={onTest}>测试连接</Button><Button variant="outline" onClick={onModels}>拉取模型列表</Button>{!active && <Button variant="outline" onClick={onActivate}>设为启用</Button>}<Button variant="destructive" onClick={onDelete}>删除</Button></div>{result && <p className="text-sm" role="status">{result}</p>}
  </Panel>;
}
