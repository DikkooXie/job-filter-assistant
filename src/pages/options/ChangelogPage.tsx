import React, { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RELEASES_PAGE, CHANGELOG_SECTION_ORDER, isCurrentChangelogVersion, formatChangelogWhen } from '../../common/update.js';
import type { ChangelogEntry } from '../../common/update.js';
import { fetchReleaseNotes } from '../../extension/update.js';
import type { Settings } from '../../common/types.js';

const EMPTY_PAGE = '暂时还没有整理好的版本说明';
const UNCLASSIFIED = '本版暂无整理好的更新说明';

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>;
}

function Chevron() {
  return <svg className="settings-tl-chev" viewBox="0 0 24 24" aria-hidden="true">
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
    {items.map((text, index) => <li key={index}>{text}</li>)}
  </ul>;
}

interface FoldSectionProps {
  title: string;
  items: string[];
  controlsId: string;
}

function FoldSection({ title, items, controlsId }: FoldSectionProps) {
  const [open, setOpen] = useState(false);
  return <div className="settings-tl-sec">
    <button
      type="button"
      className="settings-tl-sec-head"
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={() => setOpen((value) => !value)}
    >
      <Chevron />
      <span className="settings-tl-sec-title">{title}</span>
      <span className="settings-tl-sec-count">{items.length}</span>
    </button>
    <BulletList id={controlsId} hidden={!open} items={items} className="settings-tl-bullets settings-tl-sec-body" />
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
  const className = `settings-tl-block${current ? ' is-current' : ''}${older ? ' is-older' : ''}`;
  const visible = CHANGELOG_SECTION_ORDER.filter((section) => sections[section.key]?.length > 0);
  return <article className={className}>
    <span className="settings-tl-node" aria-hidden="true" />
    <div className="settings-tl-meta">
      <span className="settings-tl-ver">{item.version}</span>
      {current && <span className="settings-tl-badge">当前</span>}
      {when && <time className="settings-tl-when" dateTime={item.publishedAt}>{when}</time>}
    </div>
    {visible.length === 0 && <p className="settings-tl-note">{UNCLASSIFIED}</p>}
    {visible.map((section) => {
      const items = sections[section.key];
      if (section.key === 'added') {
        return <BulletList key={section.key} items={items} className="settings-tl-bullets settings-tl-features" />;
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

  return <div className="settings-main is-log">
    <section className="settings-log-page" id="settings-changelog" aria-labelledby="settings-changelog-title">
      <header className="settings-log-top">
        <div className="settings-log-heading">
          <button ref={backRef} type="button" className="settings-log-back" aria-label="返回设置" onClick={onBack}>
            <BackIcon />
            设置
          </button>
          <h1 id="settings-changelog-title">更新日志</h1>
          <p className="settings-log-sub">近期版本改动一览 · 按发布时间排序</p>
        </div>
        <a className="settings-log-gh" href={RELEASES_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看全部</a>
      </header>
      <div className="settings-log-scroll">
        {banner}
        {state.status === 'loading' && <p className="settings-log-state" role="status">正在读取更新日志…</p>}
        {state.status === 'error' && <p className="settings-log-state" role="alert">
          <span>{state.error}</span>
          <button type="button" className="settings-log-retry" onClick={() => setReloadKey((n) => n + 1)}>重试</button>
        </p>}
        {state.status === 'ready' && state.items.length === 0 && <div className="settings-log-empty" role="status">
          <p>{EMPTY_PAGE}</p>
          <a href={RELEASES_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看</a>
        </div>}
        {state.status === 'ready' && state.items.length > 0 && <div className="settings-tl">
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
