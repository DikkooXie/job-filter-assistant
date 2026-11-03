import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MSG, MODE } from '../common/constants.js';
import { send } from '../ui/ui-common.js';
import { runningDevBuild } from '../common/build.js';

export default function Popup() {
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [context, setContext] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([send(MSG.SETTINGS_GET), send(MSG.JOB_LIST_REQUEST), send(MSG.ACTIVE_CONTEXT_REQUEST)])
      .then(([nextSettings, nextJobs, nextContext]) => { setSettings(nextSettings); setJobs(nextJobs); setContext(nextContext || {}); })
      .catch((err) => setError(`后台未就绪，请重载扩展：${err.message}`));
  }, []);

  async function update(patch) {
    setSaving(true);
    setError('');
    try { setSettings(await send(MSG.SETTINGS_SAVE, { patch })); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function openPanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.windowId == null) throw new Error('未找到当前窗口');
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    } catch { setError('无法打开侧边栏，请点击工具栏图标后重试'); }
  }

  const scored = jobs.filter((job) => job.match).length;
  const strong = jobs.filter((job) => ['strong', 'good'].includes(job.match?.verdict)).length;
  return <main className="w-[340px] max-w-full p-4 flex flex-col gap-4">
    <header className="flex flex-col gap-1"><h1 className="flex items-center gap-2 text-base font-semibold">岗位筛选助手{runningDevBuild() && <span className="rounded border border-border px-1 text-[10px] font-medium leading-4 text-muted-foreground">dev</span>}</h1><p className="text-xs text-muted-foreground">BOSS直聘 · 前程无忧</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!settings ? <p className="text-sm text-muted-foreground">{error ? '请重新打开扩展。' : '正在加载…'}</p> : <>
      <p className="text-sm text-muted-foreground">{context.platform ? `当前：${context.platformName}（正在监听）` : '当前不在招聘站点'}</p>
      <Tabs value={settings.mode} onValueChange={(mode) => update({ mode })}>
        <TabsList className="w-full"><TabsTrigger value={MODE.auto} disabled={saving}>自动</TabsTrigger><TabsTrigger value={MODE.boss} disabled={saving}>BOSS</TabsTrigger><TabsTrigger value={MODE.qcwy} disabled={saving}>51job</TabsTrigger></TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-3 border-y py-3">
        {[[jobs.length, '已收录岗位'], [scored, '已 AI 分析'], ...(scored ? [[strong, '较匹配以上'], [jobs.filter((job) => job.star).length, '已收藏']] : [])].map(([value, label]) => <div key={label} className="flex flex-col gap-1"><span className="text-lg font-semibold tabular-nums">{value}</span><span className="text-xs text-muted-foreground">{label}</span></div>)}
      </div>
      {[[ 'autoCapture', '自动收录', '浏览时抓取岗位' ], [ 'autoScore', '自动分析', '收录后自动 AI 打分（耗 token）' ]].map(([key, label, description]) => <div className="flex items-center justify-between gap-4" key={key}><div className="flex flex-col gap-1"><label htmlFor={key} className="text-sm font-medium">{label}</label><p className="text-xs text-muted-foreground">{description}</p></div><Switch id={key} checked={!!settings[key]} disabled={saving} onCheckedChange={(value) => update({ [key]: value })} /></div>)}
      <div className="flex flex-col gap-2"><Button onClick={openPanel}>打开岗位面板</Button><Button variant="outline" onClick={() => send(MSG.OPEN_OPTIONS).then(() => window.close()).catch((err) => setError(err.message))}>画像与设置</Button></div>
    </>}
  </main>;
}
