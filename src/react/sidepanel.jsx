import React, { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { MSG, MODE, STORAGE_KEYS } from '../common/constants.js';
import { decideOpenOriginal } from '../common/ensureDescription.js';
import { appendDealbreaker, appendPreferenceNote, emptyProfile, scoreProfile } from '../common/profile.js';
import { pickActiveProvider, profileFingerprint } from '../common/profileFingerprint.js';
import { applyFilters, evaluateJob } from '../common/filters.js';
import { VERDICT_LABELS, normalizeGreetings } from '../common/ai/prompts.js';
import { send } from '../ui/ui-common.js';
import { runningDevBuild } from '../common/build.js';
import { analysisEmptyMessage, analysisTargets, analysisUsesForce, filterVisibleJobs, FRESH_CAPSULE_MS, FRESH_MARK_VISIBLE_MS, librarySurface, noteCapturedJobs, returnFocusTarget, viewConditionsChanged } from './sidepanel/browseModel.js';
import { sanitizeComm } from './sidepanel/commTab.js';
import { cardCopy, cancelRemaining, emptyBatch, enqueueBatch, finishPhase, hydrateTitles, isPending, markRunning, retryFailed, settle, stripModel, SUCCESS_HOLD_MS, takeNext } from './sidepanel/batchQueue.js';
import { BOSS_BROWSE_URL, jobsForLibrary } from './sidepanel/librarySource.js';
import { AnalyzeSheet, BatchStrip, DislikeSheet, FilterSheet, JobDetail, JobRow, ListFooter, ListHeader, ModelNotice, NoticeToast, QueueDrawer, SurfaceState } from './sidepanel/views.jsx';
import './sidepanel/browse.css';

const csvProgressLabels = { prepared: '已准备', opened: '已尝试打开沟通', sent: '已发送（手动确认）' };
const progressKey = (uid) => `job-progress-v1:${encodeURIComponent(uid)}`;
const commKey = (uid) => `job-comm-v1:${encodeURIComponent(uid)}`;
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
function openOriginalFromPanel(job) {
  const action = decideOpenOriginal(job);
  if (action === 'skip') return;
  if (action === 'wait') {
    send(MSG.OPEN_ORIGINAL_JOB, { uid: job.uid, url: job.url }).catch(() => {
      chrome.tabs.create({ url: job.url, active: true });
    });
    return;
  }
  chrome.tabs.create({ url: job.url });
}
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
    scoring: new Set(), tailoring: new Set(), checked: new Set(), progress: new Map(), comm: new Map(), greetings: new Map(), advice: new Map(),
    saveTimers: new Map(), batch: emptyBatch(), queueOpen: false, pumping: false, successTimer: null, reloadVersion: 0, noticeTimer: null, notice: '', noticeBatch: false, error: false, loading: true,
    modelNotice: false, seenReady: false, seenIds: new Set(), freshIds: new Set(),
    capsuleUntil: 0, capsuleTimer: null, scrollLockTimer: null, ignoreScrollDismiss: false,
    moreOpen: false, analyzeOpen: false, dislikeJob: null, dislikeSaving: false,
  };
  const s = state.current;
  const update = () => redraw();
  const notify = (message, error = false, batch = false) => {
    clearTimeout(s.noticeTimer);
    s.notice = message;
    s.error = error;
    s.noticeBatch = !!batch && !error;
    update();
    s.noticeTimer = setTimeout(() => { s.notice = ''; s.noticeBatch = false; update(); }, batch ? 3200 : 2600);
  };
  const setView = (patch) => { Object.assign(s.view, patch); update(); };
  const armCapsule = () => {
    s.capsuleUntil = Date.now() + FRESH_CAPSULE_MS;
    s.ignoreScrollDismiss = true;
    clearTimeout(s.capsuleTimer);
    clearTimeout(s.scrollLockTimer);
    s.scrollLockTimer = setTimeout(() => { s.ignoreScrollDismiss = false; }, 500);
    s.capsuleTimer = setTimeout(() => { s.capsuleUntil = 0; update(); }, FRESH_CAPSULE_MS);
  };
  const dismissCapsule = () => {
    if (s.capsuleUntil <= Date.now()) return;
    clearTimeout(s.capsuleTimer);
    s.capsuleUntil = 0;
    update();
  };
  const reload = async () => {
    const version = ++s.reloadVersion;
    const first = !s.settings;
    if (first) { s.loading = true; s.loadError = null; update(); }
    try {
      const [listed, settings, profile, providers, activeCtx] = await Promise.all([
        send(MSG.JOB_LIST_REQUEST), send(MSG.SETTINGS_GET), send(MSG.PROFILE_GET), send(MSG.AI_PROVIDERS_GET), send(MSG.ACTIVE_CONTEXT_REQUEST).catch(() => null),
      ]);
      const jobs = jobsForLibrary(listed);
      const keys = jobs.flatMap((job) => [progressKey(job.uid), commKey(job.uid)]);
      const stored = keys.length ? await chrome.storage.local.get(keys) : {};
      if (version !== s.reloadVersion) return;
      const firstLoad = !s.settings;
      Object.assign(s, { jobs, settings, profile, providers, activeCtx, loading: false, loadError: null, readError: '' });
      const jobIds = new Set(jobs.map((job) => job.uid));
      for (const uid of s.progress.keys()) if (!jobIds.has(uid)) s.progress.delete(uid);
      for (const uid of s.comm.keys()) if (!jobIds.has(uid)) s.comm.delete(uid);
      for (const uid of s.checked) if (!jobIds.has(uid)) s.checked.delete(uid);
      if (s.lastViewedUid && !jobIds.has(s.lastViewedUid)) s.lastViewedUid = null;
      jobs.forEach((job) => {
        const value = stored[progressKey(job.uid)];
        const current = s.progress.get(job.uid);
        if (value && csvProgressLabels[value.status] && (!current || value.at >= current.at)) s.progress.set(job.uid, value);
        const commValue = stored[commKey(job.uid)];
        if (commValue) s.comm.set(job.uid, sanitizeComm(commValue));
        else s.comm.delete(job.uid);
      });
      if (firstLoad && settings.mode !== MODE.auto) s.view.platform = settings.mode;
      const captured = noteCapturedJobs({ ready: s.seenReady, seen: s.seenIds, fresh: s.freshIds }, jobs);
      s.seenReady = captured.ready;
      s.seenIds = captured.seen;
      s.freshIds = captured.fresh;
      s.batch = hydrateTitles(s.batch, jobs);
      if (captured.arrived.length) armCapsule();
      else if (captured.fresh.size === 0) { clearTimeout(s.capsuleTimer); s.capsuleUntil = 0; }
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
      if (msg?.type === MSG.JOBS_UPDATED) {
        const autoQueue = Array.isArray(msg.autoQueue) ? msg.autoQueue.slice() : null;
        reload().then(() => { if (autoQueue?.length) acceptAuto(autoQueue); });
      } else if (msg?.type === MSG.CURRENT_JOB) refreshContext();
    };
    const onStorage = (changes, area) => {
      if (area !== 'local' || !changes) return;
      // 打开原岗位后 JD 写入岗位库。消息广播若没送到，存储变化仍要刷新当前详情。
      if (changes[STORAGE_KEYS.jobs]) reload();
      if (changes[STORAGE_KEYS.settings]) send(MSG.SETTINGS_GET).then((settings) => { s.settings = settings; update(); }).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(onStorage);
      s.reloadVersion++;
      clearTimeout(s.noticeTimer);
      clearTimeout(s.capsuleTimer);
      clearTimeout(s.scrollLockTimer);
      clearTimeout(s.successTimer);
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
  const saveComm = async (uid, record) => {
    const value = sanitizeComm(record);
    s.comm.set(uid, value);
    update();
    try { await chrome.storage.local.set({ [commKey(uid)]: value }); }
    catch (error) { notify(error.message || '沟通记录保存失败', true); }
  };
  const showModelNotice = () => { s.modelNotice = true; update(); };
  const requireProviders = () => {
    if (s.providers.length) return true;
    showModelNotice();
    return false;
  };
  const analyze = async (job, force = true) => {
    if (s.scoring.has(job.uid)) return false;
    if ((s.batch.items || []).some((item) => item.uid === job.uid && (item.status === 'queued' || item.status === 'running'))) return false;
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
  const openCommunication = async (job, text, { saveAsGreeting = false } = {}) => {
    const content = String(text || '').trim();
    if (!content) { notify(saveAsGreeting ? '招呼语为空' : '没有可复制的内容', true); return; }
    if (s.settings.privacy?.confirmBeforeSend && !confirm(`确认打开 ${job.company || '该招聘方'} 的岗位并尝试进入沟通？\n内容将复制，请核对会话后手动发送。\n\n${content}`)) return;
    if (saveAsGreeting) { s.greetings.set(job.uid, content); saveGreeting(job.uid, content); }
    try { await navigator.clipboard.writeText(content); } catch { notify('复制失败，请先手动复制', true); return; }
    if (!job.url) { notify('内容已复制，该岗位没有可打开的链接，请手动打开岗位页粘贴发送', true); return; }
    try {
      const result = await send(MSG.OPEN_JOB_CHAT, { url: job.url, platform: job.platform, text: content });
      if (result?.mode === 'navigating') { if (s.progress.get(job.uid)?.status !== 'sent') await setProgress(job.uid, 'opened'); notify('已尝试打开沟通；请核对招聘方后粘贴并发送'); }
      else notify(`已打开岗位，未确认进入沟通；请核对后粘贴发送${result?.note ? `（${result.note}）` : ''}`, true);
    } catch (error) { notify(`内容已复制，请手动打开岗位页粘贴发送（${error.message}）`, true); }
  };
  const sendGreeting = (job) => openCommunication(job, greetingValue(job), { saveAsGreeting: true });
  const settleIdle = () => {
    if (isPending(s.batch)) return;
    const before = s.batch.phase;
    s.batch = finishPhase(s.batch);
    if (s.batch.phase === 'success' && before !== 'success') {
      const done = s.batch.items.filter((item) => item.status === 'done').length;
      notify(`批量结束 · ${done} 完成`, false, true);
      clearTimeout(s.successTimer);
      s.successTimer = setTimeout(() => {
        if (s.batch.phase !== 'success') return;
        s.batch = emptyBatch();
        s.queueOpen = false;
        update();
      }, SUCCESS_HOLD_MS);
    } else if (s.batch.phase === 'failed' && before !== 'failed') {
      const done = s.batch.items.filter((item) => item.status === 'done').length;
      const failed = s.batch.items.filter((item) => item.status === 'failed').length;
      notify(`批量结束 · ${done} 完成 · ${failed} 失败`, false, true);
    }
  };
  const pump = async () => {
    if (s.pumping) return;
    s.pumping = true;
    try {
      for (;;) {
        const next = takeNext(s.batch);
        if (!next) break;
        if (!s.providers.length) { showModelNotice(); break; }
        clearTimeout(s.successTimer);
        s.batch = markRunning(s.batch, next.uid);
        s.scoring.add(next.uid);
        update();
        const job = s.jobs.find((item) => item.uid === next.uid) || { uid: next.uid, title: next.title };
        try {
          await send(MSG.AI_MATCH_SCORE, { uid: next.uid, job, force: next.force });
          s.jobs = jobsForLibrary(await send(MSG.JOB_LIST_REQUEST).catch(() => s.jobs));
          s.batch = hydrateTitles(settle(s.batch, next.uid, { ok: true }), s.jobs);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          s.batch = settle(s.batch, next.uid, { ok: false, error: message });
        } finally {
          s.scoring.delete(next.uid);
        }
        update();
        if (takeNext(s.batch)) await sleep(500);
      }
    } finally {
      s.pumping = false;
    }
    if (isPending(s.batch) && s.providers.length) { pump(); return; }
    settleIdle();
    update();
  };
  const acceptAuto = (uids) => {
    if (s.batch.phase === 'success') {
      clearTimeout(s.successTimer);
      s.batch = emptyBatch();
    }
    const jobs = uids.map((uid) => s.jobs.find((job) => job.uid === uid) || { uid, title: '未命名岗位' });
    const next = enqueueBatch(s.batch, jobs, { source: 'auto', force: false });
    if (next === s.batch) return;
    s.batch = hydrateTitles(next, s.jobs);
    update();
    pump();
  };
  const retryQueue = (uid = null) => {
    clearTimeout(s.successTimer);
    const next = retryFailed(s.batch, uid);
    if (next === s.batch) return;
    s.batch = next;
    update();
    pump();
  };
  const cancelQueue = () => {
    s.batch = cancelRemaining(s.batch);
    settleIdle();
    update();
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
    if (uid && s.freshIds.delete(uid) && s.freshIds.size === 0) {
      clearTimeout(s.capsuleTimer);
      s.capsuleUntil = 0;
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
  const selecting = checked.length > 0;
  if (!selecting) { s.moreOpen = false; s.analyzeOpen = false; }
  const capsuleOn = s.capsuleUntil > Date.now() && s.freshIds.size > 0;
  const freshCount = capsuleOn ? s.freshIds.size : 0;
  const freshKey = [...s.freshIds].sort().join('\n');

  const showFresh = () => {
    clearTimeout(s.capsuleTimer);
    s.capsuleUntil = 0;
    const target = list.find((job) => s.freshIds.has(job.uid));
    update();
    if (!target) {
      if (s.freshIds.size) notify('新岗位不在当前筛选结果里');
      return;
    }
    s.ignoreScrollDismiss = true;
    clearTimeout(s.scrollLockTimer);
    s.scrollLockTimer = setTimeout(() => { s.ignoreScrollDismiss = false; }, 500);
    const node = panelRef.current?.querySelector(`[data-job-uid="${cssAttr(target.uid)}"]`);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const onListScroll = () => {
    if (s.ignoreScrollDismiss || s.capsuleUntil <= Date.now()) return;
    dismissCapsule();
  };
  const deleteChecked = async () => {
    s.moreOpen = false;
    update();
    const targets = checked.slice();
    if (!targets.length) return;
    const noun = targets.length === 1
      ? `岗位「${targets[0].title || '未命名岗位'}」`
      : `已选的 ${targets.length} 个岗位`;
    if (!confirm(`确定删除${noun}？此操作无法撤销。`)) return;
    try {
      let jobs = s.jobs;
      for (const job of targets) {
        jobs = jobsForLibrary(await send(MSG.JOB_DELETE, { uid: job.uid }));
        s.checked.delete(job.uid);
        s.freshIds.delete(job.uid);
        if (s.lastViewedUid === job.uid) s.lastViewedUid = null;
      }
      s.jobs = jobs;
      if (s.freshIds.size === 0) { clearTimeout(s.capsuleTimer); s.capsuleUntil = 0; }
      notify(targets.length === 1 ? '已删除岗位' : `已删除 ${targets.length} 个岗位`);
    } catch (error) { notify(error.message, true); }
    update();
  };
  const startAnalysis = async (mode) => {
    s.analyzeOpen = false;
    update();
    let fingerprint = '';
    if (mode === 'fingerprint') {
      try {
        const [profile, settings, providers] = await Promise.all([
          send(MSG.PROFILE_GET),
          send(MSG.SETTINGS_GET),
          send(MSG.AI_PROVIDERS_GET),
        ]);
        s.profile = profile;
        s.settings = settings;
        s.providers = providers;
        fingerprint = profileFingerprint(profile, pickActiveProvider(providers, settings?.activeProviderId));
      } catch (error) {
        notify(error?.message || '无法读取当前画像', true);
        update();
        return;
      }
    }
    const targets = analysisTargets(checked, mode, fingerprint);
    if (!targets.length) {
      notify(analysisEmptyMessage(mode, checked.length));
      update();
      return;
    }
    if (!requireProviders()) { update(); return; }
    if (s.batch.phase === 'success') {
      clearTimeout(s.successTimer);
      s.batch = emptyBatch();
    }
    const next = enqueueBatch(s.batch, targets, { source: 'manual', force: analysisUsesForce(mode) });
    if (next === s.batch) {
      notify('所选岗位已在队列中');
      update();
      return;
    }
    s.batch = next;
    update();
    pump();
  };

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

  useEffect(() => {
    const root = listRef.current;
    if (!root || s.screen !== 'list' || !s.freshIds.size) return undefined;
    const timers = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const uid = entry.target.getAttribute('data-job-uid');
        if (!uid || !s.freshIds.has(uid)) return;
        if (!entry.isIntersecting || s.capsuleUntil > Date.now()) {
          clearTimeout(timers.get(uid));
          timers.delete(uid);
          return;
        }
        if (timers.has(uid)) return;
        timers.set(uid, setTimeout(() => {
          timers.delete(uid);
          if (s.capsuleUntil > Date.now() || !s.freshIds.has(uid)) return;
          s.freshIds.delete(uid);
          update();
        }, FRESH_MARK_VISIBLE_MS));
      });
    }, { root, threshold: 0.4 });
    root.querySelectorAll('[data-job-uid]').forEach((node) => {
      if (s.freshIds.has(node.getAttribute('data-job-uid'))) observer.observe(node);
    });
    return () => {
      observer.disconnect();
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [freshKey, capsuleOn, s.screen]);

  const showListChrome = s.screen !== 'detail';
  return (
    <div className="job-panel" ref={panelRef} data-screen={s.screen} data-surface={s.screen === 'detail' ? 'detail' : surface}>
      {showListChrome && (
        <ListHeader
          total={s.jobs.length}
          shown={s.settings ? list.length : 0}
          freshCount={freshCount}
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
          onShowFresh={showFresh}
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
          comm={job ? s.comm.get(job.uid) : null}
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
          onCopy={copyText}
          onSend={() => job && sendGreeting(job)}
          onOpenChat={(text) => job && openCommunication(job, text)}
          onComm={async (record) => {
            if (!job) return;
            await saveComm(job.uid, record);
            const advanced = sanitizeComm(record).nodes.some((node) => node.id !== 'greet');
            if (advanced && s.progress.get(job.uid)?.status !== 'sent') {
              try { await setProgress(job.uid, 'sent'); update(); }
              catch (error) { notify(error.message || '记录失败', true); }
            }
          }}
          onNotice={notify}
          onMarkSent={async () => {
            if (!job) return;
            if (!confirm(`确认你已向 ${job.company || '该招聘方'} 发送消息？此操作只记录状态。`)) return;
            try { await setProgress(job.uid, 'sent'); notify('已记录为手动确认发送'); }
            catch (error) { notify(`记录失败：${error.message}`, true); }
          }}
          onOpenOriginal={() => openOriginalFromPanel(job)}
          onStar={async () => {
            if (!job) return;
            try { s.jobs = jobsForLibrary(await send(MSG.JOB_STAR_TOGGLE, { uid: job.uid })); update(); }
            catch (error) { notify(error.message, true); }
          }}
          onDislike={() => job && dislikeJob(job, s, update)}
          onDelete={() => job && removeSelected(job, s, update, notify)}
          onAcceptRisk={async (text) => {
            try {
              const current = s.profile?.preference ? s.profile : emptyProfile();
              const notes = appendPreferenceNote(current.preference?.notes, text);
              const next = { ...current, preference: { ...current.preference, notes } };
              s.profile = await send(MSG.PROFILE_SAVE, { profile: next });
              notify('已写入画像');
              return true;
            } catch (error) {
              notify(error.message || '写入失败', true);
              return false;
            }
          }}
          onProfileSettings={() => send(MSG.OPEN_OPTIONS, { page: 'profile' })}
          dev={devBuild}
        />
      ) : surface === 'loading' ? <SurfaceState kind="loading" />
        : surface === 'error' ? <SurfaceState kind="error" message={s.loadError} onRetry={reload} />
          : surface === 'empty' ? <SurfaceState kind="empty" onBrowseBoss={openBossBrowse} />
            : (
              <div className="list-scroll" ref={listRef} onScroll={onListScroll}>
                {profileScore < 40 && <p className="library-hint"><button type="button" onClick={() => send(MSG.OPEN_OPTIONS, { page: 'profile' })}>画像完整度 {profileScore}%，完善后 AI 匹配更准</button></p>}
                {list.length === 0
                  ? <SurfaceState kind="nomatch" viewChanged={viewChanged} onReset={resetView} />
                  : <div className="continuous-list">{list.map((item) => (
                    <JobRow
                      key={item.uid}
                      job={item}
                      checked={s.checked.has(item.uid)}
                      returned={s.lastViewedUid === item.uid}
                      isNew={s.freshIds.has(item.uid)}
                      progressStatus={s.progress.get(item.uid)?.status}
                      queueCard={cardCopy(s.batch, item.uid)}
                      onToggle={() => { if (s.checked.has(item.uid)) s.checked.delete(item.uid); else s.checked.add(item.uid); update(); }}
                      onOpen={openDetail}
                      onStar={async () => { try { s.jobs = jobsForLibrary(await send(MSG.JOB_STAR_TOGGLE, { uid: item.uid })); update(); } catch (error) { notify(error.message, true); } }}
                      onDelete={() => deleteJob(item, s, update, notify)}
                      onDislike={() => dislikeJob(item, s, update)}
                    />
                  ))}</div>}
              </div>
            )}
      {showListChrome && surface !== 'loading' && surface !== 'error' && (
        <BatchStrip
          model={stripModel(s.batch)}
          onOpenQueue={() => { if (s.dislikeSaving) return; s.queueOpen = true; s.analyzeOpen = false; s.filterOpen = false; s.dislikeJob = null; update(); }}
          onRetryFailed={() => retryQueue(null)}
        />
      )}
      {showListChrome && surface !== 'loading' && surface !== 'error' && (
        <ListFooter
          total={list.length}
          selectedCount={checked.length}
          allSelected={allSelected}
          indeterminate={checked.length > 0 && !allSelected}
          menuOpen={s.moreOpen}
          onToggleAll={() => {
            if (allSelected) list.forEach((item) => s.checked.delete(item.uid));
            else list.forEach((item) => s.checked.add(item.uid));
            s.moreOpen = false;
            update();
          }}
          onToggleMenu={(open) => { s.moreOpen = open; update(); }}
          onDeleteSelected={deleteChecked}
          onExportSelected={() => { s.moreOpen = false; batchExport(checked); }}
          onAnalyze={() => { if (s.dislikeSaving) return; s.moreOpen = false; s.filterOpen = false; s.queueOpen = false; s.analyzeOpen = true; s.dislikeJob = null; update(); }}
          onWorkbench={() => send(MSG.OPEN_OPTIONS)}
        />
      )}
      {s.analyzeOpen && (
        <AnalyzeSheet
          selectedCount={checked.length}
          onClose={() => { s.analyzeOpen = false; update(); }}
          onStart={startAnalysis}
        />
      )}
      {s.queueOpen && stripModel(s.batch).visible && (
        <QueueDrawer
          batch={s.batch}
          onCancel={cancelQueue}
          onRetry={retryQueue}
          onClose={() => { s.queueOpen = false; update(); }}
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
      {s.dislikeJob && (
        <DislikeSheet
          job={s.dislikeJob}
          saving={s.dislikeSaving}
          onClose={() => { if (s.dislikeSaving) return; s.dislikeJob = null; update(); }}
          onSave={(text) => saveDislike(text, s, update, notify)}
        />
      )}
      {s.notice && !s.filterOpen && !s.dislikeJob && <NoticeToast message={s.notice} error={s.error} batch={s.noticeBatch} />}
    </div>
  );
}

const DETAIL_SUBS = ['info', 'match', 'company', 'resume', 'flow'];

async function deleteJob(target, s, update, notify) {
  try {
    s.jobs = jobsForLibrary(await send(MSG.JOB_DELETE, { uid: target.uid }));
    s.checked.delete(target.uid);
    s.freshIds.delete(target.uid);
    if (s.freshIds.size === 0) { clearTimeout(s.capsuleTimer); s.capsuleUntil = 0; }
    if (s.lastViewedUid === target.uid) s.lastViewedUid = null;
    update();
  } catch (error) { notify(error.message, true); }
}

async function removeSelected(target, s, update, notify) {
  if (!confirm(`确定删除岗位「${target.title}」？此操作无法撤销。`)) return;
  await deleteJob(target, s, update, notify);
}

// 不喜欢只打开底抽屉。写入走 saveDislike，不在这里重跑分析。
function dislikeJob(target, s, update) {
  if (!target || s.dislikeSaving) return;
  s.dislikeJob = target;
  s.filterOpen = false;
  s.analyzeOpen = false;
  s.queueOpen = false;
  s.moreOpen = false;
  update();
}

// 整句写入雷点。成功后只 toast，不调用分析。
async function saveDislike(text, s, update, notify) {
  const sentence = String(text ?? '').trim();
  if (!sentence || s.dislikeSaving) return false;
  s.dislikeSaving = true;
  update();
  try {
    const current = s.profile?.preference ? s.profile : emptyProfile();
    const preference = appendDealbreaker(current.preference, sentence);
    s.profile = await send(MSG.PROFILE_SAVE, { profile: { ...current, preference } });
    s.dislikeJob = null;
    s.dislikeSaving = false;
    notify('已写入画像');
    return true;
  } catch (error) {
    s.dislikeSaving = false;
    update();
    return error?.message || '写入失败';
  }
}
