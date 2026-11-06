import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MSG } from '../../common/constants.js';
import { scoreProfile, sanitizeProfile } from '../../common/profile.js';
import { applyProfileDraft, assertNonEmptyText, combineMaterialExtracts, parseProfileJson, planJsonFile, planResumeFiles } from '../../common/profileImport.js';
import { send } from '../../extension/messages.js';
import { parseResumeFile } from '../../extension/resumeParser.js';
import type { AIProvider, Profile, Settings } from '../../common/types.js';
import { useSaveQueue } from './useSaveQueue.js';
import { useInitialSettings } from './useInitialSettings.js';
import { useSettingsHash } from './useSettingsHash.js';
import SettingsShell, { ProfileRail, extensionVersion } from './SettingsShell.js';
import { SETTINGS_PAGES, isChangelogHash, pageFromHash } from './pageHash.js';
import ProfileTab from './ProfileTab.js';
import AiTab from './AiTab.js';
import FiltersTab from './FiltersTab.js';
import GeneralTab from './GeneralTab.js';
import type { ConfirmRequest, Notification, SettingsPatch } from './types.js';
import './shell.css';

type ImportMode = 'resume' | 'paste' | 'json';

interface ExportResult {
  content: string;
  count: number;
}

export default function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const settingsRef = useRef<Settings | null>(null), providersRef = useRef<AIProvider[]>([]), profileRef = useRef<Profile | null>(null);
  const pendingSettings = useRef<SettingsPatch>({});
  const [draft, setDraft] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<Notification | null>(null), [busy, setBusy] = useState(''), [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const report = useCallback((message: string | null, error = false) => {
    if (message == null) {
      setNotice((current) => (current?.error ? null : current));
      return;
    }
    setNotice({ message, error: !!error });
  }, []);
  const { enqueue, flush, retry, status } = useSaveQueue(report);
  const { page, hash } = useSettingsHash();
  const [updateCheckToken, setUpdateCheckToken] = useState(0);
  const requestUpdateCheck = useCallback(() => {
    // #updated 的 page 已是 general，这里不能改写它。日志页的 page 会落到画像，必须先离开。
    if (isChangelogHash(location.hash) || pageFromHash(location.hash) !== 'general') location.hash = '#general';
    setUpdateCheckToken((n) => n + 1);
  }, []);
  useInitialSettings({ settingsRef, providersRef, profileRef, setSettings, setProviders, setProfile, report });
  const updateSettings = (patch: SettingsPatch) => {
    const old = settingsRef.current;
    if (!old) return;
    const next: Settings = { ...old, ...patch, filters: { ...old.filters, ...patch.filters }, privacy: { ...old.privacy, ...patch.privacy } };
    settingsRef.current = next; setSettings(next);
    const pending = pendingSettings.current;
    const queued: SettingsPatch = { ...pending, ...patch };
    if (pending.filters || patch.filters) queued.filters = { ...pending.filters, ...patch.filters };
    if (pending.privacy || patch.privacy) queued.privacy = { ...pending.privacy, ...patch.privacy };
    pendingSettings.current = queued;
    enqueue('settings', async () => {
      const changes = pendingSettings.current;
      pendingSettings.current = {};
      try {
        await send(MSG.SETTINGS_SAVE, { patch: changes });
      } catch (e) {
        const newer = pendingSettings.current;
        const merged: SettingsPatch = { ...changes, ...newer };
        if (changes.filters || newer.filters) merged.filters = { ...changes.filters, ...newer.filters };
        if (changes.privacy || newer.privacy) merged.privacy = { ...changes.privacy, ...newer.privacy };
        pendingSettings.current = merged;
        throw e;
      }
    }, 200);
  };
  const updateProfile = (next: Profile) => { profileRef.current = next; setProfile(next); enqueue('profile', () => send(MSG.PROFILE_SAVE, { profile: next }), 600); };
  const updateProviders = (next: AIProvider[]) => { providersRef.current = next; setProviders(next); enqueue('providers', () => send(MSG.AI_PROVIDERS_SAVE, { providers: next }), 500); };
  const action = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { report(e instanceof Error ? e.message : String(e), true); } };
  const withBusy = async (text: string, fn: () => Promise<void>) => { setBusy(text); try { await fn(); } catch (e) { report(e instanceof Error ? e.message : String(e), true); } finally { setBusy(''); } };
  const prepareAI = async () => { await flush('providers'); await flush('settings'); };
  const extract = (text: string) => withBusy('AI 正在抽取画像…', async () => { await prepareAI(); setDraft(sanitizeProfile(await send(MSG.AI_RESUME_EXTRACT, { text }))); report('抽取完成，请确认'); });
  const importProfileFiles = (files: File[], mode: ImportMode) => withBusy(mode === 'json' ? '正在读取画像…' : '正在解析简历文件…', async () => {
    if (mode === 'json') {
      const file = planJsonFile(files);
      if (!file) return;
      const text = await (file as File).text();
      assertNonEmptyText(file.name, text);
      setDraft(sanitizeProfile(parseProfileJson(text)));
      report('已读取画像草稿，请确认');
      return;
    }
    const plan = planResumeFiles(files);
    if (plan.kind === 'empty') return;
    if (plan.kind === 'resume') {
      const file = plan.files[0] as File;
      const { text } = await parseResumeFile(file);
      assertNonEmptyText(file.name, text);
      setBusy('AI 正在抽取画像…');
      await prepareAI();
      setDraft(sanitizeProfile(await send(MSG.AI_RESUME_EXTRACT, { text })));
      report('抽取完成，请确认');
      return;
    }
    const items = await Promise.all(plan.files.map(async (file) => ({ name: file.name, text: await (file as File).text() })));
    setBusy('AI 正在逐段抽取画像…');
    await prepareAI();
    setDraft(await combineMaterialExtracts(items, (text) => send(MSG.AI_RESUME_EXTRACT, { text })));
    report('抽取完成，请核对事实和贡献边界');
  });
  const applyDraft = (replace: boolean) => withBusy('正在保存画像…', async () => {
    await flush('profile');
    const next = await send<Profile>(MSG.PROFILE_SAVE, { profile: applyProfileDraft(profileRef.current, draft, replace) });
    profileRef.current = next; setProfile(next); setDraft(null); report(replace ? '已替换并保存' : '已合并并保存');
  });
  const editProfile = (group: 'target' | 'basics' | 'capabilities' | 'preference' | null, key: string, value: unknown) => {
    const current = profileRef.current;
    if (!current) return;
    updateProfile(group ? { ...current, [group]: { ...current[group], [key]: value } } : { ...current, [key]: value });
  };
  const requestClearProfile = () => setConfirm({ title: '清除个人画像？', body: '将清空全部画像字段，并使已生成的岗位匹配分缓存失效。此操作不可撤销。', run: async () => { await flush('profile'); const p = await send<Profile>(MSG.PROFILE_CLEAR); profileRef.current = p; setProfile(p); report('画像已清除'); } });
  const exportData = (format: string) => action(async () => {
    const res = await send<ExportResult>(MSG.JOB_EXPORT_REQUEST, { format });
    const log = format === 'capture-log';
    const ext = format === 'csv' ? 'csv' : 'json';
    const filename = log ? `补抓日志-${new Date().toISOString().slice(0, 10)}.json` : `岗位收录-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const url = URL.createObjectURL(new Blob([res.content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
    try {
      await chrome.downloads.download({ url, filename, saveAs: true });
      report(log ? `已导出 ${res.count} 条补抓记录` : `已导出 ${res.count} 个岗位`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  if (!settings || !profile) {
    return <div className="settings-loading" role={notice?.error ? 'alert' : 'status'}>{notice?.message || '正在加载设置…'}</div>;
  }
  const score = scoreProfile(profile);
  const title = SETTINGS_PAGES.find((item) => item.id === page)?.label || '个人画像';
  return <>
    <SettingsShell page={page} hash={hash} title={title} status={status} onRetry={retry} version={extensionVersion()} updateChannel={settings.updateChannel} onCheckUpdate={requestUpdateCheck} notice={notice} onDismissNotice={() => setNotice(null)} busy={busy} rail={page === 'profile' ? <ProfileRail score={score} /> : null}>
      <Tabs value={page} onValueChange={(next: string) => { if (next && location.hash !== `#${next}`) location.hash = `#${next}`; }}>
        <ProfileTab profile={profile} draft={draft} report={report} onEdit={editProfile} onImportFiles={importProfileFiles} onExtractText={extract} onApplyDraft={applyDraft} onDiscardDraft={() => setDraft(null)} onClear={requestClearProfile} />
        <AiTab {...{ action, updateProviders, providersRef, flush, settingsRef, updateSettings, report, providers, settings, setConfirm }} />
        <FiltersTab settings={settings} updateSettings={updateSettings} />
        <GeneralTab {...{ settings, updateSettings, exportData, setConfirm, report }} updateCheckToken={updateCheckToken} />
      </Tabs>
    </SettingsShell>
    <Dialog open={!!confirm} onOpenChange={(open: boolean) => { if (!open) setConfirm(null); }}><DialogContent><DialogHeader><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.body}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>取消</Button><Button variant="destructive" disabled={!!busy} onClick={() => action(async () => { setBusy('正在处理…'); try { await confirm?.run(); setConfirm(null); } finally { setBusy(''); } })}>确认</Button></DialogFooter></DialogContent></Dialog>
    {busy && <div className="settings-busy" role="status" aria-live="polite"><p>{busy}</p></div>}
  </>;
}
