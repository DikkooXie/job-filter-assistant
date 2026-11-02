import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MSG, MODE } from '../common/constants.js';
import { emptyProfile, scoreProfile, sanitizeProfile, mergeDraft } from '../common/profile.js';
import { PRESETS, PROTOCOLS, PROTOCOL_LABELS, providerFromPreset, validateProvider } from '../common/ai/providers.js';
import { send, toList } from '../ui/ui-common.js';
import { parseResumeFile } from '../ui/resumeParser.js';
import UpdatePanel from './UpdatePanel.jsx';

function Field({ label, children }) {
  return <label className="grid gap-2 text-sm font-medium">{label}{children}</label>;
}
function Panel({ title, description, children }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;
}
function Choice({ value, onValueChange, options, label }) {
  return <Select value={value} onValueChange={onValueChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}</SelectContent></Select>;
}
function Tags({ value = [], onChange, placeholder, label }) {
  const [input, setInput] = useState('');
  const commit = () => {
    const next = [...value];
    for (const part of toList(input)) if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    if (next.length !== value.length) onChange(next);
    setInput('');
  };
  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-input p-2">
    {value.map((v, i) => <Badge key={`${v}-${i}`} variant="secondary" className="gap-1">{v}<button type="button" aria-label={`删除 ${v}`} onClick={() => onChange(value.filter((_, n) => n !== i))}>×</button></Badge>)}
    <Input aria-label={label} className="min-w-32 flex-1 border-0 shadow-none" placeholder={placeholder || '回车添加'} value={input} onChange={(e) => setInput(e.target.value)} onBlur={commit} onKeyDown={(e) => {
      if (['Enter', ',', '，'].includes(e.key)) { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
    }} />
  </div>;
}
function ToggleRow({ label, description, checked, onChange }) {
  return <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0"><div><div className="text-sm font-medium">{label}</div><p className="text-sm text-muted-foreground">{description}</p></div><Switch aria-label={label} checked={!!checked} onCheckedChange={onChange} /></div>;
}

// Serialize saves and retain the latest snapshot, so rapid edits and navigation cannot overwrite each other.
function useSaveQueue(report) {
  const queues = useRef({});
  const enqueue = useCallback((key, task, delay = 500) => {
    const q = queues.current[key] || (queues.current[key] = { chain: Promise.resolve(), timer: null, task: null });
    clearTimeout(q.timer);
    q.task = task;
    q.timer = setTimeout(() => {
      q.timer = null;
      const pending = q.task; q.task = null;
      q.chain = q.chain.catch(() => {}).then(pending);
      q.chain.catch((e) => { report(e.message, true); });
    }, delay);
  }, [report]);
  const flush = useCallback(async (key) => {
    const q = queues.current[key];
    if (!q) return;
    clearTimeout(q.timer); q.timer = null;
    if (q.task) { const pending = q.task; q.task = null; q.chain = q.chain.catch(() => {}).then(pending); }
    await q.chain;
  }, []);
  useEffect(() => () => { Object.values(queues.current).forEach((q) => { clearTimeout(q.timer); if (q.task) q.chain.catch(() => {}).then(q.task).catch(() => {}); }); }, []);
  return { enqueue, flush };
}

export default function Options() {
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState([]);
  const [profile, setProfile] = useState(null);
  const settingsRef = useRef(null), providersRef = useRef([]), profileRef = useRef(null);
  const pendingSettings = useRef({});
  const [draft, setDraft] = useState(null), [materials, setMaterials] = useState([]), [paste, setPaste] = useState('');
  const [notice, setNotice] = useState(null), [busy, setBusy] = useState(''), [confirm, setConfirm] = useState(null);
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [results, setResults] = useState({});
  const fileRef = useRef(null);
  const report = useCallback((message, error = false) => setNotice({ message, error }), []);
  const { enqueue, flush } = useSaveQueue(report);
  useEffect(() => { let live = true; Promise.all([send(MSG.SETTINGS_GET), send(MSG.AI_PROVIDERS_GET), send(MSG.PROFILE_GET)]).then(([s, p, r]) => {
    if (!live) return; settingsRef.current = s; providersRef.current = p; profileRef.current = r; setSettings(s); setProviders(p); setProfile(r);
  }).catch((e) => { if (live) report(e.message, true); }); return () => { live = false; }; }, [report]);
  const updateSettings = (patch) => {
    const old = settingsRef.current;
    const next = { ...old, ...patch, filters: { ...old.filters, ...patch.filters }, privacy: { ...old.privacy, ...patch.privacy } };
    settingsRef.current = next; setSettings(next);
    const pending = pendingSettings.current;
    pendingSettings.current = { ...pending, ...patch };
    for (const key of ['filters', 'privacy']) {
      if (pending[key] || patch[key]) pendingSettings.current[key] = { ...pending[key], ...patch[key] };
    }
    enqueue('settings', async () => {
      const changes = pendingSettings.current;
      pendingSettings.current = {};
      try {
        await send(MSG.SETTINGS_SAVE, { patch: changes });
      } catch (e) {
        const newer = pendingSettings.current;
        pendingSettings.current = { ...changes, ...newer };
        for (const key of ['filters', 'privacy']) {
          if (changes[key] || newer[key]) pendingSettings.current[key] = { ...changes[key], ...newer[key] };
        }
        throw e;
      }
    }, 200);
  };
  const updateProfile = (next) => { profileRef.current = next; setProfile(next); enqueue('profile', () => send(MSG.PROFILE_SAVE, { profile: next }), 600); };
  const updateProviders = (next) => { providersRef.current = next; setProviders(next); enqueue('providers', () => send(MSG.AI_PROVIDERS_SAVE, { providers: next }), 500); };
  const action = async (fn) => { try { await fn(); } catch (e) { report(e.message, true); } };
  const withBusy = async (text, fn) => { setBusy(text); try { await fn(); } catch (e) { report(e.message, true); } finally { setBusy(''); } };
  const prepareAI = async () => { await flush('providers'); await flush('settings'); };
  const extract = (text) => withBusy('AI 正在抽取画像…', async () => { await prepareAI(); setDraft(sanitizeProfile(await send(MSG.AI_RESUME_EXTRACT, { text }))); report('抽取完成，请确认'); });
  const resumeFile = (file) => withBusy('正在解析简历文件…', async () => { const { text } = await parseResumeFile(file); setBusy('AI 正在抽取画像…'); await prepareAI(); setDraft(sanitizeProfile(await send(MSG.AI_RESUME_EXTRACT, { text }))); report('抽取完成，请确认'); });
  const readMaterials = async (files) => { setMaterials([]); await action(async () => {
    const items = await Promise.all(Array.from(files).map(async (file) => ({ name: file.name, text: await file.text() })));
    if (!items.length) return;
    if (items.some((item) => !item.text.trim())) throw new Error('文件为空，请检查后重新选择');
    const json = items.filter((item) => /\.json$/i.test(item.name));
    if (json.length && (json.length !== 1 || items.length !== 1)) throw new Error('画像 JSON 请单独导入');
    if (json.length) { const data = JSON.parse(json[0].text); if (!data || Array.isArray(data) || typeof data !== 'object' || !['target', 'basics', 'capabilities', 'workSummary', 'projectSummary', 'highlights', 'preference'].some((key) => key in data)) throw new Error('不是有效的画像 JSON'); }
    setMaterials(items);
  }); };
  const extractMaterials = () => withBusy('AI 正在逐段抽取画像…', async () => {
    await prepareAI();
    let combined = emptyProfile();
    for (const item of materials) for (let offset = 0; offset < item.text.length; offset += 10000) {
      const extracted = sanitizeProfile(await send(MSG.AI_RESUME_EXTRACT, { text: `材料：${item.name}\n${item.text.slice(offset, offset + 10000)}` }));
      const previous = combined; combined = mergeDraft(previous, extracted);
      for (const key of ['workSummary', 'projectSummary']) if (previous[key] && extracted[key] && !previous[key].includes(extracted[key])) combined[key] = previous[key] + '\n' + extracted[key];
    }
    setDraft(combined); report('抽取完成，请核对事实和贡献边界');
  });
  const applyDraft = (replace) => withBusy('正在保存画像…', async () => {
    await flush('profile');
    let next = draft;
    if (!replace) {
      const previous = sanitizeProfile(profileRef.current); next = mergeDraft(previous, draft);
      const append = (oldText, newText) => !newText || oldText.includes(newText) ? oldText : oldText ? `${oldText}\n\n${newText}` : newText;
      next.workSummary = append(previous.workSummary, draft.workSummary); next.projectSummary = append(previous.projectSummary, draft.projectSummary); next.preference.notes = append(previous.preference.notes, draft.preference.notes);
    }
    next = await send(MSG.PROFILE_SAVE, { profile: next }); profileRef.current = next; setProfile(next); setDraft(null); report(replace ? '已替换并保存' : '已合并并保存');
  });
  const editProfile = (group, key, value) => updateProfile(group ? { ...profileRef.current, [group]: { ...profileRef.current[group], [key]: value } } : { ...profileRef.current, [key]: value });
  const profileText = (label, group, key, type = 'text', placeholder = '') => <Field key={key} label={label}><Input type={type} placeholder={placeholder} value={(group ? profile[group][key] : profile[key]) ?? ''} onChange={(e) => editProfile(group, key, type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} /></Field>;
  const profileTags = (label, group, key, placeholder) => <div key={key} className="space-y-2"><div className="text-sm font-medium">{label}</div><Tags label={label} value={group ? profile[group][key] : profile[key]} placeholder={placeholder} onChange={(v) => editProfile(group, key, v)} /></div>;
  const profileArea = (label, group, key, placeholder) => <Field key={key} label={label}><Textarea rows={3} placeholder={placeholder} value={(group ? profile[group][key] : profile[key]) || ''} onChange={(e) => editProfile(group, key, e.target.value)} /></Field>;
  const changeProvider = (id, patch) => updateProviders(providersRef.current.map((p) => p.id === id ? { ...p, ...patch } : p));
  const providerOperation = (prov, kind) => action(async () => {
    if (kind === 'test') { const valid = validateProvider(prov); if (!valid.ok) { setResults((r) => ({ ...r, [prov.id]: '配置有误：' + valid.errors.join('；') })); return; } }
    setResults((r) => ({ ...r, [prov.id]: kind === 'test' ? '测试中…' : '拉取模型中…' }));
    try {
      const result = await send(kind === 'test' ? MSG.AI_PROVIDER_TEST : MSG.AI_PROVIDER_MODELS, { provider: prov });
      if (kind === 'test') setResults((r) => ({ ...r, [prov.id]: `${result.ok ? '✓' : '✕'} ${result.message}${result.sample ? `（模型回复：${result.sample}）` : ''}` }));
      else { changeProvider(prov.id, { discoveredModels: result }); setResults((r) => ({ ...r, [prov.id]: `✓ 发现 ${result.length} 个模型，已填入模型候选` })); }
    } catch (e) { setResults((r) => ({ ...r, [prov.id]: `✕ ${e.message}${kind === 'models' ? '（部分供应商不支持列模型，可手动填写模型 ID）' : ''}` })); }
  });
  const exportData = (format) => action(async () => { const res = await send(MSG.JOB_EXPORT_REQUEST, { format }); const url = URL.createObjectURL(new Blob([res.content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' })); try { await chrome.downloads.download({ url, filename: `岗位收录-${new Date().toISOString().slice(0, 10)}.${format}`, saveAs: true }); report(`已导出 ${res.count} 个岗位`); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); } });

  if (!settings || !profile) return <div className="p-8 text-foreground" role="status">{notice?.message || '正在加载设置…'}</div>;
  const score = scoreProfile(profile);
  const f = settings.filters;
  const filterTags = (label, key, placeholder) => <div className="space-y-2"><div className="text-sm font-medium">{label}</div><Tags label={label} value={f[key]} placeholder={placeholder} onChange={(v) => updateSettings({ filters: { [key]: v } })} /></div>;
  return <div className="min-h-screen bg-background text-foreground"><div className="mx-auto max-w-6xl p-4 sm:p-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold">岗位筛选助手 · 设置</h1><p className="text-sm text-muted-foreground">BOSS直聘 · 前程无忧。数据保存在本机；AI 操作会发送相关内容至所配置的服务。</p></header>
    {notice && <div role="status" className={`mb-4 rounded-md border p-3 text-sm ${notice.error ? 'text-destructive' : 'text-foreground'}`}>{notice.message}<button className="float-right" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
    <div inert={busy ? true : undefined}><Tabs defaultValue="profile"><TabsList className="mb-6 flex h-auto flex-wrap"><TabsTrigger value="profile">个人画像</TabsTrigger><TabsTrigger value="ai">AI 接口</TabsTrigger><TabsTrigger value="filters">岗位筛选</TabsTrigger><TabsTrigger value="general">通用与隐私</TabsTrigger></TabsList>
      <TabsContent value="profile" className="space-y-4">
        <Panel title="个人画像" description="上传简历自动抽取，或手动填写。画像越完整，AI 匹配越准。"><div className="flex flex-wrap items-center gap-4"><Badge variant="secondary" className="text-lg">{score.score}%</Badge><div><div className="font-medium">完整度 {score.completed}/{score.total} 项</div><p className="text-sm text-muted-foreground">{score.missing.length ? '待补充：' + score.missing.join('、') : '画像已相当完整'}</p></div></div></Panel>
        <Panel title="导入个人材料" description="可多选 Markdown / TXT，先在本机预览，再选择发送给当前 AI 抽取；也可直接导入画像 JSON，完全在本机处理。确认后才保存，合并会保留已有设置。">
          <Input type="file" aria-label="选择个人材料" accept=".md,.markdown,.txt,.json" multiple onChange={(e) => readMaterials(e.target.files)} />
          {materials.map((m, i) => <Field key={`${m.name}-${i}`} label={`${m.name}（${m.text.length} 字符）`}><Textarea rows={6} readOnly value={m.text} /></Field>)}
          {!!materials.length && (/\.json$/i.test(materials[0].name) ? <Button onClick={() => action(async () => setDraft(sanitizeProfile(JSON.parse(materials[0].text))))}>预览画像草稿</Button> : <Button onClick={extractMaterials}>发送材料给 AI 并抽取</Button>)}
        </Panel>
        <Panel title="上传简历，AI 自动填写" description="支持 PDF、DOCX、TXT。文件在本机解析；使用 AI 抽取时文本会发送至你配置的服务。抽取后需确认才写入画像。">
          <input ref={fileRef} className="hidden" type="file" accept=".pdf,.docx,.txt,.md,.json" onChange={(e) => { if (e.target.files[0]) resumeFile(e.target.files[0]); e.target.value = ''; }} />
          <div className="rounded-md border border-dashed p-6 text-center" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) resumeFile(e.dataTransfer.files[0]); }}><Button variant="outline" onClick={() => fileRef.current?.click()}>选择简历文件</Button><p className="mt-2 text-sm text-muted-foreground">也可拖拽文件到此处 · PDF / DOCX / TXT</p></div>
          <Textarea aria-label="简历文本" rows={4} placeholder="或在此粘贴简历文本…" value={paste} onChange={(e) => setPaste(e.target.value)} /><Button onClick={() => paste.trim() ? extract(paste.trim()) : report('请先粘贴简历文本', true)}>从文本抽取画像</Button>
          {draft && <div className="space-y-3 rounded-md border p-4"><h3 className="font-semibold">画像草稿（请核对后合并）</h3><p className="text-sm text-muted-foreground">合并时数组去重、保留已有单值，工作概述、项目概述和备注会追加新内容；可在下方手动编辑。</p><DraftPreview draft={draft} /><div className="flex flex-wrap gap-2"><Button onClick={() => applyDraft(false)}>合并到画像</Button><Button variant="outline" onClick={() => applyDraft(true)}>替换现有画像</Button><Button variant="ghost" onClick={() => setDraft(null)}>放弃</Button></div></div>}
        </Panel>
        <Panel title="手动编辑（自动保存）">
          <h3 className="font-semibold">求职目标</h3>{profileTags('目标岗位', 'target', 'jobTitles', '回车添加，如 前端工程师')}{profileTags('目标城市', 'target', 'cities', '如 广州')}<div className="grid gap-4 sm:grid-cols-3">{profileText('期望月薪下限(k)', 'target', 'salaryMinK', 'number', '如 15')}{profileText('期望月薪上限(k)', 'target', 'salaryMaxK', 'number', '如 25')}{profileText('工作年限', 'basics', 'yearsOfExperience', 'number', '如 3')}</div>{profileTags('目标行业', 'target', 'industries', '如 互联网')}{profileTags('期望公司规模', 'target', 'companySizes', '如 100-499人')}{profileTags('办公方式', 'target', 'workModes', '如 远程')}
          <h3 className="font-semibold">个人基础</h3><div className="grid gap-4 sm:grid-cols-2">{profileText('最高学历', 'basics', 'education', 'text', '如 本科')}{profileText('当前/最近职位', 'basics', 'currentTitle', 'text', '如 高级前端')}</div>{profileText('姓名（仅本地展示，默认不发送给 AI）', 'basics', 'name', 'text', '可留空')}
          <h3 className="font-semibold">能力与经历</h3>{profileTags('专业技能', 'capabilities', 'skills', '如 React、TypeScript')}{profileTags('优势亮点', 'capabilities', 'strengths', '一句一条')}{profileTags('行业经验', 'capabilities', 'industryExperience', '如 电商、金融')}{profileArea('工作经历概述', null, 'workSummary', '一段话概述工作经历')}{profileArea('项目经历概述', null, 'projectSummary', '代表性项目')}{profileTags('核心成就', null, 'highlights', '可量化的成果，一条一个')}
          <h3 className="font-semibold">偏好与禁区</h3>{profileTags('规避关键词', 'preference', 'avoidKeywords', '如 外包、驻场')}{profileTags('硬性排除', 'preference', 'dealbreakers', '如 需要出差')}{profileArea('给 AI 的额外说明', 'preference', 'notes', '任何想让 AI 知道的补充')}
        </Panel>
        <Panel title="一键清除画像" description="清空全部画像字段，并使已有匹配分缓存失效。不可撤销。"><Button variant="destructive" onClick={() => setConfirm({ title: '清除个人画像？', body: '将清空全部画像字段，并使已生成的岗位匹配分缓存失效。此操作不可撤销。', run: async () => { await flush('profile'); const p = await send(MSG.PROFILE_CLEAR); profileRef.current = p; setProfile(p); report('画像已清除'); } })}>清除画像</Button></Panel>
      </TabsContent>
      <TabsContent value="ai" className="space-y-4"><Panel title="添加供应商" description="兼容 OpenAI / Anthropic / Gemini 等主流协议，可接入任意兼容供应商或本地模型。选择预设或自定义供应商。"><div className="flex flex-wrap gap-2"><div className="min-w-64 flex-1"><Choice label="供应商预设" value={preset} onValueChange={setPreset} options={PRESETS.map((p) => [p.key, p.name + (p.hint ? ` — ${p.hint}` : '')])} /></div><Button onClick={() => action(async () => { const p = providerFromPreset(preset); updateProviders([...providersRef.current, p]); await flush('providers'); if (!settingsRef.current.activeProviderId) { updateSettings({ activeProviderId: p.id }); await flush('settings'); } report('已添加，请填写 API Key 与模型'); })}>添加</Button></div></Panel>
        {!providers.length && <p className="p-6 text-center text-muted-foreground">还没有配置任何 AI 供应商</p>}
        {providers.map((p) => <ProviderCard key={p.id} provider={p} active={settings.activeProviderId === p.id} result={results[p.id]} onChange={(patch) => changeProvider(p.id, patch)} onTest={() => providerOperation(p, 'test')} onModels={() => providerOperation(p, 'models')} onActivate={() => { updateSettings({ activeProviderId: p.id }); report('已设为当前启用'); }} onDelete={() => action(async () => { updateProviders(providersRef.current.filter((x) => x.id !== p.id)); await flush('providers'); if (settingsRef.current.activeProviderId === p.id) { updateSettings({ activeProviderId: providersRef.current[0]?.id || '' }); await flush('settings'); } report('已删除'); })} />)}
      </TabsContent>
      <TabsContent value="filters" className="space-y-4"><Panel title="岗位筛选" description="本地规则先过一遍（不消耗 AI）。命中排除词或不满足条件的岗位不进入列表。"><ToggleRow label="启用本地筛选" description="关闭时收录全部岗位，仅标注风险词" checked={f.enabled} onChange={(v) => updateSettings({ filters: { enabled: v } })} /></Panel><Panel title="关键词">{filterTags('包含关键词（配置后须命中任一）', 'keywordsInclude', '如 前端、React')}{filterTags('排除关键词（命中即剔除）', 'keywordsExclude', '如 电销、催收')}{filterTags('风险词（仅标注不剔除）', 'riskKeywords', '如 外包、驻场')}{filterTags('屏蔽公司（公司名含即剔除）', 'excludeCompanies', '公司名关键词')}</Panel><Panel title="条件">{filterTags('城市（含任一即保留）', 'cities', '如 广州、深圳')}<div className="grid gap-4 sm:grid-cols-2">{[['salaryMinK', '薪资下限(k/月)', '如 12'], ['salaryMaxK', '薪资上限(k/月)', '如 30']].map(([key, label, ph]) => <Field key={key} label={label}><Input type="number" placeholder={ph} value={f[key] ?? ''} onChange={(e) => updateSettings({ filters: { [key]: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>)}</div>{filterTags('经验偏好（软提示）', 'experience', '如 1-3年')}{filterTags('学历偏好（软提示）', 'degrees', '如 本科')}</Panel></TabsContent>
      <TabsContent value="general" className="space-y-4"><Panel title="运行模式" description="自动 = 跟随当前站点；也可锁定只看某个平台。"><Choice label="运行模式" value={settings.mode} onValueChange={(mode) => updateSettings({ mode })} options={[[MODE.auto, '自动'], [MODE.boss, 'BOSS 直聘'], [MODE.qcwy, '前程无忧']]} /></Panel><Panel title="抓取与分析">{[['autoCapture', '自动收录岗位', '浏览列表时自动抓取'], ['autoScore', '自动 AI 分析', '新收录岗位自动打分（消耗 token）'], ['showBadge', '列表内显示角标', '页面右下角显示收录状态'], ['dedupe', '去重', '相同岗位只保留一条']].map(([key, label, desc]) => <ToggleRow key={key} label={label} description={desc} checked={settings[key]} onChange={(v) => updateSettings({ [key]: v })} />)}<Field label="岗位库上限（超出按时间淘汰，收藏不淘汰）"><Input type="number" value={settings.maxJobs} onChange={(e) => updateSettings({ maxJobs: Number(e.target.value) || 800 })} /></Field></Panel><Panel title="隐私" description="API Key 和数据保存在本机；使用 AI 时相关内容会发送至所配置的服务。脱敏无法保证移除所有个人信息。"><ToggleRow label="发送前脱敏" description="隐去手机号、邮箱、联系方式、个人链接等" checked={settings.privacy.redactPII} onChange={(v) => updateSettings({ privacy: { redactPII: v } })} /><ToggleRow label="发送岗位公司名" description="公司名一般为公开招聘信息，发送可提升分析质量" checked={settings.privacy.sendCompanyName} onChange={(v) => updateSettings({ privacy: { sendCompanyName: v } })} /><ToggleRow label="发送前确认" description="发送招呼语前再次确认" checked={settings.privacy.confirmBeforeSend} onChange={(v) => updateSettings({ privacy: { confirmBeforeSend: v } })} /></Panel><Panel title="数据"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportData('json')}>导出岗位 (JSON)</Button><Button variant="outline" onClick={() => exportData('csv')}>导出岗位 (CSV)</Button><Button variant="destructive" onClick={() => setConfirm({ title: '清空岗位库？', body: '删除全部已收录岗位，不可撤销。', run: async () => { await send(MSG.JOB_CLEAR_REQUEST); report('已清空'); } })}>清空岗位库</Button></div></Panel><UpdatePanel onConfirm={setConfirm} /></TabsContent>
    </Tabs></div>
    <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.body}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button variant="destructive" disabled={!!busy} onClick={() => action(async () => { setBusy('正在处理…'); try { await confirm.run(); setConfirm(null); } finally { setBusy(''); } })}>确认</Button></DialogFooter></DialogContent></Dialog>
    {busy && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" role="status" aria-live="polite"><Card><CardContent className="p-6">{busy}</CardContent></Card></div>}
  </div></div>;
}

function DraftPreview({ draft: d }) {
  const rows = [['目标岗位', d.target.jobTitles], ['目标城市', d.target.cities], ['期望薪资', d.target.salaryMinK || d.target.salaryMaxK ? `${d.target.salaryMinK ?? ''}-${d.target.salaryMaxK ?? ''}k` : ''], ['工作年限', d.basics.yearsOfExperience != null ? `${d.basics.yearsOfExperience} 年` : ''], ['姓名', d.basics.name], ['目标行业', d.target.industries], ['公司规模', d.target.companySizes], ['办公方式', d.target.workModes], ['学历', d.basics.education], ['当前职位', d.basics.currentTitle], ['技能', d.capabilities.skills], ['优势', d.capabilities.strengths], ['行业经验', d.capabilities.industryExperience], ['工作概述', d.workSummary], ['项目概述', d.projectSummary], ['核心成就', d.highlights], ['规避关键词', d.preference.avoidKeywords], ['硬性排除', d.preference.dealbreakers], ['给 AI 的说明', d.preference.notes]];
  return <dl className="space-y-1 text-sm">{rows.filter(([, v]) => v && v.length).map(([label, value]) => <div key={label} className="whitespace-pre-wrap"><dt className="inline font-medium">{label}：</dt><dd className="inline">{Array.isArray(value) ? value.join('、') : value}</dd></div>)}</dl>;
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
