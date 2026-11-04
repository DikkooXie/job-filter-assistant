import React, { useCallback, useEffect, useRef } from 'react';
import { runningDevBuild } from '../../common/build.js';
import { CHANGELOG_RETURN_KEY, SETTINGS_PAGES, changelogReturnTarget, formatSavedClock, isChangelogHash, nextNavIndex, sectionTargetId } from './pageHash.js';
import ChangelogPage from './ChangelogPage.jsx';

function Icon({ name }) {
  const common = { viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
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

function onNavKeyDown(event) {
  const links = [...event.currentTarget.querySelectorAll('a[href^="#"]')];
  const index = links.indexOf(document.activeElement);
  const next = nextNavIndex(index, event.key, links.length);
  if (next < 0 || next === index) return;
  event.preventDefault();
  const link = links[next];
  link.focus();
  if (link.hash !== location.hash) link.click();
}

function SaveStatus({ status, onRetry }) {
  if (!status || status.phase === 'idle') return null;
  const failed = status.phase === 'error';
  const saved = status.phase === 'saved';
  const className = `save-status${saved ? ' is-saved' : ''}${failed ? ' is-error' : ''}`;
  return <div className={className} role="status" aria-live="polite">
    <span className="save-dot" aria-hidden="true" />
    {status.phase === 'saving' && <span>保存中…</span>}
    {saved && <span>已自动保存 · {formatSavedClock(status.savedAt)}</span>}
    {failed && <button type="button" className="save-retry" onClick={onRetry}>保存失败，重试</button>}
  </div>;
}

export function ProfileRail({ score }) {
  const ratio = Math.max(0, Math.min(100, Number(score.score) || 0));
  return <aside className="settings-rail" aria-label="画像完整度">
    <div className="rail-card">
      <div className="rail-title">完整度</div>
      <div className="rail-score">{score.score}</div>
      <p className="rail-meta">{score.completed} / {score.total} 项</p>
      <div className="rail-meter" aria-hidden="true"><span style={{ width: `${ratio}%` }} /></div>
      {score.missing.length
        ? <ul className="rail-missing">{score.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p className="rail-meta">画像已相当完整</p>}
    </div>
  </aside>;
}

function VersionRow({ version, logOpen, onCheckUpdate, onOpenLog, logButtonRef }) {
  if (!version) return null;
  return <div className={logOpen ? 'settings-version is-log' : 'settings-version'}>
    <div className="settings-version-num">版本 {version}</div>
    <div className="settings-version-links">
      <button type="button" className="settings-version-check" onClick={onCheckUpdate}>检查更新</button>
      <span className="settings-version-dot" aria-hidden="true">·</span>
      <button
        ref={logButtonRef}
        type="button"
        className="settings-version-log"
        aria-current={logOpen ? 'page' : undefined}
        onClick={onOpenLog}
      >更新日志</button>
    </div>
  </div>;
}

function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  return <div className={notice.error ? 'settings-notice is-error' : 'settings-notice'} role={notice.error ? 'alert' : 'status'}>
    <span>{notice.message}</span>
    <button type="button" aria-label="关闭提示" onClick={onDismiss}>×</button>
  </div>;
}

export default function SettingsShell({ page, hash, title, status, onRetry, version, updateChannel, onCheckUpdate, notice, onDismissNotice, busy, rail, children }) {
  const logOpen = isChangelogHash(hash);
  const lead = SETTINGS_PAGES.find((item) => item.id === page)?.lead;
  const dev = runningDevBuild();
  const logButtonRef = useRef(null);
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
    {status?.phase === 'error' && <SaveStatus status={status} onRetry={onRetry} />}
  </> : null;

  return <div className="settings-shell" inert={busy ? true : undefined}>
    <aside className="settings-sidebar">
      <div className="settings-brand">
        <span className="settings-brand-mark"><Icon name="filters" /></span>
        <span className="settings-brand-name">Offercome</span>
        {dev && <span className="settings-dev">dev</span>}
      </div>
      <nav className="settings-nav" aria-label="设置页面" onKeyDown={onNavKeyDown}>
        {SETTINGS_PAGES.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={!logOpen && page === item.id ? 'page' : undefined}>
          <Icon name={item.id} />
          <span>{item.label}</span>
        </a>)}
      </nav>
      <VersionRow version={version} logOpen={logOpen} onCheckUpdate={onCheckUpdate} onOpenLog={openLog} logButtonRef={logButtonRef} />
    </aside>
    {logOpen
      ? <ChangelogPage channel={updateChannel} version={version} onBack={backFromLog} banner={banner} />
      : <div className="settings-main">
        <div className={page === 'profile' ? 'settings-frame is-profile' : 'settings-frame'}>
          <header className="settings-header">
            <div className="settings-heading">
              <h1>{title}</h1>
              {lead && <p className="settings-lead">{lead}</p>}
            </div>
            <SaveStatus status={status} onRetry={onRetry} />
          </header>
          <Notice notice={notice} onDismiss={onDismissNotice} />
          {page === 'profile'
            ? <div className="settings-columns"><div className="settings-page">{children}</div>{rail}</div>
            : <div className="settings-page">{children}</div>}
        </div>
      </div>}
  </div>;
}

export function extensionVersion() {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch {
    return '';
  }
}
