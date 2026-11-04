import React, { useEffect, useRef, useState } from 'react';
import { RELEASES_PAGE, normalizeUpdateChannel } from '../../common/update.js';
import { fetchReleaseNotes } from '../../ui/update.js';

function formatLogDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function channelLead(channel) {
  return normalizeUpdateChannel(channel) === 'preview' ? '预览通道 · 含预发布' : '稳定通道 · 正式版';
}

export default function ChangelogDrawer({ open, channel, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ status: 'idle', items: [], error: '' });

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ status: 'loading', items: [], error: '' });
    fetchReleaseNotes(channel).then((items) => {
      if (!cancelled) setState({ status: 'ready', items, error: '' });
    }).catch((error) => {
      if (!cancelled) setState({ status: 'error', items: [], error: error?.message || '更新日志加载失败' });
    });
    return () => { cancelled = true; };
  }, [open, channel, reloadKey]);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(true);
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll('button, a[href]')].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const emptyText = normalizeUpdateChannel(channel) === 'preview' ? '还没有发布' : '还没有正式版';
  return <>
    <div className="settings-log-scrim" onClick={() => onClose(true)} />
    <section
      ref={panelRef}
      className="settings-log-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="settings-changelog-title"
      id="settings-changelog"
    >
      <header className="settings-log-head">
        <div>
          <h2 id="settings-changelog-title" className="settings-log-title">更新日志</h2>
          <p className="settings-log-sub">{channelLead(channel)}</p>
        </div>
        <button ref={closeRef} type="button" className="settings-log-close" aria-label="关闭更新日志" onClick={() => onClose(true)}>×</button>
      </header>
      <div className="settings-log-list">
        {state.status === 'loading' && <p className="settings-log-state" role="status">正在读取更新日志…</p>}
        {state.status === 'error' && <p className="settings-log-state" role="alert">
          <span>{state.error}</span>
          <button type="button" className="settings-log-retry" onClick={() => setReloadKey((n) => n + 1)}>重试</button>
        </p>}
        {state.status === 'ready' && state.items.length === 0 && <p className="settings-log-state" role="status">{emptyText}</p>}
        {state.status === 'ready' && state.items.map((item) => <article key={`${item.tag}-${item.publishedAt}`} className="settings-log-item">
          <time className="settings-log-date" dateTime={item.publishedAt || undefined}>{formatLogDate(item.publishedAt)}</time>
          <div className="settings-log-body">
            {item.pageUrl
              ? <a className="settings-log-ver" href={item.pageUrl} target="_blank" rel="noreferrer">{item.version}</a>
              : <div className="settings-log-ver">{item.version}</div>}
            {item.title ? <div className="settings-log-name">{item.title}</div> : null}
            {item.summary ? <p className={item.title ? 'settings-log-desc' : 'settings-log-name'}>{item.summary}</p> : null}
          </div>
        </article>)}
      </div>
      <footer className="settings-log-foot">
        <a href={RELEASES_PAGE} target="_blank" rel="noreferrer">在 GitHub 查看全部</a>
      </footer>
    </section>
  </>;
}
