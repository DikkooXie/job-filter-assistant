import React, { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RELEASES_PAGE, CHANGELOG_SECTION_ORDER, isCurrentChangelogVersion, formatChangelogWhen } from '../../common/update.js';
import type { ChangelogEntry } from '../../common/update.js';
import { fetchReleaseNotes } from '../../extension/update.js';
import type { Settings } from '../../common/types.js';
import { cn } from '../../lib/cn.js';
import { focusRing } from './recipes.js';

const bullets = 'm-0 flex list-none flex-col gap-[5px] p-0';
const stateText = 'm-0 py-3.5 text-control text-ink-2';

const EMPTY_PAGE = '暂时还没有整理好的版本说明';
const UNCLASSIFIED = '本版暂无整理好的更新说明';

function BackIcon() {
  return <svg className="size-3.5" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>;
}

function Chevron() {
  return <svg className="size-3.5 flex-none fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round] transition-transform duration-150 ease-[ease] group-aria-expanded:rotate-90" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>;
}

interface BulletListProps {
  items: string[];
  className?: string;
  id?: string;
  hidden?: boolean;
}

function BulletList({ items, className, id, hidden }: BulletListProps) {
  return <ul id={id} className={className} hidden={hidden || undefined}>
    {items.map((text, index) => <li className="relative pl-3.5 text-control leading-[1.45] text-ink-1 before:absolute before:top-2 before:left-0 before:size-[5px] before:rounded-full before:bg-[color-mix(in_srgb,var(--s-ink-3)_80%,var(--s-page))]" key={index}>{text}</li>)}
  </ul>;
}

interface FoldSectionProps {
  title: string;
  items: string[];
  controlsId: string;
}

function FoldSection({ title, items, controlsId }: FoldSectionProps) {
  const [open, setOpen] = useState(false);
  return <div className="mt-1 [&+&]:mt-0.5">
    <button
      type="button"
      className="group m-0 flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent py-1.5 pr-2 pl-0.5 text-left text-note leading-[1.3] text-ink-3 hover:bg-surface-2 hover:text-ink-2 aria-expanded:text-ink-1 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={() => setOpen((value) => !value)}
    >
      <Chevron />
      <span className="flex-1 font-[550]">{title}</span>
      <span className="flex-none pr-0.5 text-[11px] font-normal tabular-nums text-ink-3">{items.length}</span>
    </button>
    <BulletList id={controlsId} hidden={!open} items={items} className={cn(bullets, 'pt-0.5 pb-1.5 pl-5')} />
  </div>;
}

interface ReleaseBlockProps {
  item: ChangelogEntry;
  index: number;
  installed: string;
}

function ReleaseBlock({ item, index, installed }: ReleaseBlockProps) {
  const baseId = useId();
  const sections = item.sections || { added: [], ui: [], fixed: [] };
  const current = isCurrentChangelogVersion(item.version, installed);
  const older = !current && index >= 3;
  const when = formatChangelogWhen(item.publishedAt);
  const visible = CHANGELOG_SECTION_ORDER.filter((section) => sections[section.key]?.length > 0);
  return <article className="relative mb-[22px] last:mb-2">
    <span className={cn('absolute top-[5px] -left-[18px] box-border size-[11px] rounded-full border-2 border-brand bg-page', older && 'border-[color-mix(in_srgb,var(--s-ink-3)_70%,var(--s-page))]', current && 'bg-brand shadow-[0_0_0_3px_color-mix(in_srgb,var(--s-accent)_18%,transparent)]')} aria-hidden="true" />
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <span className="text-[14px] leading-[1.3] font-semibold tracking-[.01em] text-brand">{item.version}</span>
      {current && <span className="rounded-[3px] bg-brand px-1.5 py-px text-[10px] leading-[1.4] font-[650] tracking-[.02em] text-on-brand">当前</span>}
      {when && <time className="text-hint leading-[1.3] tabular-nums text-ink-3" dateTime={item.publishedAt}>{when}</time>}
    </div>
    {visible.length === 0 && <p className="m-0 text-control leading-[1.45] text-ink-3">{UNCLASSIFIED}</p>}
    {visible.map((section) => {
      const items = sections[section.key];
      if (section.key === 'added') {
        return <BulletList key={section.key} items={items} className={cn(bullets, 'mb-1')} />;
      }
      return <FoldSection key={section.key} title={section.title} items={items} controlsId={`${baseId}-${section.key}`} />;
    })}
  </article>;
}

export interface ChangelogPageProps {
  channel: Settings['updateChannel'];
  version: string;
  onBack: () => void;
  banner?: ReactNode;
}

interface LoadState {
  status: 'loading' | 'ready' | 'error';
  items: ChangelogEntry[];
  error: string;
}

export default function ChangelogPage({ channel, version, onBack, banner }: ChangelogPageProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading', items: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], error: '' });
    fetchReleaseNotes(channel).then((items) => {
      if (!cancelled) setState({ status: 'ready', items, error: '' });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ status: 'error', items: [], error: error instanceof Error ? error.message : '更新日志加载失败' });
    });
    return () => { cancelled = true; };
  }, [channel, reloadKey]);

  useEffect(() => { backRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  return <div className="min-w-0 p-0">
    <section className="min-w-0" id="settings-changelog" aria-labelledby="settings-changelog-title">
      <header className="flex items-start justify-between gap-3 border-b border-line px-7 pt-[18px] pb-3.5 max-[860px]:px-4">
        <div className="min-w-0">
          <button ref={backRef} type="button" className={cn('mb-2 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-note leading-[1.3] text-ink-3 hover:text-ink-1', focusRing)} aria-label="返回设置" onClick={onBack}>
            <BackIcon />
            设置
          </button>
          <h1 className="m-0 text-[20px] leading-[1.25] font-semibold text-ink-1" id="settings-changelog-title">更新日志</h1>
          <p className="mt-1 text-note leading-[1.4] text-ink-3">近期版本改动一览 · 按发布时间排序</p>
        </div>
        <a className={cn('mt-7 flex-none border-b border-[color-mix(in_srgb,var(--s-ink-3)_30%,transparent)] text-micro leading-[1.3] whitespace-nowrap text-ink-3 no-underline hover:text-ink-2 max-[860px]:mt-2', focusRing)} href={RELEASES_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看全部</a>
      </header>
      <div className="px-7 pt-[18px] pb-5 max-[860px]:px-4">
        {banner}
        {state.status === 'loading' && <p className={stateText} role="status">正在读取更新日志…</p>}
        {state.status === 'error' && <p className={stateText} role="alert">
          <span>{state.error}</span>
          <button type="button" className={cn('ml-2 cursor-pointer border-0 bg-transparent p-0 text-control leading-[1.3] font-medium text-brand underline decoration-brand-line underline-offset-2', focusRing)} onClick={() => setReloadKey((n) => n + 1)}>重试</button>
        </p>}
        {state.status === 'ready' && state.items.length === 0 && <div className="pt-[108px] pb-6" role="status">
          <p className="m-0 text-control leading-[1.5] text-ink-3">{EMPTY_PAGE}</p>
          <a className="mt-2 inline-block border-b border-[color-mix(in_srgb,var(--s-ink-3)_35%,transparent)] text-control leading-[1.4] text-ink-3 no-underline hover:text-ink-2" href={RELEASES_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看</a>
        </div>}
        {state.status === 'ready' && state.items.length > 0 && <div data-shot="tl" className="relative pl-[18px] before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-[1.5px] before:bg-[color-mix(in_srgb,var(--s-ink-3)_45%,var(--s-page))]">
          {state.items.map((item, index) => <ReleaseBlock
            key={`${item.tag}-${item.publishedAt}`}
            item={item}
            index={index}
            installed={version}
          />)}
        </div>}
      </div>
    </section>
  </div>;
}
