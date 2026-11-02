import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MSG } from '../common/constants.js';
import { emptyProfile, scoreProfile, sanitizeProfile, mergeDraft } from '../common/profile.js';
import { send } from '../ui/ui-common.js';
import { parseResumeFile } from '../ui/resumeParser.js';
import { Field, Tags } from './settings/controls.jsx';
import { useSaveQueue } from './settings/useSaveQueue.js';
import { useInitialSettings } from './settings/useInitialSettings.js';
import { useSettingsHash } from './settings/useSettingsHash.js';
import SettingsShell, { ProfileRail, extensionVersion } from './settings/SettingsShell.jsx';
import { SETTINGS_PAGES } from './settings/pageHash.js';
import ProfileTab from './settings/ProfileTab.jsx';
import AiTab from './settings/AiTab.jsx';
import FiltersTab from './settings/FiltersTab.jsx';
import GeneralTab from './settings/GeneralTab.jsx';
import './settings/shell.css';

export default function Options() {
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState([]);
  const [profile, setProfile] = useState(null);
  const settingsRef = useRef(null), providersRef = useRef([]), profileRef = useRef(null);
  const pendingSettings = useRef({});
  const [draft, setDraft] = useState(null), [materials, setMaterials] = useState([]), [paste, setPaste] = useState('');
  const [notice, setNotice] = useState(null), [busy, setBusy] = useState(''), [confirm, setConfirm] = useState(null);
  const fileRef = useRef(null);
  const report = useCallback((message, error = false) => {
    if (message == null) {
      setNotice((current) => (current?.error ? null : current));
      return;
    }
    setNotice({ message, error: !!error });
  }, []);
  const { enqueue, flush, retry, status } = useSaveQueue(report);
  const { page } = useSettingsHash();
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
  const exportData = (format) => action(async () => { const res = await send(MSG.JOB_EXPORT_REQUEST, { format }); const url = URL.createObjectURL(new Blob([res.content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' })); try { await chrome.downloads.download({ url, filename: `岗位收录-${new Date().toISOString().slice(0, 10)}.${format}`, saveAs: true }); report(`已导出 ${res.count} 个岗位`); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); } });

  if (!settings || !profile) {
    return <div className="settings-loading" role={notice?.error ? 'alert' : 'status'}>{notice?.message || '正在加载设置…'}</div>;
  }
  const score = scoreProfile(profile);
  const title = SETTINGS_PAGES.find((item) => item.id === page)?.label || '个人画像';
  return <>
    <SettingsShell page={page} title={title} status={status} onRetry={retry} version={extensionVersion()} notice={notice} onDismissNotice={() => setNotice(null)} busy={busy} rail={page === 'profile' ? <ProfileRail score={score} /> : null}>
      <Tabs value={page} onValueChange={(next) => { if (next && location.hash !== `#${next}`) location.hash = `#${next}`; }}>
        <ProfileTab {...{ score, materials, readMaterials, action, setDraft, extractMaterials, fileRef, resumeFile, paste, setPaste, extract, report, draft, applyDraft, profileTags, profileText, profileArea, setConfirm, flush, profileRef, setProfile }} />
        <AiTab {...{ action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, setConfirm }} />
        <FiltersTab settings={settings} updateSettings={updateSettings} />
        <GeneralTab {...{ settings, updateSettings, exportData, setConfirm, report }} />
      </Tabs>
    </SettingsShell>
    <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.body}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button variant="destructive" disabled={!!busy} onClick={() => action(async () => { setBusy('正在处理…'); try { await confirm.run(); setConfirm(null); } finally { setBusy(''); } })}>确认</Button></DialogFooter></DialogContent></Dialog>
    {busy && <div className="settings-busy" role="status" aria-live="polite"><p>{busy}</p></div>}
  </>;
}
