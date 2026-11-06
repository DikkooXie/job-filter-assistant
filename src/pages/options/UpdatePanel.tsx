import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { RELEASE_PAGE, normalizeUpdateChannel } from '../../common/update.js';
import type { UpdateCheck } from '../../common/update.js';
import { folderStatus, fetchLatestRelease, installRelease, supportsFolderAccess, extensionsPageUrl } from '../../extension/update.js';
import type { FolderState, UpdateProgress } from '../../extension/update.js';
import type { Settings, UpdateChannel } from '../../common/types.js';
import type { RequestConfirm } from './types.js';
import './update-panel.css';

const FOLDER_TEXT: Record<FolderState, string> = {
  none: '未选择',
  granted: '已授权',
  prompt: '需确认',
  denied: '已拒绝',
};

/** 面板自己的进度：installRelease 开始前先显示「选择文件夹」，所以多一个本地阶段。 */
type PanelProgress = UpdateProgress | { phase: 'folder' };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
function progressText(p: PanelProgress | null): string {
  if (!p) return '';
  if (p.phase === 'folder') return '请在弹出的窗口中选择扩展文件夹…';
  if (p.phase === 'download') {
    const received = p.received ?? 0;
    const total = p.total ?? 0;
    return total ? `正在下载 ${mb(received)} / ${mb(total)}（${Math.round((received / total) * 100)}%）` : `正在下载 ${mb(received)}`;
  }
  if (p.phase === 'verify') return '正在校验安装包…';
  if (p.phase === 'write') return `正在写入文件 ${p.done ?? 0} / ${p.count ?? 0}`;
  if (p.phase === 'reload') return '更新完成，扩展即将重新加载，设置页会自动重新打开…';
  return '';
}

function plainNote(text: unknown): string {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

type NoteBlock =
  | { type: 'list'; items: string[] }
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string };

function noteBlocks(text: unknown): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (list?.length) blocks.push({ type: 'list', items: list });
    list = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const item = /^[-*•]\s+(.+)$/.exec(line) || /^\d+[.)]\s+(.+)$/.exec(line);
    if (item) {
      list = list || [];
      list.push(plainNote(item[1]));
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    blocks.push(heading
      ? { type: 'heading', text: plainNote(heading[1]) }
      : { type: 'text', text: plainNote(line) });
  }
  flush();
  return blocks;
}

function formatReleaseDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

const openExtensionsPage = () => chrome.tabs.create({ url: extensionsPageUrl() }).catch(() => {});

function ReleaseNotes({ release }: { release: UpdateCheck }) {
  const blocks = noteBlocks(release.notes);
  const date = formatReleaseDate(release.publishedAt);
  return <div className="update-notes">
    <div className="update-notes-head">
      <h3>{release.version}</h3>
      {date && <time dateTime={release.publishedAt}>{date}</time>}
      <a href={release.pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看</a>
    </div>
    {blocks.length > 0 && <div className="update-notes-body">
      {blocks.map((block, index) => {
        if (block.type === 'list') {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
        }
        if (block.type === 'heading') return <h4 key={index}>{block.text}</h4>;
        return <p key={index}>{block.text}</p>;
      })}
    </div>}
  </div>;
}

interface ManualStepsProps {
  pageUrl?: string;
  open: boolean;
  onToggle: Dispatch<SetStateAction<boolean>>;
}

function ManualSteps({ pageUrl, open, onToggle }: ManualStepsProps) {
  return <details className="update-manual" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    onToggle((current) => (current === next ? current : next));
  }}>
    <summary><span className="update-chevron" aria-hidden="true">›</span>手动更新</summary>
    <ol>
      <li>到 <a href={pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">GitHub 发布页</a> 下载最新的 zip。</li>
      <li>解压，把里面的文件覆盖到原来的扩展文件夹。</li>
      <li>回到扩展管理页，点「重新加载」。</li>
    </ol>
    <button type="button" className="update-btn update-btn-outline" onClick={openExtensionsPage}>打开扩展管理页</button>
  </details>;
}

export interface UpdatePanelProps {
  onConfirm: RequestConfirm;
  updateChannel?: Settings['updateChannel'];
  onUpdateChannel?: (channel: UpdateChannel) => void;
  checkToken?: number;
}

export default function UpdatePanel({ onConfirm, updateChannel = 'stable', onUpdateChannel, checkToken = 0 }: UpdatePanelProps) {
  const { version } = chrome.runtime.getManifest();
  const channel = normalizeUpdateChannel(updateChannel);
  const [folder, setFolder] = useState<{ state: FolderState; name: string }>({ state: 'none', name: '' });
  const [release, setRelease] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<PanelProgress | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(() => (location.hash === '#updated' ? `已更新到 ${version}` : ''));
  const [manualOpen, setManualOpen] = useState(() => !supportsFolderAccess());
  const [manualNeeded, setManualNeeded] = useState(false);
  const installing = !!progress;
  const canAutoUpdate = supportsFolderAccess();
  const positive = message.startsWith('已是最新') || message.startsWith('已更新到');

  const refresh = useCallback(() => folderStatus().then(setFolder).catch(() => {}), []);
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const showManual = !canAutoUpdate || manualNeeded;
  useEffect(() => {
    if (showManual) setManualOpen(true);
  }, [showManual]);

  const run = async (fn: () => Promise<void>) => {
    setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const changeChannel = (next: string) => {
    const value = normalizeUpdateChannel(next);
    if (value === channel || installing || checking) return;
    setRelease(null);
    setError('');
    setMessage('');
    onUpdateChannel?.(value);
  };
  const check = () => run(async () => {
    setChecking(true);
    try {
      const next = await fetchLatestRelease(channel);
      if (next.previewUnavailable) {
        setRelease(null);
        setMessage(next.message);
        return;
      }
      setRelease(next);
      if (!next.hasUpdate) setMessage(next.message);
    } finally { setChecking(false); }
  });
  // 侧栏「检查更新」只递增 checkToken，检查和安装结果仍留在本面板。
  const seenCheck = useRef(0);
  const checkRef = useRef(check);
  checkRef.current = check;
  const installingRef = useRef(installing);
  installingRef.current = installing;
  useEffect(() => {
    if (!checkToken || checkToken === seenCheck.current) return;
    seenCheck.current = checkToken;
    if (installingRef.current) return;
    checkRef.current();
    const frame = requestAnimationFrame(() => {
      document.getElementById('update-panel-title')?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [checkToken]);
  const firstTime = folder.state === 'none';
  const install = () => {
    if (!release) return;
    const target = release;
    onConfirm({
    title: `更新到 ${target.version}？`,
    body: firstTime
      ? '接下来会弹出文件夹选择窗口，请选择扩展管理页中本扩展「来源」显示的那个文件夹（就是当初「加载解压缩的扩展」时选的）。之后会下载安装包覆盖其中的文件并自动重新加载，岗位、画像和配置会保留。'
      : '将下载安装包并覆盖扩展文件夹中的文件，完成后扩展自动重新加载。岗位、画像和配置会保留。',
    // 不 await：确认按钮的这次点击要立刻进入 installRelease，由它走到文件夹选择窗口。
    // 中间再 await 别的异步操作，浏览器会丢掉用户手势，选择窗口就不会弹出。
    run: () => {
      run(async () => {
        setProgress(firstTime ? { phase: 'folder' } : { phase: 'download', received: 0, total: target.zipSize });
        try {
          const done = await installRelease(target, (next) => setProgress(next));
          if (!done) { setProgress(null); setMessage('已取消选择文件夹，未做任何改动'); }
        } catch (e) {
          setProgress(null);
          setManualNeeded(true);
          setManualOpen(true);
          throw e;
        } finally {
          refresh();
        }
      });
    },
    });
  };

  const folderState = FOLDER_TEXT[folder.state] ? folder.state : 'none';
  const downloadPct = progress?.phase === 'download' && (progress.total ?? 0) > 0
    ? Math.min(100, Math.round(((progress.received ?? 0) / (progress.total ?? 1)) * 100))
    : 0;
  const pageUrl = release?.pageUrl;

  return <section className="update-panel" aria-labelledby="update-panel-title">
    <h2 id="update-panel-title" className="update-title">关于与更新</h2>
    <p className="update-lead">解压出来的文件夹就是扩展本身。请放在固定位置，不要删除或移动。</p>

    <fieldset className="update-channel">
      <legend>更新通道</legend>
      <div className="update-channel-options" role="radiogroup" aria-label="更新通道">
        {([['stable', '稳定'], ['preview', '预览']] as const).map(([value, label]) => <label key={value} className="update-channel-option">
          <input type="radio" name="update-channel" value={value} checked={channel === value} disabled={installing || checking} onChange={() => changeChannel(value)} />
          <span className="update-channel-dot" aria-hidden="true" />
          <span>{label}</span>
        </label>)}
      </div>
      <p className="update-hint">预览只检查 GitHub 预发布包。正式版更旧时不会自动降级。</p>
    </fieldset>

    <div className="update-row">
      <div className="update-identity">
        <div className="update-version-line">
          <span className="update-version">版本 {version}</span>
          {release?.hasUpdate && <span className="update-badge">可更新到 {release.version}</span>}
        </div>
        <p className={`update-folder is-${folderState}`}>
          <span>扩展文件夹</span>
          <span className="update-folder-state">{FOLDER_TEXT[folderState]}</span>
          {folder.name && <span>{folder.name}</span>}
        </p>
        {folder.state === 'prompt' && <p className="update-hint">浏览器需要重新确认写入权限，更新时会自动询问</p>}
      </div>
      <div className="update-actions">
        <button type="button" className="update-btn update-btn-outline" disabled={installing || checking} onClick={check}>{checking ? '检查中' : '检查更新'}</button>
        {release?.hasUpdate && canAutoUpdate && <button type="button" className="update-btn update-btn-primary" disabled={installing} onClick={install}>更新到 {release.version}</button>}
      </div>
    </div>

    {(checking || installing || message || error || !canAutoUpdate) && <div className="update-feedback">
      {checking && <p className="update-status" role="status">正在检查更新…</p>}
      {installing && progress && <div className="update-progress" role="status" aria-live="polite">
        <p>{progressText(progress)}</p>
        {progress.phase === 'download' && (progress.total ?? 0) > 0 && <div className="update-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPct} aria-label="下载进度"><span style={{ width: `${downloadPct}%` }} /></div>}
      </div>}
      {message && <p className={positive ? 'update-status is-ok' : 'update-status'} role="status">{message}</p>}
      {error && <p className="update-alert" role="alert">{error}</p>}
      {!canAutoUpdate && <p className="update-status" role="status">当前浏览器不支持扩展内自动更新，请按下方步骤手动更新。</p>}
    </div>}

    {release?.aheadOfStable && <div className="update-rollback">
      <a href={pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">正式版发布页</a>
      <button type="button" className="update-btn update-btn-outline" onClick={openExtensionsPage}>打开扩展管理页</button>
    </div>}

    {(release?.hasUpdate || release?.aheadOfStable) && <ReleaseNotes release={release} />}
    {canAutoUpdate && <p className="update-keep">更新后扩展会自动重新加载，岗位、画像和配置都会保留。</p>}
    <ManualSteps pageUrl={pageUrl} open={manualOpen} onToggle={setManualOpen} />
    <p className="update-id"><span>扩展 ID</span> <code>{chrome.runtime.id}</code></p>
  </section>;
}
