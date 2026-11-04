import React, { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { MSG, MODE, STORAGE_KEYS } from '../common/constants.js';
import { scoreProfile } from '../common/profile.js';
import { applyFilters, evaluateJob } from '../common/filters.js';
import { VERDICT_LABELS, normalizeGreetings } from '../common/ai/prompts.js';
import { send } from '../ui/ui-common.js';
import { runningDevBuild } from '../common/build.js';
import { filterVisibleJobs, librarySurface, returnFocusTarget, viewConditionsChanged } from './sidepanel/browseModel.js';
import { BOSS_BROWSE_URL, jobsForLibrary } from './sidepanel/librarySource.js';
import { FilterSheet, JobDetail, JobRow, ListFooter, ListHeader, ModelNotice, NoticeToast, SurfaceState } from './sidepanel/views.jsx';
import './sidepanel/browse.css';

const csvProgressLabels = { prepared: '已准备', opened: '已尝试打开沟通', sent: '已发送（手动确认）' };
const progressKey = (uid) => `job-progress-v1:${encodeURIComponent(uid)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const joinList = (value) => Array.isArray(value) ? value.filter(Boolean).join('、') : value == null ? '' : String(value);
const fmtTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
};
const csvCell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
const cssAttr = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const contextUid = (ctx) => (ctx?.platform && ctx?.jobKey ? `${ctx.platform}:${ctx.jobKey}` : null);
const verdictNames = { strong: '强匹配', good: '较匹配', fair: '一般', weak: '偏低', unscored: '未分析' };

function buildDetailedCsv(items, progress) {
  const cols = [
    ['平台', (job) => job.platform === 'boss' ? 'BOSS直聘' : '前程无忧51job'],
    ['匹配档次', (job) => job.match ? VERDICT_LABELS[job.match.verdict] || job.match.verdict : '未分析'],
    ['匹配分', (job) => job.match?.score ?? ''], ['是否收藏', (job) => job.star ? '★' : ''],
    ['处理状态', (job) => csvProgressLabels[progress.get(job.uid)?.status] || '未处理'],
    ['状态更新时间', (job) => fmtTime(progress.get(job.uid)?.at)],
    ['岗位名称', (job) => job.title], ['薪资', (job) => job.salaryText],
    ['薪资下限(K/月)', (job) => job.salaryMinK ?? ''], ['薪资上限(K/月)', (job) => job.salaryMaxK ?? ''],
    ['城市', (job) => job.city], ['区域', (job) => job.district], ['工作经验', (job) => job.experience],
    ['学历要求', (job) => job.degree], ['技能', (job) => joinList(job.skills)], ['岗位标签', (job) => joinList(job.tags)],
    ['福利', (job) => joinList(job.welfare)], ['公司名称', (job) => job.company], ['所属行业', (job) => job.companyIndustry],
    ['公司规模', (job) => job.companyScale], ['公司性质', (job) => job.companyType], ['融资阶段', (job) => job.companyStage],
    ['HR', (job) => job.hrName], ['HR职位', (job) => job.hrTitle], ['一句话总评', (job) => job.match?.summary],
    ['契合点', (job) => joinList(job.match?.reasons)], ['差距/需补齐', (job) => joinList(job.match?.gaps)],
    ['风险提示', (job) => joinList(job.match?.risks)],
    ['招呼语(标准版)', (job) => job.greetingDraft || (job.match ? normalizeGreetings(job.match).standard : '')],
    ['岗位描述', (job) => job.description], ['收录时间', (job) => fmtTime(job.savedAt)],
    ['最近出现', (job) => fmtTime(job.lastSeenAt)], ['岗位链接', (job) => job.url],
  ];
  return [cols.map(([label]) => csvCell(label)).join(','), ...items.map((job) => cols.map(([, get]) => csvCell(get(job))).join(','))].join('\r\n');
}

function appliedLabel(view) {
  const parts = [];
  if (view.search.trim()) parts.push(`“${view.search.trim()}”`);
  if (view.platform === 'boss') parts.push('BOSS直聘');
  if (view.platform === 'qcwy') parts.push('前程无忧');
  if (view.verdict !== 'all') parts.push(verdictNames[view.verdict] || view.verdict);
  if (view.sort === 'score') parts.push('匹配优先');
  if (view.sort === 'salary') parts.push('月薪优先');
  return parts.join(' · ');
}

/** 正式岗位侧栏。列表、筛选、批量与导出都只用 JOB_LIST_REQUEST 读回的已收录岗位。 */
export default function Sidepanel() {
  const [, redraw] = useReducer((value) => value + 1, 0);
  const state = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  if (!state.current) state.current = {
    jobs: [], settings: null, profile: null, providers: [], activeCtx: null, selectedUid: null,
    screen: 'list', followLive: false, loadError: null, readError: '', lastViewedUid: null,
    listScroll: 0, restoreList: false, filterOpen: false,
    view: { sub: 'info', greetLevel: 'standard', search: '', verdict: 'all', sort: 'recent', platform: 'all' },
    scoring: new Set(), tailoring: new Set(), checked: new Set(), progress: new Map(), greetings: new Map(), advice: new Map(),
    saveTimers: new Map(), batchBusy: false, reloadVersion: 0, noticeTimer: null, notice: '', error: false, loading: true,
    modelNotice: false,
  };
  const s = state.current;
  const update = () => redraw();
  const notify = (message, error = false) => {
    clearTimeout(s.noticeTimer);
    s.notice = message;
    s.error = error;
    update();
    s.noticeTimer = setTimeout(() => { s.notice = ''; update(); }, 2600);
  };
  const setView = (patch) => { Object.assign(s.view, patch); update(); };
  const reload = async () => {
    const version = ++s.reloadVersion;
    const first = !s.settings;
    if (first) { s.loading = true; s.loadError = null; update(); }
    try {
      const [listed, settings, profile, providers, activeCtx] = await Promise.all([
        send(MSG.JOB_LIST_REQUEST), send(MSG.SETTINGS_GET), send(MSG.PROFILE_GET), send(MSG.AI_PROVIDERS_GET), send(MSG.ACTIVE_CONTEXT_REQUEST).catch(() => null),
      ]);
      const jobs = jobsForLibrary(listed);
      const keys = jobs.map((job) => progressKey(job.uid));
      const stored = keys.length ? await chrome.storage.local.get(keys) : {};
      if (version !== s.reloadVersion) return;
      const firstLoad = !s.settings;
      Object.assign(s, { jobs, settings, profile, providers, activeCtx, loading: false, loadError: null, readError: '' });
      const jobIds = new Set(jobs.map((job) => job.uid));
      for (const uid of s.progress.keys()) if (!jobIds.has(uid)) s.progress.delete(uid);
      for (const uid of s.checked) if (!jobIds.has(uid)) s.checked.delete(uid);
      if (s.lastViewedUid && !jobIds.has(s.lastViewedUid)) s.lastViewedUid = null;
      jobs.forEach((job) => {
        const value = stored[progressKey(job.uid)];
        const current = s.progress.get(job.uid);
        if (value && csvProgressLabels[value.status] && (!current || value.at >= current.at)) s.progress.set(job.uid, value);
      });
      if (firstLoad && settings.mode !== MODE.auto) s.view.platform = settings.mode;
      if (s.followLive) {
        const uid = contextUid(activeCtx);
        s.selectedUid = uid && jobs.some((job) => job.uid === uid) ? uid : null;
      }
      update();
    } catch (error) {
      if (version !== s.reloadVersion) return;
      s.loading = false;
      const message = error?.message || '岗位读取失败';
      if (s.settings) s.readError = message;
      else s.loadError = message;
      update();
    }
  };
  const refreshContext = async () => {
    s.activeCtx = await send(MSG.ACTIVE_CONTEXT_REQUEST).catch(() => null);
    if (s.followLive) {
      const uid = contextUid(s.activeCtx);
      s.selectedUid = uid && s.jobs.some((job) => job.uid === uid) ? uid : null;
    }
    update();
  };
  useEffect(() => {
    reload();
    const listener = (msg) => {
      if (msg?.type === MSG.JOBS_UPDATED) reload();
      else if (msg?.type === MSG.CURRENT_JOB) refreshContext();
    };
    const onStorage = (changes, area) => {
      if (area === 'local' && changes[STORAGE_KEYS.settings]) send(MSG.SETTINGS_GET).then((settings) => { s.settings = settings; update(); }).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(onStorage);
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
  const showModelNotice = () => { s.modelNotice = true; update(); };
  const requireProviders = () => {
    if (s.providers.length) return true;
    showModelNotice();
    return false;
  };
  const analyze = async (job, force = true) => {
    if (s.scoring.has(job.uid)) return false;
    if (!requireProviders()) return false;
    s.scoring.add(job.uid); update();
    try { await send(MSG.AI_MATCH_SCORE, { uid: job.uid, job, force }); s.jobs = jobsForLibrary(await send(MSG.JOB_LIST_REQUEST)); notify('分析完成'); return true; }
    catch (error) { notify(error.message, true); return false; }
    finally { s.scoring.delete(job.uid); update(); }
  };
  const regenerate = async (job) => {
    if (await analyze(job)) { s.greetings.delete(job.uid); saveGreeting(job.uid, ''); update(); }
  };
  const tailor = async (job) => {
    if (s.tailoring.has(job.uid)) return;
    if (!requireProviders()) return;
    s.tailoring.add(job.uid); update();
    try { s.advice.set(job.uid, await send(MSG.AI_TAILOR_RESUME, { uid: job.uid, job })); notify('简历建议已生成'); }
    catch (error) { notify(`生成失败：${error.message}`, true); }
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
    } catch (error) { notify(`招呼语已复制，请手动打开岗位页粘贴发送（${error.message}）`, true); }
  };
  const batchAnalyze = async (list, recordPrepared = false) => {
    if (s.batchBusy || !list.length) return;
    if (!requireProviders()) return;
    s.batchBusy = true;
    const uids = list.map((job) => job.uid);
    uids.forEach((uid) => s.scoring.add(uid));
    update();
    let ok = 0, fail = 0, firstErr = '';
    try {
      for (let index = 0; index < uids.length; index += 1) {
        const uid = uids[index];
        const job = s.jobs.find((item) => item.uid === uid);
        notify(`批量分析 ${index + 1}/${uids.length}…`);
        try {
          const match = await send(MSG.AI_MATCH_SCORE, { uid, job });
          if (recordPrepared) {
            const greeting = String(job.greetingDraft || normalizeGreetings(match).standard || '').trim();
            if (!greeting) throw new Error('未生成招呼语，请重新分析');
            if (!s.progress.has(uid)) await setProgress(uid, 'prepared');
          }
          ok += 1;
        } catch (error) {
          fail += 1;
          const message = error instanceof Error ? error.message : String(error);
          firstErr ||= message;
          notify(`第 ${index + 1} 个失败：${message}`, true);
          if (index === 0) throw new Error(`分析失败：${message}`);
        }
        s.scoring.delete(uid);
        s.jobs = jobsForLibrary(await send(MSG.JOB_LIST_REQUEST).catch(() => s.jobs));
        update();
        if (index < uids.length - 1) await sleep(500);
      }
      notify(fail ? `批量分析完成：成功 ${ok}，失败 ${fail}（${firstErr}）` : `批量分析完成：成功 ${ok}`, !!fail);
    } catch (error) { notify(error.message, true); }
    finally { uids.forEach((uid) => s.scoring.delete(uid)); s.batchBusy = false; update(); }
  };
  const batchExport = (items) => {
    if (!items.length) { notify('未选择岗位', true); return; }
    const url = URL.createObjectURL(new Blob([`\uFEFF${buildDetailedCsv(items, s.progress)}`], { type: 'text/csv;charset=utf-8' }));
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    chrome.downloads.download({ url, filename: `岗位导出-${items.length}条-${ts}.csv`, saveAs: true })
      .then(() => notify(`已导出 ${items.length} 个岗位`))
      .catch(() => { chrome.tabs.create({ url }); notify(`已在新标签打开导出内容（${items.length} 个岗位）`); });
  };
  const setFilterEnabled = async (enabled) => {
    const prev = s.settings;
    s.settings = { ...prev, filters: { ...prev.filters, enabled } };
    update();
    try { s.settings = await send(MSG.SETTINGS_SAVE, { patch: { filters: { enabled } } }); update(); }
    catch (error) { s.settings = prev; notify(`保存失败：${error.message}`, true); }
  };
  const openDetail = (uid, sub = 'info', follow = false) => {
    if (s.screen !== 'detail') {
      s.listScroll = listRef.current ? listRef.current.scrollTop : 0;
      s.lastViewedUid = null;
    }
    s.screen = 'detail';
    s.followLive = follow;
    s.selectedUid = uid || null;
    s.view.sub = sub;
    s.filterOpen = false;
    update();
  };
  const backToList = () => {
    const uid = s.selectedUid;
    s.lastViewedUid = uid && s.jobs.some((job) => job.uid === uid) ? uid : null;
    s.screen = 'list';
    s.followLive = false;
    s.restoreList = true;
    s.filterOpen = false;
    update();
  };
  const openCurrentJob = async () => {
    await refreshContext();
    const uid = contextUid(s.activeCtx);
    const found = uid && s.jobs.some((job) => job.uid === uid) ? uid : null;
    openDetail(found, 'info', true);
  };
  const resetView = () => setView({ search: '', platform: 'all', verdict: 'all', sort: 'recent' });
  const openBossBrowse = () => {
    try {
      const opened = chrome.tabs.create({ url: BOSS_BROWSE_URL });
      if (opened && typeof opened.then === 'function') {
        opened.catch((error) => notify(error?.message || '无法打开 BOSS 直聘', true));
      }
    } catch (error) {
      notify(error?.message || '无法打开 BOSS 直聘', true);
    }
  };

  const filtered = s.settings ? applyFilters(s.jobs, s.settings.filters) : s.jobs;
  const list = s.settings ? filterVisibleJobs(filtered, s.view) : [];
  const surface = librarySurface({ loading: s.loading && !s.settings, loadError: s.loadError, jobCount: s.settings ? s.jobs.length : 0 });
  const checked = list.filter((job) => s.checked.has(job.uid));
  const allSelected = list.length > 0 && checked.length === list.length;
  const jobRecord = s.selectedUid ? s.jobs.find((item) => item.uid === s.selectedUid) || null : null;
  const job = jobRecord ? { ...jobRecord, _filter: evaluateJob(jobRecord, s.settings?.filters) } : null;
  const detailMode = s.screen !== 'detail' ? null : job ? 'job' : s.selectedUid ? 'removed' : 'unmatched';
  const profileScore = s.profile ? scoreProfile(s.profile).score : 0;
  const hasProfile = profileScore > 0;
  const filterCount = (s.view.platform !== 'all' ? 1 : 0) + (s.view.verdict !== 'all' ? 1 : 0);
  const viewChanged = viewConditionsChanged(s.view);
  const devBuild = runningDevBuild();

  useLayoutEffect(() => {
    if (!s.restoreList || s.screen !== 'list') return;
    s.restoreList = false;
    const visibleUids = list.map((item) => item.uid);
    const returned = s.lastViewedUid;
    const target = returnFocusTarget(visibleUids, returned);
    const sameJob = target.kind === 'job' && target.uid === returned;
    if (listRef.current) listRef.current.scrollTop = s.listScroll || 0;
    const node = target.kind === 'job'
      ? panelRef.current?.querySelector(`[data-job-uid="${cssAttr(target.uid)}"] .job-title`)
      : panelRef.current?.querySelector('.search-input');
    if (!node) return;
    if (sameJob || target.kind === 'search') node.focus({ preventScroll: true });
    else node.focus();
  });

  const showListChrome = s.screen !== 'detail';
  return (
    <div className="job-panel" ref={panelRef} data-screen={s.screen} data-surface={s.screen === 'detail' ? 'detail' : surface}>
      {showListChrome && (
        <ListHeader
          total={s.jobs.length}
          shown={s.settings ? list.length : 0}
          view={s.view}
          filterEnabled={!!s.settings?.filters?.enabled}
          settingsReady={!!s.settings}
          filterCount={filterCount}
          applied={appliedLabel(s.view)}
          viewChanged={viewChanged}
          onSearch={(search) => setView({ search })}
          onClearSearch={() => setView({ search: '' })}
          onSort={(sort) => setView({ sort })}
          onToggleFilters={setFilterEnabled}
          onOpenFilters={() => { s.filterOpen = true; update(); }}
          onOpenCurrent={openCurrentJob}
          onOptions={() => send(MSG.OPEN_OPTIONS)}
          onReset={resetView}
          dev={devBuild}
        />
      )}
      {showListChrome && s.readError && (
        <div className="read-error" role="alert">
          <span>岗位读取失败：{s.readError}</span>
          <button type="button" className="jp-btn" onClick={reload}>重新加载</button>
        </div>
      )}
      {s.modelNotice && (
        <ModelNotice
          onOpenSettings={() => send(MSG.OPEN_OPTIONS, { page: 'ai' })}
          onDismiss={() => { s.modelNotice = false; update(); }}
        />
      )}
      {s.screen === 'detail' ? (
        <JobDetail
          mode={detailMode}
          job={job}
          sub={DETAIL_SUBS.includes(s.view.sub) ? s.view.sub : 'info'}
          followLive={s.followLive}
          progressStatus={job ? s.progress.get(job.uid)?.status : undefined}
          greeting={job ? greetingValue(job) : ''}
          greetLevel={s.view.greetLevel}
          advice={job ? s.advice.get(job.uid) : null}
          scoring={!!job && s.scoring.has(job.uid)}
          tailoring={!!job && s.tailoring.has(job.uid)}
          hasProfile={hasProfile}
          onBack={backToList}
          onSub={(sub) => setView({ sub })}
          onAnalyze={() => job && analyze(job)}
          onRegenerate={() => job && regenerate(job)}
          onTailor={() => job && tailor(job)}
          onGreeting={(text) => { if (!job) return; s.greetings.set(job.uid, text); saveGreeting(job.uid, text, true); update(); }}
          onGreetLevel={(level) => {
            if (!job) return;
            s.view.greetLevel = level;
            const text = normalizeGreetings(job.match)[level] || '';
            s.greetings.set(job.uid, text);
            saveGreeting(job.uid, text);
            update();
          }}
          onCopy={copyText}
          onSend={() => job && sendGreeting(job)}
          onMarkSent={async () => {
            if (!job) return;
            if (!confirm(`确认你已向 ${job.company || '该招聘方'} 发送消息？此操作只记录状态。`)) return;
            try { await setProgress(job.uid, 'sent'); notify('已记录为手动确认发送'); }
            catch (error) { notify(`记录失败：${error.message}`, true); }
          }}
          onOpenOriginal={() => job?.url && chrome.tabs.create({ url: job.url })}
          onDelete={() => job && removeSelected(job, s, update, notify)}
          onProfileSettings={() => send(MSG.OPEN_OPTIONS, { page: 'profile' })}
          dev={devBuild}
        />
      ) : surface === 'loading' ? <SurfaceState kind="loading" />
        : surface === 'error' ? <SurfaceState kind="error" message={s.loadError} onRetry={reload} />
          : surface === 'empty' ? <SurfaceState kind="empty" onBrowseBoss={openBossBrowse} />
            : (
              <div className="list-scroll" ref={listRef}>
                {profileScore < 40 && <p className="library-hint"><button type="button" onClick={() => send(MSG.OPEN_OPTIONS, { page: 'profile' })}>画像完整度 {profileScore}%，完善后 AI 匹配更准</button></p>}
                {list.length === 0
                  ? <SurfaceState kind="nomatch" viewChanged={viewChanged} onReset={resetView} />
                  : <div className="continuous-list">{list.map((item) => (
                    <JobRow
                      key={item.uid}
                      job={item}
                      checked={s.checked.has(item.uid)}
                      returned={s.lastViewedUid === item.uid}
                      progressStatus={s.progress.get(item.uid)?.status}
                      onToggle={() => { if (s.checked.has(item.uid)) s.checked.delete(item.uid); else s.checked.add(item.uid); update(); }}
                      onOpen={openDetail}
                      onStar={async () => { try { s.jobs = jobsForLibrary(await send(MSG.JOB_STAR_TOGGLE, { uid: item.uid })); update(); } catch (error) { notify(error.message, true); } }}
                    />
                  ))}</div>}
              </div>
            )}
      {showListChrome && surface !== 'loading' && surface !== 'error' && (
        <ListFooter
          total={list.length}
          selectedCount={checked.length}
          allSelected={allSelected}
          indeterminate={checked.length > 0 && !allSelected}
          busy={s.batchBusy}
          onToggleAll={() => {
            if (allSelected) list.forEach((item) => s.checked.delete(item.uid));
            else list.forEach((item) => s.checked.add(item.uid));
            update();
          }}
          onClear={() => { list.forEach((item) => s.checked.delete(item.uid)); update(); }}
          onAnalyze={() => batchAnalyze(checked)}
          onPrepare={() => {
            const remaining = checked.filter((item) => !s.progress.has(item.uid));
            if (!remaining.length) notify('所选岗位均已有处理记录');
            else batchAnalyze(remaining, true);
          }}
          onNext={() => {
            const next = checked.find((item) => s.progress.get(item.uid)?.status === 'prepared');
            if (!next) notify('没有待处理的已准备岗位，请先准备未处理岗位');
            else { openDetail(next.uid, 'flow'); sendGreeting(next); }
          }}
          onExportVisible={() => batchExport(list)}
          onExportSelected={() => batchExport(checked)}
          onClearLibrary={async () => {
            if (!confirm('确定清空所有已收录岗位？此操作不可撤销。')) return;
            try { s.jobs = jobsForLibrary(await send(MSG.JOB_CLEAR_REQUEST)); s.checked.clear(); s.lastViewedUid = null; notify('已清空岗位库'); }
            catch (error) { notify(error.message, true); }
          }}
        />
      )}
      {s.filterOpen && (
        <FilterSheet
          view={s.view}
          shown={list.length}
          onView={setView}
          onReset={resetView}
          onClose={() => { s.filterOpen = false; update(); }}
        />
      )}
      {s.notice && !s.filterOpen && <NoticeToast message={s.notice} error={s.error} />}
    </div>
  );
}

const DETAIL_SUBS = ['info', 'match', 'company', 'resume', 'flow'];

async function removeSelected(target, s, update, notify) {
  if (!confirm(`确定删除岗位「${target.title}」？此操作无法撤销。`)) return;
  try {
    s.jobs = jobsForLibrary(await send(MSG.JOB_DELETE, { uid: target.uid }));
    s.checked.delete(target.uid);
    if (s.lastViewedUid === target.uid) s.lastViewedUid = null;
    update();
  } catch (error) { notify(error.message, true); }
}
