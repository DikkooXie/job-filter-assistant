import React, { useEffect, useReducer, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MSG, MODE } from '../common/constants.js';
import { scoreProfile } from '../common/profile.js';
import { applyFilters } from '../common/filters.js';
import { VERDICT_LABELS, GREETING_LEVELS, normalizeGreetings, DIM_LABELS } from '../common/ai/prompts.js';
import { send } from '../ui/ui-common.js';

const progressLabels = { prepared: '已准备', opened: '已尝试打开沟通', sent: '已发送（手动确认）' };
const progressKey = (uid) => `job-progress-v1:${encodeURIComponent(uid)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const joinList = (value) => Array.isArray(value) ? value.filter(Boolean).join('、') : value == null ? '' : String(value);
const fmtTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
};
const csvCell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;

function buildDetailedCsv(items, progress) {
  const cols = [
    ['平台', (j) => j.platform === 'boss' ? 'BOSS直聘' : '前程无忧51job'],
    ['匹配档次', (j) => j.match ? VERDICT_LABELS[j.match.verdict] || j.match.verdict : '未分析'],
    ['匹配分', (j) => j.match?.score ?? ''], ['是否收藏', (j) => j.star ? '★' : ''],
    ['处理状态', (j) => progressLabels[progress.get(j.uid)?.status] || '未处理'],
    ['状态更新时间', (j) => fmtTime(progress.get(j.uid)?.at)],
    ['岗位名称', (j) => j.title], ['薪资', (j) => j.salaryText],
    ['薪资下限(K/月)', (j) => j.salaryMinK ?? ''], ['薪资上限(K/月)', (j) => j.salaryMaxK ?? ''],
    ['城市', (j) => j.city], ['区域', (j) => j.district], ['工作经验', (j) => j.experience],
    ['学历要求', (j) => j.degree], ['技能', (j) => joinList(j.skills)], ['岗位标签', (j) => joinList(j.tags)],
    ['福利', (j) => joinList(j.welfare)], ['公司名称', (j) => j.company], ['所属行业', (j) => j.companyIndustry],
    ['公司规模', (j) => j.companyScale], ['公司性质', (j) => j.companyType], ['融资阶段', (j) => j.companyStage],
    ['HR', (j) => j.hrName], ['HR职位', (j) => j.hrTitle], ['一句话总评', (j) => j.match?.summary],
    ['契合点', (j) => joinList(j.match?.reasons)], ['差距/需补齐', (j) => joinList(j.match?.gaps)],
    ['风险提示', (j) => joinList(j.match?.risks)],
    ['招呼语(标准版)', (j) => j.greetingDraft || (j.match ? normalizeGreetings(j.match).standard : '')],
    ['岗位描述', (j) => j.description], ['收录时间', (j) => fmtTime(j.savedAt)],
    ['最近出现', (j) => fmtTime(j.lastSeenAt)], ['岗位链接', (j) => j.url],
  ];
  return [cols.map(([label]) => csvCell(label)).join(','), ...items.map((j) => cols.map(([, get]) => csvCell(get(j))).join(','))].join('\r\n');
}

function Tags({ values }) {
  return <div className="flex flex-wrap gap-1">{(values || []).map((value, i) => <Badge variant="secondary" key={`${value}-${i}`}>{value}</Badge>)}</div>;
}
function Facts({ rows }) {
  return <dl className="grid grid-cols-2 gap-2 text-sm">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label} className="flex flex-col gap-1"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Section({ title, children }) {
  return <section className="flex flex-col gap-2"><h3 className="font-semibold">{title}</h3>{children}</section>;
}
function Analysis({ match }) {
  return <div className="flex flex-col gap-3 text-sm">
    {match.summary && <p>{match.summary}</p>}
    {match.eligible === false && match.blockers?.length > 0 && <Section title="存在硬性门槛"><ul className="list-disc pl-5">{match.blockers.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}
    {match.dims && <div className="flex flex-col gap-2">{['skill', 'experience', 'requirement', 'location'].filter((key) => match.dims[key] != null).map((key) => <div className="flex items-center gap-2" key={key}><span className="w-20">{DIM_LABELS[key]}</span><progress className="min-w-0 flex-1 accent-primary" max="100" value={match.dims[key]} aria-label={DIM_LABELS[key]} /><span>{match.dims[key]}</span></div>)}</div>}
    {[["契合点", match.reasons], ["差距/需补齐", match.gaps], ["风险提示", match.risks]].map(([title, values]) => values?.length > 0 && <Section title={title} key={title}><ul className="list-disc pl-5">{values.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>)}
  </div>;
}

/** Standalone sidepanel component. The extension host must mount this component. */
export default function Sidepanel() {
  const [, redraw] = useReducer((x) => x + 1, 0);
  const state = useRef(null);
  if (!state.current) state.current = {
    jobs: [], settings: null, profile: null, providers: [], activeCtx: null, selectedUid: null,
    view: { tab: 'library', sub: 'info', greetLevel: 'standard', search: '', verdict: 'all', sort: 'recent', platform: 'all' },
    scoring: new Set(), tailoring: new Set(), checked: new Set(), progress: new Map(), greetings: new Map(), advice: new Map(),
    saveTimers: new Map(), batchBusy: false, reloadVersion: 0, noticeTimer: null, notice: '', error: false, loading: true,
  };
  const s = state.current;
  const update = () => redraw();
  const notify = (message, error = false) => {
    clearTimeout(s.noticeTimer);
    s.notice = message; s.error = error; update();
    s.noticeTimer = setTimeout(() => { s.notice = ''; update(); }, 2600);
  };
  const setView = (patch) => { Object.assign(s.view, patch); update(); };
  const reload = async () => {
    const version = ++s.reloadVersion;
    try {
      const [jobs, settings, profile, providers, activeCtx] = await Promise.all([
        send(MSG.JOB_LIST_REQUEST), send(MSG.SETTINGS_GET), send(MSG.PROFILE_GET), send(MSG.AI_PROVIDERS_GET), send(MSG.ACTIVE_CONTEXT_REQUEST).catch(() => null),
      ]);
      const keys = jobs.map((j) => progressKey(j.uid));
      const stored = keys.length ? await chrome.storage.local.get(keys) : {};
      if (version !== s.reloadVersion) return;
      const firstLoad = !s.settings;
      Object.assign(s, { jobs, settings, profile, providers, activeCtx, loading: false });
      const jobIds = new Set(jobs.map((j) => j.uid));
      for (const uid of s.progress.keys()) if (!jobIds.has(uid)) s.progress.delete(uid);
      for (const uid of s.checked) if (!jobIds.has(uid)) s.checked.delete(uid);
      jobs.forEach((j) => {
        const value = stored[progressKey(j.uid)];
        const current = s.progress.get(j.uid);
        if (value && progressLabels[value.status] && (!current || value.at >= current.at)) s.progress.set(j.uid, value);
      });
      if (firstLoad && settings.mode !== MODE.auto) s.view.platform = settings.mode;
      update();
    } catch (e) { if (version === s.reloadVersion) { s.loading = false; notify(e.message, true); } }
  };
  const refreshContext = async () => { s.activeCtx = await send(MSG.ACTIVE_CONTEXT_REQUEST).catch(() => null); update(); };
  useEffect(() => {
    reload();
    const listener = (msg) => {
      if (msg?.type === MSG.JOBS_UPDATED) reload();
      else if (msg?.type === MSG.CURRENT_JOB) { s.selectedUid = null; refreshContext(); }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      s.reloadVersion++;
      clearTimeout(s.noticeTimer);
      for (const [uid, timer] of s.saveTimers) { clearTimeout(timer); send(MSG.GREETING_SAVE, { uid, text: s.greetings.get(uid) || '' }).catch(() => {}); }
      s.saveTimers.clear();
    };
  }, []);
  const saveGreeting = (uid, text, delayed = false) => {
    clearTimeout(s.saveTimers.get(uid));
    s.saveTimers.delete(uid);
    const save = () => { s.saveTimers.delete(uid); send(MSG.GREETING_SAVE, { uid, text }).catch(() => {}); };
    if (delayed) s.saveTimers.set(uid, setTimeout(save, 500)); else save();
  };
  const greetingValue = (job) => s.greetings.has(job.uid) ? s.greetings.get(job.uid) : job.greetingDraft || normalizeGreetings(job.match || {})[s.view.greetLevel] || '';
  const setProgress = async (uid, status) => {
    const value = { status, at: new Date().toISOString() };
    await chrome.storage.local.set({ [progressKey(uid)]: value });
    s.progress.set(uid, value);
  };
  const analyze = async (job, force = true) => {
    if (s.scoring.has(job.uid)) return false;
    if (!s.providers.length) { notify('请先在设置中配置 AI 接口', true); send(MSG.OPEN_OPTIONS); return false; }
    s.scoring.add(job.uid); update();
    try { await send(MSG.AI_MATCH_SCORE, { uid: job.uid, job, force }); s.jobs = await send(MSG.JOB_LIST_REQUEST); notify('分析完成'); return true; }
    catch (e) { notify(e.message, true); return false; }
    finally { s.scoring.delete(job.uid); update(); }
  };
  const tailor = async (job) => {
    if (s.tailoring.has(job.uid)) return;
    s.tailoring.add(job.uid); update();
    try { s.advice.set(job.uid, await send(MSG.AI_TAILOR_RESUME, { uid: job.uid, job })); notify('简历建议已生成'); }
    catch (e) { notify(`生成失败：${e.message}`, true); }
    finally { s.tailoring.delete(job.uid); update(); }
  };
  const copyText = async (text) => { try { await navigator.clipboard.writeText(text); notify('已复制'); } catch { notify('复制失败', true); } };
  const sendGreeting = async (job) => {
    const text = greetingValue(job).trim();
    if (!text) { notify('招呼语为空', true); return; }
    if (s.settings.privacy?.confirmBeforeSend && !confirm(`确认打开 ${job.company || '该招聘方'} 的岗位并尝试进入沟通？\n招呼语将复制，请核对会话后手动发送。\n\n${text}`)) return;
    s.greetings.set(job.uid, text); saveGreeting(job.uid, text);
    try { await navigator.clipboard.writeText(text); } catch { notify('复制失败，请先手动复制招呼语', true); return; }
    if (!job.url) { notify('招呼语已复制，该岗位没有可打开的链接，请手动打开岗位页粘贴发送', true); return; }
    try {
      const result = await send(MSG.OPEN_JOB_CHAT, { url: job.url, platform: job.platform, text });
      if (result?.mode === 'navigating') { if (s.progress.get(job.uid)?.status !== 'sent') await setProgress(job.uid, 'opened'); notify('已尝试打开沟通；请核对招聘方后粘贴并发送'); }
      else notify(`已打开岗位，未确认进入沟通；请核对后粘贴发送${result?.note ? `（${result.note}）` : ''}`, true);
    } catch (e) { notify(`招呼语已复制，请手动打开岗位页粘贴发送（${e.message}）`, true); }
  };
  const batchAnalyze = async (list, recordPrepared = false) => {
    if (s.batchBusy || !list.length) return;
    if (!s.providers.length) { notify('请先在设置中配置 AI 接口', true); send(MSG.OPEN_OPTIONS); return; }
    s.batchBusy = true;
    const uids = list.map((j) => j.uid); uids.forEach((uid) => s.scoring.add(uid)); update();
    let ok = 0, fail = 0, firstErr = '';
    try {
      for (let i = 0; i < uids.length; i++) {
        const uid = uids[i], job = s.jobs.find((j) => j.uid === uid);
        notify(`批量分析 ${i + 1}/${uids.length}…`);
        try {
          const match = await send(MSG.AI_MATCH_SCORE, { uid, job });
          if (recordPrepared) {
            const greeting = String(job.greetingDraft || normalizeGreetings(match).standard || '').trim();
            if (!greeting) throw new Error('未生成招呼语，请重新分析');
            if (!s.progress.has(uid)) await setProgress(uid, 'prepared');
          }
          ok++;
        } catch (e) {
          fail++; const message = e instanceof Error ? e.message : String(e); firstErr ||= message;
          notify(`第 ${i + 1} 个失败：${message}`, true);
          if (i === 0) throw new Error(`分析失败：${message}`);
        }
        s.scoring.delete(uid); s.jobs = await send(MSG.JOB_LIST_REQUEST).catch(() => s.jobs); update();
        if (i < uids.length - 1) await sleep(500);
      }
      notify(fail ? `批量分析完成：成功 ${ok}，失败 ${fail}（${firstErr}）` : `批量分析完成：成功 ${ok}`, !!fail);
    } catch (e) { notify(e.message, true); }
    finally { uids.forEach((uid) => s.scoring.delete(uid)); s.batchBusy = false; update(); }
  };
  const batchExport = (items) => {
    if (!items.length) { notify('未选择岗位', true); return; }
    const url = URL.createObjectURL(new Blob(['﻿' + buildDetailedCsv(items, s.progress)], { type: 'text/csv;charset=utf-8' }));
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    chrome.downloads.download({ url, filename: `岗位导出-${items.length}条-${ts}.csv`, saveAs: true })
      .then(() => notify(`已导出 ${items.length} 个岗位`))
      .catch(() => { chrome.tabs.create({ url }); notify(`已在新标签打开导出内容（${items.length} 个岗位）`); });
  };
  const openCurrent = (job, sub = 'info') => { s.selectedUid = job.uid; setView({ tab: 'current', sub }); };
  const selectedJob = s.jobs.find((j) => j.uid === s.selectedUid) || (s.activeCtx?.platform && s.activeCtx?.jobKey ? s.jobs.find((j) => j.uid === `${s.activeCtx.platform}:${s.activeCtx.jobKey}`) : null);
  let list = s.settings ? applyFilters(s.jobs.filter((j) => s.view.platform === 'all' || j.platform === s.view.platform), s.settings.filters) : [];
  const query = s.view.search.trim().toLowerCase();
  if (query) list = list.filter((j) => [j.title, j.company, j.city, (j.skills || []).join(' '), (j.tags || []).join(' ')].join(' ').toLowerCase().includes(query));
  if (s.view.verdict !== 'all') list = list.filter((j) => s.view.verdict === 'unscored' ? !j.match : j.match?.verdict === s.view.verdict);
  list.sort(s.view.sort === 'score' ? (a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1) : s.view.sort === 'salary' ? (a, b) => (b.salaryMaxK ?? b.salaryMinK ?? 0) - (a.salaryMaxK ?? a.salaryMinK ?? 0) : (a, b) => (b.lastSeenAt || b.savedAt || '').localeCompare(a.lastSeenAt || a.savedAt || ''));
  const checkedJobs = () => s.jobs.filter((j) => s.checked.has(j.uid));
  const scoreButton = (job) => <Button variant="outline" size="sm" onClick={() => analyze(job)} aria-label={`分析 ${job.title}`} disabled={s.scoring.has(job.uid)}>{s.scoring.has(job.uid) ? '分析中…' : job.match ? `${job.match.score} · ${VERDICT_LABELS[job.match.verdict] || ''}` : '? 点击分析'}</Button>;
  const options = () => send(MSG.OPEN_OPTIONS);
  const contextLabel = selectedJob ? `${selectedJob.platform === 'boss' ? 'BOSS' : '51job'} · ${selectedJob.company || '当前岗位'}` : s.activeCtx?.platformName ? `${s.activeCtx.platformName} · 未匹配到收录岗位` : '未识别到岗位页面';
  const switchTab = (tab) => { setView({ tab }); if (tab === 'current') refreshContext(); };
  const job = selectedJob;
  const advice = job && s.advice.get(job.uid);
  const hasProfile = s.profile && scoreProfile(s.profile).score > 0;

  return <div className="flex h-screen flex-col bg-background text-foreground">
    <header className="flex flex-col gap-3 border-b p-4">
      <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><h1 className="font-semibold">岗位面板</h1><p className="text-sm text-muted-foreground">{s.view.tab === 'library' ? `共 ${s.jobs.length} 个岗位 · 显示 ${list.length}` : contextLabel}</p></div>{s.view.tab === 'current' && <Button variant="ghost" size="sm" onClick={refreshContext} aria-label="刷新当前页面">↻</Button>}<Button variant="ghost" size="sm" onClick={options} aria-label="设置">设置</Button></div>
      <nav className="flex gap-2" aria-label="面板导航">{[['library', '岗位库'], ['current', '当前岗位']].map(([key, label]) => <Button key={key} size="sm" variant={s.view.tab === key ? 'default' : 'outline'} onClick={() => switchTab(key)}>{label}</Button>)}</nav>
      {s.view.tab === 'library' && <><Input value={s.view.search} onChange={(e) => setView({ search: e.target.value })} placeholder="搜索岗位/公司/技能" aria-label="搜索岗位" /><div className="flex flex-wrap gap-1">{[['all', '全部平台'], ['boss', 'BOSS'], ['qcwy', '51job']].map(([key, label]) => <Button size="sm" key={key} variant={s.view.platform === key ? 'secondary' : 'ghost'} onClick={() => setView({ platform: key })}>{label}</Button>)}</div><div className="flex flex-wrap items-center gap-1">{[['all', '全部'], ['strong', '强匹配'], ['good', '较匹配'], ['fair', '一般'], ['unscored', '未分析']].map(([key, label]) => <Button size="sm" key={key} variant={s.view.verdict === key ? 'secondary' : 'ghost'} onClick={() => setView({ verdict: key })}>{label}</Button>)}<select className="rounded-md border bg-background p-1 text-sm" aria-label="排序" value={s.view.sort} onChange={(e) => setView({ sort: e.target.value })}><option value="recent">最近收录</option><option value="score">匹配分</option><option value="salary">薪资</option></select></div></>}
    </header>
    {s.notice && <div role={s.error ? 'alert' : 'status'} className="border-b px-4 py-2 text-sm">{s.notice}</div>}
    {s.loading ? <p className="p-4">加载中…</p> : !s.settings ? <p className="p-4">加载失败，请重新打开面板。</p> : s.view.tab === 'library' ? <>
      {scoreProfile(s.profile).score < 40 ? <Button variant="ghost" onClick={options}>画像完整度 {scoreProfile(s.profile).score}%，完善后 AI 匹配更准 →</Button> : !s.providers.length && <Button variant="ghost" onClick={options}>尚未配置 AI 接口，点此前往设置 →</Button>}
      <main className="flex flex-1 flex-col gap-3 overflow-auto p-4">{!list.length ? <div className="text-center text-muted-foreground"><p>{s.jobs.length ? '没有符合条件的岗位' : '还没有收录岗位'}</p><p className="text-sm">{s.jobs.length ? '试试调整筛选条件' : '打开 BOSS直聘 或 前程无忧 浏览岗位即可自动收录'}</p></div> : list.map((item) => <Card key={item.uid}><CardHeader><div className="flex items-start gap-2"><input type="checkbox" aria-label={`选择岗位 ${item.title}，用于批量操作`} checked={s.checked.has(item.uid)} onChange={(e) => { if (e.target.checked) s.checked.add(item.uid); else s.checked.delete(item.uid); update(); }} /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => openCurrent(item)}><CardTitle>{item.title} {item.salaryText}</CardTitle><p className="text-sm text-muted-foreground">{[item.company, item.companyIndustry].filter(Boolean).join(' · ')}</p><p className="text-sm text-muted-foreground">{[item.platform === 'boss' ? 'BOSS' : '51job', [item.city, item.district].filter(Boolean).join(' · '), item.experience, item.degree, item.companyScale].filter(Boolean).join(' · ')}</p></button>{scoreButton(item)}</div></CardHeader><CardContent className="flex flex-col gap-3"><Tags values={[...(item.skills?.length ? item.skills : item.tags || []).slice(0, 5), ...(item._filter?.risks || []).slice(0, 2).map((r) => `⚠ ${r}`)]} /><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => analyze(item)} disabled={s.scoring.has(item.uid)}>{item.match ? '重新分析' : 'AI 分析'}</Button><Button size="sm" variant="outline" onClick={() => openCurrent(item, 'greeting')}>打招呼</Button><Button size="sm" variant="ghost" title="收藏" onClick={async () => { try { s.jobs = await send(MSG.JOB_STAR_TOGGLE, { uid: item.uid }); update(); } catch (e) { notify(e.message, true); } }}>{item.star ? '★' : '☆'}</Button>{item.url && <Button size="sm" variant="ghost" onClick={() => chrome.tabs.create({ url: item.url })}>打开原岗位</Button>}<Button size="sm" variant="ghost" onClick={async () => { if (!confirm(`确定删除岗位「${item.title}」？此操作无法撤销。`)) return; try { s.jobs = await send(MSG.JOB_DELETE, { uid: item.uid }); s.checked.delete(item.uid); update(); } catch (e) { notify(e.message, true); } }}>删除</Button></div></CardContent></Card>)}</main>
      <footer className="flex flex-wrap items-center gap-2 border-t p-3">{s.checked.size ? <><span className="text-sm">已选 {s.checked.size}</span><Button size="sm" variant="ghost" onClick={() => { if (list.length && list.every((j) => s.checked.has(j.uid))) s.checked.clear(); else list.forEach((j) => s.checked.add(j.uid)); update(); }}>{list.length && list.every((j) => s.checked.has(j.uid)) ? '取消全选' : '全选'}</Button><Button size="sm" variant="ghost" onClick={() => { s.checked.clear(); update(); }}>清空选择</Button><Button size="sm" disabled={s.batchBusy} onClick={() => batchAnalyze(checkedJobs())}>批量分析（{s.checked.size}）</Button><Button size="sm" variant="outline" disabled={s.batchBusy} onClick={() => { const remaining = checkedJobs().filter((j) => !s.progress.has(j.uid)); if (!remaining.length) notify('所选岗位均已有处理记录'); else batchAnalyze(remaining, true); }}>准备未处理岗位</Button><Button size="sm" variant="outline" disabled={s.batchBusy} onClick={() => { const next = checkedJobs().find((j) => s.progress.get(j.uid)?.status === 'prepared'); if (!next) notify('没有待处理的已准备岗位，请先准备未处理岗位'); else { openCurrent(next, 'greeting'); sendGreeting(next); } }}>处理下一个</Button><Button size="sm" variant="outline" onClick={() => batchExport(checkedJobs())}>批量导出（{s.checked.size}）</Button></> : <><Button size="sm" disabled={!list.length} onClick={() => { list.forEach((j) => s.checked.add(j.uid)); update(); }}>全选 ({list.length})</Button><Button size="sm" variant="outline" onClick={() => batchExport(s.jobs)}>导出</Button><Button size="sm" variant="destructive" onClick={async () => { if (!confirm('确定清空所有已收录岗位？此操作不可撤销。')) return; try { s.jobs = await send(MSG.JOB_CLEAR_REQUEST); s.checked.clear(); notify('已清空岗位库'); } catch (e) { notify(e.message, true); } }}>清空</Button></>}</footer>
    </> : <main className="flex flex-1 flex-col gap-4 overflow-auto p-4">{!job ? <div className="flex flex-col items-center gap-3 text-center"><p>{s.activeCtx?.platform ? '未匹配到当前页面的岗位' : '未识别到岗位页面'}</p><p className="text-sm text-muted-foreground">在 BOSS/51job 打开某个岗位详情后点右上角 ↻ 刷新，或从岗位库里选择一个岗位</p><Button size="sm" onClick={() => setView({ tab: 'library' })}>去岗位库选择</Button></div> : <>
      <div className="flex items-start gap-2"><div className="flex-1"><h2 className="font-semibold">{job.title} {job.salaryText}</h2><p className="text-sm text-muted-foreground">{[job.company, job.companyIndustry].filter(Boolean).join(' · ')}</p></div>{scoreButton(job)}</div>
      <nav className="flex flex-wrap gap-1" aria-label="当前岗位子页">{[['info', '岗位信息'], ['company', '公司画像'], ['resume', '简历建议'], ['greeting', '打招呼']].map(([key, label]) => <Button key={key} size="sm" variant={s.view.sub === key ? 'secondary' : 'ghost'} onClick={() => setView({ sub: key })}>{label}</Button>)}</nav>
      {s.view.sub === 'info' && <div className="flex flex-col gap-4"><Facts rows={[["薪资", job.salaryText], ["城市", [job.city, job.district].filter(Boolean).join(' · ')], ["经验", job.experience], ["学历", job.degree], ["平台", job.platform === 'boss' ? 'BOSS 直聘' : '前程无忧 51job']]} />{(job.skills?.length || job.tags?.length) > 0 && <Section title="技能 / 标签"><Tags values={(job.skills?.length ? job.skills : job.tags).slice(0, 20)} /></Section>}{job.welfare?.length > 0 && <Section title="福利"><Tags values={job.welfare.slice(0, 20)} /></Section>}{job.description && <Section title="岗位描述"><p className="whitespace-pre-wrap text-sm">{job.description}</p></Section>}<Section title="匹配分析">{job.match ? <Analysis match={job.match} /> : <p className="text-sm">尚未分析，<Button variant="link" onClick={() => analyze(job)}>立即 AI 分析</Button></p>}</Section>{job.url && <Button variant="outline" onClick={() => chrome.tabs.create({ url: job.url })}>打开原岗位页面</Button>}</div>}
      {s.view.sub === 'company' && <div className="flex flex-col gap-3"><Facts rows={[["公司", job.company], ["行业", job.companyIndustry], ["规模", job.companyScale], ["性质", job.companyType], ["阶段", job.companyStage], ["HR", [job.hrName, job.hrTitle].filter(Boolean).join(' · ')]]} />{![job.company, job.companyIndustry, job.companyScale, job.companyType, job.companyStage, job.hrName, job.hrTitle].some(Boolean) && <p>暂无公司信息（该平台列表接口未返回，或浏览详情后可补全）</p>}<p className="text-sm text-muted-foreground">公司画像基于岗位接口返回的公开信息整理，仅供参考。</p></div>}
      {s.view.sub === 'resume' && (!s.providers.length ? <p>尚未配置 AI 接口，<Button variant="link" onClick={options}>前往设置</Button></p> : !hasProfile ? <p>简历建议基于你的个人画像生成，请先在设置里完善画像（上传简历或手动填写），<Button variant="link" onClick={options}>前往设置</Button></p> : <div className="flex flex-col gap-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">简历定制建议</h3><Button size="sm" disabled={s.tailoring.has(job.uid)} onClick={() => tailor(job)}>{s.tailoring.has(job.uid) ? '生成中…' : advice ? '重新生成' : '生成建议'}</Button></div><p className="text-sm text-muted-foreground">针对该岗位 JD，建议怎么调整简历去投递。仅给建议、不改你的原简历，只在本会话使用、不保存。</p>{s.tailoring.has(job.uid) && !advice && <p>AI 正在分析…</p>}{advice && <>{[['可突出的匹配点', advice.matchedSkills], ['建议对齐的岗位关键词', advice.keywordsToAlign], ['暂未体现（如实指出，勿编造）', advice.missingSkills]].map(([title, values]) => values?.length > 0 && <Section key={title} title={title}><Tags values={values} /></Section>)}{advice.summaryDraft && <Section title="自我评价草稿（可直接粘贴）"><p className="whitespace-pre-wrap text-sm">{advice.summaryDraft}</p><Button size="sm" variant="outline" onClick={() => copyText(advice.summaryDraft)}>复制草稿</Button></Section>}{[['经历改写建议', advice.bulletSuggestions], ['投递提醒', advice.tips]].map(([title, values]) => values?.length > 0 && <Section key={title} title={title}><ul className="list-disc pl-5 text-sm">{values.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>)}{advice.note && <p className="text-sm">{advice.note}</p>}</>}</div>)}
      {s.view.sub === 'greeting' && (!s.providers.length ? <p>尚未配置 AI 接口，<Button variant="link" onClick={options}>前往设置</Button></p> : !job.match ? <div className="flex flex-col gap-3"><p>先做一次匹配分析，AI 会生成三档招呼语。</p><Button disabled={s.scoring.has(job.uid)} onClick={() => analyze(job)}>{s.scoring.has(job.uid) ? '分析中…' : '生成招呼语'}</Button></div> : <div className="flex flex-col gap-3"><h3 className="font-semibold">招呼语（可编辑）</h3><div className="flex flex-wrap gap-1">{GREETING_LEVELS.map((level) => <Button key={level.key} size="sm" variant={s.view.greetLevel === level.key ? 'secondary' : 'ghost'} onClick={() => { s.view.greetLevel = level.key; const text = normalizeGreetings(job.match)[level.key] || ''; s.greetings.set(job.uid, text); saveGreeting(job.uid, text); update(); }}>{level.label}</Button>)}</div><Textarea rows={6} aria-label="招呼语" placeholder="编辑要发送给 HR 的招呼语…" value={greetingValue(job)} onChange={(e) => { const text = e.target.value; s.greetings.set(job.uid, text); saveGreeting(job.uid, text, true); update(); }} /><p className="text-sm text-muted-foreground">{greetingValue(job).length} 字 · 处理状态：{progressLabels[s.progress.get(job.uid)?.status] || '未处理'}</p><Button size="sm" variant="outline" onClick={async () => { if (!confirm(`确认你已向 ${job.company || '该招聘方'} 发送消息？此操作只记录状态。`)) return; try { await setProgress(job.uid, 'sent'); notify('已记录为手动确认发送'); } catch (e) { notify(`记录失败：${e.message}`, true); } }}>标记已发送</Button><p className="text-sm text-muted-foreground">{s.activeCtx?.isChat ? '请先核对招聘方，再复制并粘贴招呼语发送' : '将新建标签页打开岗位并尝试进入沟通，招呼语会复制；请核对招聘方后粘贴发送'}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={s.scoring.has(job.uid)} onClick={async () => { if (await analyze(job)) { s.greetings.delete(job.uid); saveGreeting(job.uid, ''); update(); } }}>{s.scoring.has(job.uid) ? '生成中…' : '重新生成'}</Button><Button size="sm" variant="outline" onClick={() => copyText(greetingValue(job))}>复制</Button><Button size="sm" onClick={() => sendGreeting(job)}>打开沟通并复制</Button></div></div>)}
    </>}</main>}
  </div>;
}
