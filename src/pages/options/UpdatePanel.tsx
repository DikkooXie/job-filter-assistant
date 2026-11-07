import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { RELEASE_PAGE, normalizeUpdateChannel } from '../../common/update.js';
import type { UpdateCheck } from '../../common/update.js';
import { folderStatus, fetchLatestRelease, installRelease, supportsFolderAccess, extensionsPageUrl } from '../../extension/update.js';
import type { FolderState, UpdateProgress } from '../../extension/update.js';
import type { Settings, UpdateChannel } from '../../common/types.js';
import type { RequestConfirm } from './types.js';
import { cn } from '../../lib/cn.js';
import { button, choiceCard, choiceDot, focusRing, hint } from './recipes.js';

const FOLDER_TEXT: Record<FolderState, string> = {
  none: '未选择',
  granted: '已授权',
  prompt: '需确认',
  denied: '已拒绝',
};

/** 文件夹授权状态的文字颜色。 */
const FOLDER_TONE: Record<FolderState, string> = {
  none: 'text-ink-2',
  granted: 'text-ok',
  prompt: 'text-warn',
  denied: 'text-danger',
};

// 本面板的段落、标题、列表都不留外边距（沿用旧样式的实际效果），间距靠容器的 gap 和 padding。

/** 面板里的按钮：禁用时只变淡，不显示禁止光标。 */
const panelButton = (variant?: 'primary') => cn(button({ variant }), 'disabled:cursor-default');

/** 发布说明、手动步骤、回退区里的品牌色小链接。 */
const textLink = cn('text-note text-brand underline-offset-2', focusRing);

/** 进度、结果等反馈文字。 */
const statusText = 'text-control leading-[1.6] text-ink-2';

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
  const bodyText = 'text-control leading-[1.65] text-ink-2';
  return <div className="mt-4 rounded-[10px] border border-line bg-field px-[13px] py-3">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <h3 className="text-body leading-normal font-medium text-ink-1">{release.version}</h3>
      {date && <time className="text-hint leading-normal text-ink-3" dateTime={release.publishedAt}>{date}</time>}
      <a className={cn(textLink, 'ml-auto')} href={release.pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看</a>
    </div>
    {blocks.length > 0 && <div className="mt-2.5 max-h-60 overflow-auto">
      {blocks.map((block, index) => {
        if (block.type === 'list') {
          return <ul key={index} className={cn(bodyText, 'list-inside list-disc pl-[1.15em] [&>li+li]:mt-1')}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
        }
        if (block.type === 'heading') return <h4 key={index} className="text-control leading-[1.45] font-semibold text-ink-1">{block.text}</h4>;
        return <p key={index} className={bodyText}>{block.text}</p>;
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
  return <details className="group mt-4 border-t border-line pt-3" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    onToggle((current) => (current === next ? current : next));
  }}>
    <summary className={cn('flex cursor-pointer list-none items-center gap-1.5 text-note leading-normal text-ink-2 [&::-webkit-details-marker]:hidden', focusRing)}>
      <span className="inline-block w-[0.8em] transition-transform duration-160 ease-[ease] group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true">›</span>手动更新
    </summary>
    <ol className="list-inside list-decimal pl-[1.2em] text-control leading-[1.65] text-ink-2 [&>li+li]:mt-1">
      <li>到 <a className={textLink} href={pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">GitHub 发布页</a> 下载最新的 zip。</li>
      <li>解压，把里面的文件覆盖到原来的扩展文件夹。</li>
      <li>回到扩展管理页，点「重新加载」。</li>
    </ol>
    <button type="button" className={panelButton()} onClick={openExtensionsPage}>打开扩展管理页</button>
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

  return <section className="mt-7 mb-[30px] border-t border-line pt-[22px] text-ink-1" aria-labelledby="update-panel-title">
    <h2 id="update-panel-title" className="text-section leading-[1.45] font-semibold text-ink-1">关于与更新</h2>
    <p className="text-note leading-[1.65] font-normal text-ink-3">解压出来的文件夹就是扩展本身。请放在固定位置，不要删除或移动。</p>

    <fieldset className="mt-3.5 min-w-0">
      <legend className="mb-2 text-control leading-normal font-medium text-ink-1">更新通道</legend>
      <div className="grid grid-cols-2 gap-2.5 wide:grid-cols-[repeat(2,minmax(0,160px))]" role="radiogroup" aria-label="更新通道">
        {([['stable', '稳定'], ['preview', '预览']] as const).map(([value, label]) => <label key={value} className={cn(choiceCard, 'min-h-10 px-3 py-2 has-disabled:cursor-default')}>
          <input className="sr-only" type="radio" name="update-channel" value={value} checked={channel === value} disabled={installing || checking} onChange={() => changeChannel(value)} />
          <span className={choiceDot} aria-hidden="true" />
          <span>{label}</span>
        </label>)}
      </div>
      <p className={cn(hint, 'mt-2')}>预览只检查 GitHub 预发布包。正式版更旧时不会自动降级。</p>
    </fieldset>

    <div className="mt-3.5 flex flex-col items-stretch justify-between gap-3 border-b border-line py-3.5 wide:flex-row wide:items-center wide:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body leading-normal font-medium text-ink-1">版本 {version}</span>
          {release?.hasUpdate && <span className="inline-flex h-5 items-center rounded-[5px] bg-brand-soft px-1.5 text-micro leading-none font-medium text-brand">可更新到 {release.version}</span>}
        </div>
        <p className="flex flex-wrap gap-1.5 text-hint leading-normal text-ink-3 [&>span+span]:before:mr-1.5 [&>span+span]:before:text-ink-3 [&>span+span]:before:content-['·']">
          <span>扩展文件夹</span>
          <span className={FOLDER_TONE[folderState]}>{FOLDER_TEXT[folderState]}</span>
          {folder.name && <span>{folder.name}</span>}
        </p>
        {folder.state === 'prompt' && <p className={hint}>浏览器需要重新确认写入权限，更新时会自动询问</p>}
      </div>
      <div className="flex flex-none flex-wrap gap-2">
        <button type="button" className={panelButton()} disabled={installing || checking} onClick={check}>{checking ? '检查中' : '检查更新'}</button>
        {release?.hasUpdate && canAutoUpdate && <button type="button" className={panelButton('primary')} disabled={installing} onClick={install}>更新到 {release.version}</button>}
      </div>
    </div>

    {(checking || installing || message || error || !canAutoUpdate) && <div className="mt-3 flex flex-col gap-2">
      {checking && <p className={statusText} role="status">正在检查更新…</p>}
      {installing && progress && <div role="status" aria-live="polite">
        <p className={statusText}>{progressText(progress)}</p>
        {progress.phase === 'download' && (progress.total ?? 0) > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPct} aria-label="下载进度"><span className="block h-full bg-brand transition-[width] duration-160 ease-linear motion-reduce:transition-none" style={{ width: `${downloadPct}%` }} /></div>}
      </div>}
      {message && <p className={cn(statusText, positive && 'text-ok')} role="status">{message}</p>}
      {error && <p className="text-control leading-[1.6] text-danger" role="alert">{error}</p>}
      {!canAutoUpdate && <p className={statusText} role="status">当前浏览器不支持扩展内自动更新，请按下方步骤手动更新。</p>}
    </div>}

    {release?.aheadOfStable && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <a className={textLink} href={pageUrl || RELEASE_PAGE} target="_blank" rel="noreferrer">正式版发布页</a>
      <button type="button" className={panelButton()} onClick={openExtensionsPage}>打开扩展管理页</button>
    </div>}

    {(release?.hasUpdate || release?.aheadOfStable) && <ReleaseNotes release={release} />}
    {canAutoUpdate && <p className="text-note leading-[1.65] text-ink-3">更新后扩展会自动重新加载，岗位、画像和配置都会保留。</p>}
    <ManualSteps pageUrl={pageUrl} open={manualOpen} onToggle={setManualOpen} />
    <p className="flex flex-wrap items-baseline gap-2 text-hint leading-normal text-ink-3"><span>扩展 ID</span> <code className="font-mono text-hint break-all text-ink-2">{chrome.runtime.id}</code></p>
  </section>;
}
