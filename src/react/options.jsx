import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MSG } from '../common/constants.js';
import { emptyProfile, scoreProfile, sanitizeProfile, mergeDraft } from '../common/profile.js';
import { PRESETS, validateProvider } from '../common/ai/providers.js';
import { send } from '../ui/ui-common.js';
import { parseResumeFile } from '../ui/resumeParser.js';
import { Field, Tags } from './settings/controls.jsx';
import { useSaveQueue } from './settings/useSaveQueue.js';
import { useInitialSettings } from './settings/useInitialSettings.js';
import ProfileTab from './settings/ProfileTab.jsx';
import AiTab from './settings/AiTab.jsx';
import FiltersTab from './settings/FiltersTab.jsx';
import GeneralTab from './settings/GeneralTab.jsx';

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
  useInitialSettings({ settingsRef, providersRef, profileRef, setSettings, setProviders, setProfile, report });
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
  return <div className="min-h-screen bg-background text-foreground"><div className="mx-auto max-w-6xl p-4 sm:p-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold">岗位筛选助手 · 设置</h1><p className="text-sm text-muted-foreground">BOSS直聘 · 前程无忧。数据保存在本机；AI 操作会发送相关内容至所配置的服务。</p></header>
    {notice && <div role="status" className={`mb-4 rounded-md border p-3 text-sm ${notice.error ? 'text-destructive' : 'text-foreground'}`}>{notice.message}<button className="float-right" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
    <div inert={busy ? true : undefined}><Tabs defaultValue="profile"><TabsList className="mb-6 flex h-auto flex-wrap"><TabsTrigger value="profile">个人画像</TabsTrigger><TabsTrigger value="ai">AI 接口</TabsTrigger><TabsTrigger value="filters">岗位筛选</TabsTrigger><TabsTrigger value="general">通用与隐私</TabsTrigger></TabsList>
      <ProfileTab {...{ score, materials, readMaterials, action, setDraft, extractMaterials, fileRef, resumeFile, paste, setPaste, extract, report, draft, applyDraft, profileTags, profileText, profileArea, setConfirm, flush, profileRef, setProfile }} />
      <AiTab {...{ preset, setPreset, action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, results, changeProvider, providerOperation }} />
      <FiltersTab settings={settings} updateSettings={updateSettings} />
      <GeneralTab {...{ settings, updateSettings, exportData, setConfirm, report }} />
    </Tabs></div>
    <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.body}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button variant="destructive" disabled={!!busy} onClick={() => action(async () => { setBusy('正在处理…'); try { await confirm.run(); setConfirm(null); } finally { setBusy(''); } })}>确认</Button></DialogFooter></DialogContent></Dialog>
    {busy && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" role="status" aria-live="polite"><Card><CardContent className="p-6">{busy}</CardContent></Card></div>}
  </div></div>;
}
