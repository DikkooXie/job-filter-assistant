import React, { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import markUrl from '../../../icons/128.png';
import { runningDevBuild } from '../../common/build.js';
import type { OptionsPage } from '../../common/optionsLink.js';
import type { ProfileScore } from '../../common/profile.js';
import type { Settings } from '../../common/types.js';
import type { SaveStatus } from './saveQueue.js';
import type { Notification } from './types.js';
import { CHANGELOG_RETURN_KEY, SETTINGS_PAGES, changelogReturnTarget, formatSavedClock, isChangelogHash, nextNavIndex, sectionTargetId } from './pageHash.js';
import ChangelogPage from './ChangelogPage.js';
import { cn } from '../../lib/cn.js';
import { focusRing } from './recipes.js';

const versionLink = cn('cursor-pointer border-0 bg-transparent p-0 text-hint leading-[1.3] underline underline-offset-2', focusRing);
const railMeta = 'm-0 text-hint leading-[1.6] text-ink-3';

function Icon({ name }: { name: string }) {
  const common = { className: 'size-4 flex-none max-[860px]:hidden', viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (name === 'profile') {
    return <svg {...common}><circle cx="8" cy="5.2" r="2.2" /><path d="M3.3 13.1c.7-2.2 2.5-3.3 4.7-3.3s4 1.1 4.7 3.3" /></svg>;
  }
  if (name === 'ai') {
    return <svg {...common}><path d="M6 2.6v2.6M10 2.6v2.6" /><path d="M4.4 6.2h7.2v2a3.6 3.6 0 0 1-7.2 0z" /><path d="M8 11.2V13.6" /></svg>;
  }
  if (name === 'filters') {
    return <svg {...common}><path d="M2.4 3.2h11.2L9.6 8.2v3.6L6.4 13V8.2z" /></svg>;
  }
  return <svg {...common}><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" /></svg>;
}

function onNavKeyDown(event: KeyboardEvent<HTMLElement>) {
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const active = document.activeElement;
  const index = active ? links.indexOf(active as HTMLAnchorElement) : -1;
  const next = nextNavIndex(index, event.key, links.length);
  if (next < 0 || next === index) return;
  event.preventDefault();
  const link = links[next];
  if (!link) return;
  link.focus();
  if (link.hash !== location.hash) link.click();
}

interface SaveStatusViewProps {
  status: SaveStatus;
  onRetry: () => void;
}

function SaveStatusView({ status, onRetry }: SaveStatusViewProps) {
  if (!status || status.phase === 'idle') return null;
  const failed = status.phase === 'error';
  const saved = status.phase === 'saved';
  return <div className="inline-flex items-center gap-1.5 whitespace-nowrap text-hint leading-[1.4] text-ink-3" role="status" aria-live="polite">
    <span className={cn('size-1.5 rounded-full bg-ink-3', saved && 'bg-ok', failed && 'bg-danger')} aria-hidden="true" />
    {status.phase === 'saving' && <span>保存中…</span>}
    {saved && <span>已自动保存 · {formatSavedClock(status.savedAt)}</span>}
    {failed && <button type="button" className={cn('cursor-pointer border-0 bg-transparent p-0 text-danger underline underline-offset-2', focusRing)} onClick={onRetry}>保存失败，重试</button>}
  </div>;
}

export function ProfileRail({ score }: { score: ProfileScore }) {
  const ratio = Math.max(0, Math.min(100, Number(score.score) || 0));
  return <aside className="sticky top-[38px] max-[1080px]:static max-[1080px]:block max-[1080px]:[grid-row:1]" aria-label="画像完整度">
    <div className="rounded-[14px] bg-surface p-5 shadow-card">
      <div className="text-note leading-[1.4] font-semibold text-ink-2">完整度</div>
      <div className="mt-2.5 mb-1.5 text-[30px] leading-none font-semibold tracking-[-.02em] text-ink-1">{score.score}</div>
      <p className={railMeta}>{score.completed} / {score.total} 项</p>
      <div className="my-3 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true"><span className="block h-full bg-brand" style={{ width: `${ratio}%` }} /></div>
      {score.missing.length
        ? <ul className="m-0 mt-2 list-none p-0 max-[1080px]:grid max-[1080px]:[grid-template-columns:repeat(auto-fit,minmax(140px,1fr))] max-[1080px]:gap-x-4">{score.missing.map((item) => <li className="border-t border-line py-1.5 text-note leading-[1.45] text-ink-2" key={item}>{item}</li>)}</ul>
        : <p className={railMeta}>画像已相当完整</p>}
    </div>
  </aside>;
}

interface VersionRowProps {
  version: string;
  logOpen: boolean;
  onCheckUpdate: () => void;
  onOpenLog: () => void;
  logButtonRef: RefObject<HTMLButtonElement | null>;
}

function VersionRow({ version, logOpen, onCheckUpdate, onOpenLog, logButtonRef }: VersionRowProps) {
  if (!version) return null;
  return <div className="mt-auto border-t border-line pt-3.5 text-hint leading-[1.4] text-ink-3 max-[860px]:hidden">
    <div>版本 {version}</div>
    <div className="mt-[5px] flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <button type="button" className={cn(versionLink, logOpen ? 'font-normal text-ink-3 decoration-[color-mix(in_srgb,var(--s-ink-3)_35%,transparent)]' : 'font-medium text-brand decoration-brand-line')} onClick={onCheckUpdate}>检查更新</button>
      <span className="text-[10px] text-ink-3 opacity-45" aria-hidden="true">·</span>
      <button
        ref={logButtonRef}
        type="button"
        className={cn(versionLink, 'font-normal text-ink-3 decoration-[color-mix(in_srgb,var(--s-ink-3)_45%,transparent)] aria-[current=page]:font-semibold aria-[current=page]:text-brand aria-[current=page]:decoration-brand-line')}
        aria-current={logOpen ? 'page' : undefined}
        onClick={onOpenLog}
      >更新日志</button>
    </div>
  </div>;
}

interface NoticeProps {
  notice: Notification | null;
  onDismiss: () => void;
}

function Notice({ notice, onDismiss }: NoticeProps) {
  if (!notice) return null;
  return <div className={cn('mb-6 flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-control leading-[1.5] text-ink-1', notice.error && 'bg-danger-soft text-danger')} role={notice.error ? 'alert' : 'status'}>
    <span>{notice.message}</span>
    <button type="button" className={cn('cursor-pointer flex-none border-0 bg-transparent px-0.5 py-0 leading-none text-inherit', focusRing)} aria-label="关闭提示" onClick={onDismiss}>×</button>
  </div>;
}

export interface SettingsShellProps {
  page: OptionsPage;
  hash: string;
  title: string;
  status: SaveStatus;
  onRetry: () => void;
  version: string;
  updateChannel: Settings['updateChannel'];
  onCheckUpdate: () => void;
  notice: Notification | null;
  onDismissNotice: () => void;
  busy: string;
  rail: ReactNode;
  children: ReactNode;
}

export default function SettingsShell({ page, hash, title, status, onRetry, version, updateChannel, onCheckUpdate, notice, onDismissNotice, busy, rail, children }: SettingsShellProps) {
  const logOpen = isChangelogHash(hash);
  const lead = SETTINGS_PAGES.find((item) => item.id === page)?.lead;
  const dev = runningDevBuild();
  const logButtonRef = useRef<HTMLButtonElement>(null);
  const openLog = useCallback(() => {
    if (isChangelogHash(location.hash)) return;
    try { sessionStorage.setItem(CHANGELOG_RETURN_KEY, location.hash || '#profile'); } catch { /* 隐私模式写不进去时，返回仍落到个人画像 */ }
    location.hash = '#changelog';
  }, []);
  const backFromLog = useCallback(() => {
    let saved = '';
    try { saved = sessionStorage.getItem(CHANGELOG_RETURN_KEY) || ''; } catch { /* 读不到就回个人画像 */ }
    const target = changelogReturnTarget(saved);
    if (location.hash !== target) location.hash = target;
    requestAnimationFrame(() => logButtonRef.current?.focus());
  }, []);
  useEffect(() => {
    document.title = `${logOpen ? '更新日志' : title} · Offercome${dev ? ' · dev' : ''}`;
  }, [title, dev, logOpen]);
  useEffect(() => {
    if (logOpen) return;
    const target = sectionTargetId(hash);
    if (!target) return;
    document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [hash, logOpen]);

  const banner = (notice || status?.phase === 'error') ? <>
    <Notice notice={notice} onDismiss={onDismissNotice} />
    {status?.phase === 'error' && <SaveStatusView status={status} onRetry={onRetry} />}
  </> : null;

  return <div className="grid min-h-screen grid-cols-[248px_minmax(0,1fr)] bg-page max-[860px]:grid-cols-[minmax(0,1fr)]" inert={busy ? true : undefined}>
    <aside className="sticky top-0 flex h-screen flex-col border-r border-line bg-page px-[18px] pt-[30px] pb-[22px] max-[860px]:z-[5] max-[860px]:h-auto max-[860px]:border-r-0 max-[860px]:border-b max-[860px]:p-0">
      <div className="mb-[22px] flex items-center gap-2.5 max-[860px]:hidden">
        <img className="block size-7 flex-none object-contain" src={markUrl} alt="" width={28} height={28} />
        <span className="text-body leading-[1.3] font-semibold text-ink-1">Offercome</span>
        {dev && <span className="flex-none rounded-[5px] border border-brand-line bg-brand-soft px-[5px] py-px text-[10.5px] leading-[1.4] font-semibold text-brand">dev</span>}
      </div>
      <nav className="flex flex-col gap-1 max-[860px]:w-full max-[860px]:flex-row max-[860px]:overflow-x-auto max-[860px]:px-2.5 max-[860px]:py-2" aria-label="设置页面" onKeyDown={onNavKeyDown}>
        {SETTINGS_PAGES.map((item) => <a className={cn('flex min-h-[34px] items-center gap-2 rounded-lg px-2.5 py-[9px] text-body leading-[1.2] text-ink-2 no-underline hover:bg-surface-2 hover:text-ink-1 aria-[current=page]:bg-well aria-[current=page]:font-semibold aria-[current=page]:text-ink-1 max-[860px]:flex-none max-[860px]:whitespace-nowrap', focusRing)} key={item.id} href={`#${item.id}`} aria-current={!logOpen && page === item.id ? 'page' : undefined}>
          <Icon name={item.id} />
          <span>{item.label}</span>
        </a>)}
      </nav>
      <VersionRow version={version} logOpen={logOpen} onCheckUpdate={onCheckUpdate} onOpenLog={openLog} logButtonRef={logButtonRef} />
    </aside>
    {logOpen
      ? <ChangelogPage channel={updateChannel} version={version} onBack={backFromLog} banner={banner} />
      : <div className="min-w-0 px-12 pt-12 pb-24 max-[860px]:px-[18px] max-[860px]:pt-6 max-[860px]:pb-20">
        <div className={cn('max-w-[760px]', page === 'profile' && 'max-w-[1140px]')}>
          <header className="mb-8 flex items-center justify-between gap-4 border-b border-line pb-4 max-[860px]:flex-col max-[860px]:items-start max-[860px]:gap-2">
            <div className="min-w-0">
              <h1 className="m-0 text-[26px] leading-[1.3] font-semibold tracking-[-.015em] text-ink-1">{title}</h1>
              {lead && <p className="mt-1 text-control leading-[1.6] text-ink-3">{lead}</p>}
            </div>
            <SaveStatusView status={status} onRetry={onRetry} />
          </header>
          <Notice notice={notice} onDismiss={onDismissNotice} />
          {page === 'profile'
            ? <div className="grid grid-cols-[minmax(0,1fr)_296px] items-start gap-7 max-[1080px]:grid-cols-[minmax(0,1fr)]"><div>{children}</div>{rail}</div>
            : <div>{children}</div>}
        </div>
      </div>}
  </div>;
}

export function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch {
    return '';
  }
}
