import React, { useEffect, useRef, useState } from 'react';
import { RELEASES_PAGE, isCurrentChangelogVersion, formatChangelogWhen, normalizeUpdateChannel } from '../../common/update.js';
import { fetchReleaseNotes } from '../../ui/update.js';

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>;
}

export default function ChangelogPage({ channel, version, onBack, banner }) {
  const backRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ status: 'loading', items: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], error: '' });
    fetchReleaseNotes(channel).then((items) => {
      if (!cancelled) setState({ status: 'ready', items, error: '' });
    }).catch((error) => {
      if (!cancelled) setState({ status: 'error', items: [], error: error?.message || '更新日志加载失败' });
    });
    return () => { cancelled = true; };
  }, [channel, reloadKey]);

  useEffect(() => { backRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const emptyText = normalizeUpdateChannel(channel) === 'preview' ? '还没有发布' : '还没有正式版';

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
        {state.status === 'ready' && state.items.length === 0 && <p className="settings-log-state" role="status">{emptyText}</p>}
        {state.status === 'ready' && state.items.length > 0 && <div className="settings-tl">
          {state.items.map((item, index) => {
            const current = isCurrentChangelogVersion(item.version, version);
            const older = !current && index >= 3;
            const when = formatChangelogWhen(item.publishedAt);
            const className = `settings-tl-block${current ? ' is-current' : ''}${older ? ' is-older' : ''}`;
            return <article key={`${item.tag}-${item.publishedAt}`} className={className}>
              <span className="settings-tl-node" aria-hidden="true" />
              <div className="settings-tl-meta">
                <span className="settings-tl-ver">{item.version}</span>
                {current && <span className="settings-tl-badge">当前</span>}
                {when && <time className="settings-tl-when" dateTime={item.publishedAt}>{when}</time>}
              </div>
              {item.bullets?.length > 0 && <ul className="settings-tl-bullets">
                {item.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
              </ul>}
            </article>;
          })}
        </div>}
      </div>
    </section>
  </div>;
}
