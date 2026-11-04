import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Briefcase, ChevronRight, CircleAlert, ExternalLink, Filter, HeartCrack, Search, Settings, Star, Trash2, X } from 'lucide-react';
import { GREETING_LEVELS, VERDICT_LABELS, DIM_LABELS } from '../../common/ai/prompts.js';
import { analysisGrade, exclusionReasons, flowEntryLabel, flowStatusLabel, platformLabel, riskLines } from './browseModel.js';

const DETAIL_TABS = [
  ['info', '岗位'],
  ['match', '匹配'],
  ['company', '公司'],
  ['resume', '简历'],
  ['flow', '流程'],
];

function Tags({ values }) {
  if (!values?.length) return null;
  return <div className="tags">{values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div>;
}

function Facts({ rows }) {
  const visible = rows.filter(([, value]) => value);
  if (!visible.length) return null;
  return (
    <dl className="facts">
      {visible.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function Analysis({ match }) {
  return (
    <div>
      {match.summary && <p>{match.summary}</p>}
      {match.eligible === false && match.blockers?.length > 0 && (
        <>
          <h3>存在硬性门槛</h3>
          <ul>{match.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </>
      )}
      {match.dims && ['skill', 'experience', 'requirement', 'location'].filter((key) => match.dims[key] != null).map((key) => (
        <div className="dim-row" key={key}>
          <span>{DIM_LABELS[key]}</span>
          <progress max="100" value={match.dims[key]} aria-label={DIM_LABELS[key]} />
          <span>{match.dims[key]}</span>
        </div>
      ))}
      {[['契合点', match.reasons], ['差距/需补齐', match.gaps], ['风险提示', match.risks]].map(([title, values]) => values?.length > 0 && (
        <div key={title}><h3>{title}</h3><ul>{values.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
      ))}
    </div>
  );
}

export function ListHeader({
  total, shown, view, filterEnabled, settingsReady, filterCount, applied, viewChanged, dev,
  onSearch, onClearSearch, onSort, onToggleFilters, onOpenFilters, onOpenCurrent, onOptions, onReset,
}) {
  return (
    <header className="app-header">
      <div className="app-heading">
        <h1>岗位库{dev && <span className="dev-mark">dev</span>}<span aria-label={`显示 ${shown} 个，共 ${total} 个`}>{shown === total ? total : `${shown} / ${total}`}</span></h1>
        <div className="heading-actions">
          <button type="button" className="header-icon" aria-label="当前岗位" title="当前岗位" onClick={onOpenCurrent}><Briefcase aria-hidden="true" /></button>
          <button type="button" className={`header-icon filter-trigger${filterCount ? ' has-filters' : ''}`} aria-label={filterCount ? `筛选，${filterCount} 个条件` : '筛选'} title="筛选" onClick={onOpenFilters}>
            <Filter aria-hidden="true" />
            {filterCount > 0 && <span className="filter-count">{filterCount}</span>}
          </button>
          <button type="button" className="header-icon" aria-label="设置" title="设置" onClick={onOptions}><Settings aria-hidden="true" /></button>
        </div>
      </div>
      <div className="search-line">
        <label className="search-box">
          <Search aria-hidden="true" />
          <input className="search-input" aria-label="搜索岗位、公司或技能" placeholder="搜索岗位、公司或技能" value={view.search} onChange={(event) => onSearch(event.target.value)} />
          {view.search && <button type="button" className="clear-search" aria-label="清除搜索" onClick={onClearSearch}><X aria-hidden="true" /></button>}
        </label>
      </div>
      <div className="view-toolbar">
        <label className="local-filter">
          <input type="checkbox" role="switch" checked={!!filterEnabled} disabled={!settingsReady} onChange={(event) => onToggleFilters(event.target.checked)} />
          <span className="switch-track" />
          <span>开启过滤</span>
        </label>
        <label className="sort-label">
          <select aria-label="岗位排序" value={view.sort} onChange={(event) => onSort(event.target.value)}>
            <option value="recent">最近收录</option>
            <option value="score">匹配优先</option>
            <option value="salary">月薪优先</option>
          </select>
        </label>
      </div>
      {viewChanged && (
        <div className="applied-filters">
          <span>{applied}</span>
          <button type="button" onClick={onReset}>重置视图</button>
        </div>
      )}
    </header>
  );
}

export function JobRow({ job, checked, returned, progressStatus, onToggle, onOpen, onStar, onDelete, onDislike }) {
  const grade = analysisGrade(job.match);
  const risks = riskLines(job);
  const reasons = exclusionReasons(job);
  const summary = grade ? (job.match?.summary || '') : '';
  const [confirming, setConfirming] = useState(null);
  const armedAt = useRef(0);
  const rowRef = useRef(null);
  const name = job.title || '岗位';

  useEffect(() => { setConfirming(null); }, [job.uid]);

  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setConfirming(null); };
    const onPointer = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest('[data-row-action]');
      if (action && rowRef.current?.contains(action) && action.dataset.rowAction === confirming) return;
      setConfirming(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [confirming]);

  const arm = (kind) => {
    if (confirming === kind) {
      if (performance.now() - armedAt.current < 180) return;
      setConfirming(null);
      if (kind === 'delete') onDelete();
      else onDislike();
      return;
    }
    armedAt.current = performance.now();
    setConfirming(kind);
  };

  return (
    <article ref={rowRef} className={`job-row${returned ? ' just-viewed' : ''}${confirming ? ' is-confirming' : ''}`} data-job-uid={job.uid}>
      <div className="row-top">
        <input type="checkbox" aria-label={`选择 ${job.company || ''} ${job.title || '岗位'}`} checked={checked} onChange={onToggle} />
        <button type="button" className="job-title" onClick={() => onOpen(job.uid, 'info')}>{job.title || '未命名岗位'}</button>
        {job.salaryText && <span className="salary">{job.salaryText}</span>}
      </div>
      <div className="row-body">
        <div className="company-row">
          <span className="company">{job.company || '公司未填写'}</span>
          <span className="source">{platformLabel(job.platform)}</span>
          {returned && <span className="viewed-cue">刚看过</span>}
          <button
            type="button"
            className={`star${job.star ? ' on' : ''}`}
            aria-pressed={!!job.star}
            aria-label={`${job.star ? '取消收藏' : '收藏'} ${job.company || job.title || ''}`}
            onClick={onStar}
          >
            <Star aria-hidden="true" fill={job.star ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="job-meta">
          {[ [job.city, job.district].filter(Boolean).join('·'), job.experience, job.degree ].filter(Boolean).map((item) => <span key={item}>{item}</span>)}
        </div>
        {(job.skills?.length ? job.skills : job.tags || []).length > 0 && (
          <ul className="skills" aria-label="岗位技能">{(job.skills?.length ? job.skills : job.tags).slice(0, 6).map((skill) => <li key={skill}>{skill}</li>)}</ul>
        )}
        <div className={`analysis${grade ? '' : ' bare'}`}>
          <div className="analysis-top">
            <button
              type="button"
              className="analysis-main"
              aria-label={grade ? `查看 ${job.company || '该岗位'} 的匹配分析：${grade.score} 分，${grade.label}` : `查看 ${job.company || '该岗位'} 的匹配，尚未分析`}
              onClick={() => onOpen(job.uid, 'match')}
            >
              {grade ? (
                <>
                  <span className="segs" aria-hidden="true">
                    {Array.from({ length: 5 }, (_, index) => (
                      <span key={index} className={index < grade.filled ? `cell on ${grade.tone}` : 'cell'} />
                    ))}
                  </span>
                  <span className={`grade ${grade.tone}`}>{grade.label}</span>
                </>
              ) : <span className="grade muted">尚未分析</span>}
            </button>
            {grade && (
              <button type="button" className={`score-num ${grade.tone}`} aria-label={`${grade.score} 分`} onClick={() => onOpen(job.uid, 'match')}>
                {grade.score}
              </button>
            )}
          </div>
          {summary && <button type="button" className="analysis-sub" title={summary} onClick={() => onOpen(job.uid, 'match')}>{summary}</button>}
        </div>
        {risks.map((line) => (
          <div className="risk" key={line}><CircleAlert aria-hidden="true" /><span>{line}</span></div>
        ))}
        <div className="row-actions">
          <div className="row-actions-inner">
            <div className={`actions-row${confirming ? ` is-confirm-${confirming}` : ''}`}>
              <button
                type="button"
                className="act-icon del"
                data-row-action="delete"
                aria-pressed={confirming === 'delete'}
                aria-hidden={confirming && confirming !== 'delete' ? true : undefined}
                tabIndex={confirming && confirming !== 'delete' ? -1 : 0}
                aria-label={confirming === 'delete' ? `确认删除 ${name}` : `删除 ${name}`}
                onClick={() => arm('delete')}
              >
                <Trash2 aria-hidden="true" />
                <span className="lbl" aria-hidden="true">删除</span>
              </button>
              <button
                type="button"
                className="act-icon dislike"
                data-row-action="dislike"
                aria-pressed={confirming === 'dislike'}
                aria-hidden={confirming && confirming !== 'dislike' ? true : undefined}
                tabIndex={confirming && confirming !== 'dislike' ? -1 : 0}
                aria-label={confirming === 'dislike' ? `确认不喜欢 ${name}` : `不喜欢 ${name}`}
                onClick={() => arm('dislike')}
              >
                <HeartCrack aria-hidden="true" />
                <span className="lbl" aria-hidden="true">不喜欢</span>
              </button>
              <button
                type="button"
                className={`act-greet${progressStatus ? ' progressed' : ''}`}
                data-row-action="greet"
                tabIndex={confirming ? -1 : 0}
                aria-hidden={confirming ? true : undefined}
                aria-label={`${job.company || '该岗位'}，${flowStatusLabel(progressStatus)}`}
                onClick={() => onOpen(job.uid, 'flow')}
              >
                {flowEntryLabel(progressStatus)}<ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        {reasons.length > 0 && (
          <div className="exclusion">
            <Filter aria-hidden="true" />
            <div><strong>开启过滤后将隐藏</strong><span>{reasons.join('；')}</span></div>
          </div>
        )}
      </div>
    </article>
  );
}

export function ListFooter({
  total, selectedCount, allSelected, indeterminate, busy, onToggleAll, onClear, onAnalyze, onPrepare, onNext, onExportVisible, onExportSelected, onClearLibrary,
}) {
  const selecting = selectedCount > 0;
  return (
    <footer className={`selection-bar${selecting ? ' is-selecting' : ''}`}>
      <label className="select-all">
        <input
          type="checkbox"
          aria-label="全选当前可见岗位"
          checked={allSelected}
          disabled={!total}
          ref={(element) => { if (element) element.indeterminate = indeterminate; }}
          onChange={onToggleAll}
        />
        <span>{selecting ? `已选 ${selectedCount}` : '全选'}</span>
      </label>
      {selecting ? (
        <>
          <button type="button" className="text-action" onClick={onClear}>取消</button>
          <button type="button" className="jp-btn jp-btn-primary" disabled={busy} onClick={onAnalyze}>批量分析 {selectedCount}</button>
          <div className="selection-extra">
            <button type="button" className="jp-btn" disabled={busy} onClick={onPrepare}>准备未处理岗位</button>
            <button type="button" className="jp-btn" disabled={busy} onClick={onNext}>处理下一个</button>
            <button type="button" className="jp-btn" onClick={onExportSelected}>导出已选</button>
          </div>
        </>
      ) : (
        <>
          <span className="selection-scope">当前可见</span>
          <button type="button" className="text-action" onClick={onClearLibrary}>清空</button>
          <button type="button" className="jp-btn jp-btn-primary" disabled={!total} onClick={onExportVisible}>导出 {total} 项</button>
        </>
      )}
    </footer>
  );
}

export function SurfaceState({ kind, message, viewChanged, onRetry, onReset, onBrowseBoss }) {
  if (kind === 'loading') {
    return (
      <div className="surface-state" role="status">
        <h2>正在读取岗位</h2>
        <div className="skeletons" aria-hidden="true"><i /><i /><i /></div>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="surface-state" role="alert">
        <CircleAlert className="surface-icon" aria-hidden="true" />
        <h2>岗位读取失败</h2>
        <p>{message || '本地数据暂时无法读取，请重试。'}</p>
        <button type="button" className="jp-btn jp-btn-primary" onClick={onRetry}>重新加载</button>
      </div>
    );
  }
  if (kind === 'empty') {
    return (
      <div className="surface-state">
        <h2>还没有收录岗位</h2>
        <p>打开 BOSS 直聘的岗位浏览页，看到的岗位会自动收录到这里。在前程无忧浏览也会收录。</p>
        <button type="button" className="jp-btn jp-btn-primary" onClick={onBrowseBoss}>去 BOSS 直聘浏览</button>
      </div>
    );
  }
  return (
    <div className="surface-state">
      <Search className="surface-icon" aria-hidden="true" />
      <h2>没有符合条件的岗位</h2>
      <p>试试其他关键词，或重置视图条件。这不是读取失败。</p>
      {viewChanged && <button type="button" className="jp-btn" onClick={onReset}>重置视图</button>}
    </div>
  );
}

function FlowStatus({ status }) {
  const steps = [
    ['准备招呼语', status === 'prepared' || status === 'opened' || status === 'sent'],
    ['尝试打开沟通', status === 'opened' || status === 'sent'],
    ['手动确认发送', status === 'sent'],
  ];
  const currentIndex = steps.findIndex(([, done]) => !done);
  return (
    <div>
      <p className="flow-now"><span>当前进度</span><strong>{flowStatusLabel(status)}</strong></p>
      <ol className="milestones" aria-label="打招呼进度">
        {steps.map(([label, done], index) => {
          const current = !done && index === currentIndex;
          return (
            <li key={label} className={done ? 'done' : current ? 'current' : ''} aria-current={current ? 'step' : undefined}>
              <span className="milestone-dot" aria-hidden="true" />
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function JobDetail({
  mode, job, sub, followLive, progressStatus, greeting, greetLevel, advice, scoring, tailoring,
  hasProfile, dev, onBack, onSub, onAnalyze, onRegenerate, onTailor, onGreeting, onGreetLevel, onCopy,
  onSend, onMarkSent, onOpenOriginal, onDelete, onProfileSettings,
}) {
  const titleRef = useRef(null);
  useEffect(() => { if (mode === 'job') titleRef.current?.focus(); }, [job?.uid, mode]);
  const onTabsKey = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next.click();
    next.focus();
  };
  return (
    <div className="detail-wrap">
      <section className="job-detail">
        <header className="detail-heading">
          <div className="detail-nav">
            <button type="button" className="back" onClick={onBack}><ArrowLeft aria-hidden="true" />岗位库</button>
            {dev && <span className="dev-mark">dev</span>}
          </div>
          {mode !== 'job' ? (
            <>
              <h2 tabIndex={-1}>{mode === 'removed' ? '岗位已不在列表中' : '未匹配到当前页面'}</h2>
              <p>{mode === 'removed' ? '它可能刚被删除或清出岗位库。返回后可以从列表继续。' : '在 BOSS直聘或前程无忧打开岗位详情后，再点当前岗位。'}</p>
            </>
          ) : (
            <>
              <div className="detail-title-line">
                <h2 ref={titleRef} tabIndex={-1}>{job.title || '未命名岗位'}</h2>
                {job.salaryText && <span className="salary">{job.salaryText}</span>}
              </div>
              <p>
                {[job.company, [job.city, job.district].filter(Boolean).join(' · '), job.experience, job.degree].filter(Boolean).join(' · ')}
                {followLive && <span className="follow-note"> · 跟随当前页面</span>}
              </p>
            </>
          )}
        </header>
        {mode === 'job' && (
          <>
            <div className="detail-tabs" role="tablist" aria-label="岗位详情" onKeyDown={onTabsKey}>
              {DETAIL_TABS.map(([key, label]) => (
                <button type="button" key={key} role="tab" aria-selected={sub === key} tabIndex={sub === key ? 0 : -1} onClick={() => onSub(key)}>{label}</button>
              ))}
            </div>
            <div className="detail-content" role="tabpanel">
              {sub === 'info' && (
                <>
                  <Facts rows={[
                    ['薪资', job.salaryText],
                    ['城市', [job.city, job.district].filter(Boolean).join(' · ')],
                    ['经验', job.experience],
                    ['学历', job.degree],
                    ['平台', job.platform === 'boss' ? 'BOSS直聘' : '前程无忧'],
                  ]} />
                  {(job.skills?.length || job.tags?.length) > 0 && <><h3>技能 / 标签</h3><Tags values={(job.skills?.length ? job.skills : job.tags).slice(0, 20)} /></>}
                  {job.welfare?.length > 0 && <><h3>福利</h3><Tags values={job.welfare.slice(0, 20)} /></>}
                  <h3>岗位描述</h3>
                  <p className="pre">{job.description || '暂无岗位描述。打开原岗位页面可以看招聘方发布的全文。'}</p>
                  {exclusionReasons(job).length > 0 && (
                    <div className="exclusion"><Filter aria-hidden="true" /><div><strong>开启过滤后将隐藏</strong><span>{exclusionReasons(job).join('；')}</span></div></div>
                  )}
                  {riskLines(job).map((line) => <div className="risk" key={line}><CircleAlert aria-hidden="true" /><span>{line}</span></div>)}
                  <div className="detail-actions">
                    {job.url && <button type="button" className="jp-btn jp-btn-primary" onClick={onOpenOriginal}><ExternalLink aria-hidden="true" />打开原岗位</button>}
                    <button type="button" className="jp-btn jp-btn-danger" onClick={onDelete}>删除</button>
                  </div>
                </>
              )}
              {sub === 'match' && (
                job.match ? (
                  <>
                    <div className={`analysis-score ${job.match.verdict || ''}`}><strong>{job.match.score}<small> / 100</small></strong><span>{VERDICT_LABELS[job.match.verdict] || '已分析'}</span></div>
                    <Analysis match={job.match} />
                    <div className="detail-actions">
                      <button type="button" className="jp-btn" disabled={scoring} onClick={onAnalyze}>{scoring ? '分析中…' : '重新分析'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>还没有匹配分析</h3>
                    <p>已保存的岗位里还没有这份结果。分析会使用你配置的模型接口。</p>
                    <div className="detail-actions">
                      <button type="button" className="jp-btn jp-btn-primary" disabled={scoring} onClick={onAnalyze}>{scoring ? '分析中…' : '分析匹配'}</button>
                    </div>
                  </>
                )
              )}
              {sub === 'company' && (
                <>
                  <Facts rows={[
                    ['公司', job.company],
                    ['行业', job.companyIndustry],
                    ['规模', job.companyScale],
                    ['性质', job.companyType],
                    ['阶段', job.companyStage],
                    ['HR', [job.hrName, job.hrTitle].filter(Boolean).join(' · ')],
                  ]} />
                  {![job.company, job.companyIndustry, job.companyScale, job.companyType, job.companyStage, job.hrName, job.hrTitle].some(Boolean) && <p>暂无公司信息。浏览岗位详情后，公开字段会补进岗位库。</p>}
                  <p className="fine-print">公司信息来自岗位接口返回的公开字段，仅供参考。</p>
                </>
              )}
              {sub === 'resume' && (
                !hasProfile ? <p>简历建议基于个人画像生成。<button type="button" className="text-action" onClick={onProfileSettings}>前往设置完善画像</button></p>
                  : (
                      <>
                        <div className="section-head">
                          <h3>简历定制建议</h3>
                          <button type="button" className="jp-btn jp-btn-primary" disabled={tailoring} onClick={onTailor}>{tailoring ? '生成中…' : advice ? '重新生成' : '生成建议'}</button>
                        </div>
                        <p className="fine-print">只给建议，不改原简历，也不写入岗位库。</p>
                        {tailoring && !advice && <p>正在生成建议…</p>}
                        {advice && (
                          <>
                            {[['可突出的匹配点', advice.matchedSkills], ['建议对齐的岗位关键词', advice.keywordsToAlign], ['暂未体现', advice.missingSkills]].map(([title, values]) => values?.length > 0 && (
                              <div key={title}><h3>{title}</h3><Tags values={values} /></div>
                            ))}
                            {advice.summaryDraft && (
                              <>
                                <h3>自我评价草稿</h3>
                                <p className="pre">{advice.summaryDraft}</p>
                                <button type="button" className="jp-btn" onClick={() => onCopy(advice.summaryDraft)}>复制草稿</button>
                              </>
                            )}
                            {[['经历改写建议', advice.bulletSuggestions], ['投递提醒', advice.tips]].map(([title, values]) => values?.length > 0 && (
                              <div key={title}><h3>{title}</h3><ul>{values.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
                            ))}
                            {advice.note && <p>{advice.note}</p>}
                          </>
                        )}
                      </>
                    )
              )}
              {sub === 'flow' && (
                <>
                  <FlowStatus status={progressStatus} />
                  {!job.match ? (
                      <div className="detail-actions">
                        <p>还没有可编辑的招呼语。可以先做一次匹配分析。</p>
                        <button type="button" className="jp-btn jp-btn-primary" disabled={scoring} onClick={onAnalyze}>{scoring ? '分析中…' : '生成招呼语'}</button>
                      </div>
                    ) : (
                      <div className="greeting-box">
                        <div className="level-row">
                          {GREETING_LEVELS.map((level) => (
                            <button type="button" key={level.key} className={`jp-btn${greetLevel === level.key ? ' jp-btn-primary' : ''}`} onClick={() => onGreetLevel(level.key)}>{level.label}</button>
                          ))}
                        </div>
                        <label htmlFor="greeting-text">招呼语</label>
                        <textarea id="greeting-text" rows={6} aria-label="招呼语" placeholder="编辑要发给招聘方的招呼语" value={greeting} onChange={(event) => onGreeting(event.target.value)} />
                        <div className="char-count">{greeting.length} 字</div>
                        <div className="flow-actions">
                          <button type="button" className="jp-btn" disabled={scoring} onClick={onRegenerate}>{scoring ? '生成中…' : '重新生成'}</button>
                          <button type="button" className="jp-btn" onClick={() => onCopy(greeting)}>复制</button>
                          <button type="button" className="jp-btn jp-btn-primary" onClick={onSend}>打开沟通并复制</button>
                          <button type="button" className="jp-btn" onClick={onMarkSent}>标记已发送</button>
                        </div>
                      </div>
                    )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function FilterSheet({ view, shown, onView, onReset, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement;
    const nodes = () => [...root.querySelectorAll('button,input,select,textarea')].filter((element) => !element.disabled);
    nodes()[0]?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = nodes();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="筛选岗位" ref={ref}>
        <header className="sheet-head">
          <h2>筛选岗位</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="sheet-content">
          <fieldset>
            <legend>平台</legend>
            <div className="segmented">
              {[['all', '全部'], ['boss', 'BOSS直聘'], ['qcwy', '前程无忧']].map(([key, label]) => (
                <button type="button" key={key} aria-pressed={view.platform === key} onClick={() => onView({ platform: key })}>{label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>匹配结果</legend>
            <div className="filter-options">
              {[['all', '全部'], ['strong', '强匹配'], ['good', '较匹配'], ['fair', '一般'], ['unscored', '未分析']].map(([key, label]) => (
                <label key={key}><input type="radio" name="verdict" checked={view.verdict === key} onChange={() => onView({ verdict: key })} />{label}</label>
              ))}
            </div>
          </fieldset>
          <div className="sheet-actions">
            <button type="button" className="jp-btn" onClick={onReset}>重置视图</button>
            <button type="button" className="jp-btn jp-btn-primary" onClick={onClose}>查看 {shown} 个岗位</button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ModelNotice({ onOpenSettings, onDismiss }) {
  return (
    <div className="model-notice" role="status">
      <span>尚未配置模型接口。</span>
      <button type="button" className="text-action" onClick={onOpenSettings}>前往设置</button>
      <button type="button" className="model-notice-close" aria-label="关闭提示" onClick={onDismiss}><X aria-hidden="true" /></button>
    </div>
  );
}

export function NoticeToast({ message, error }) {
  if (!message) return null;
  return <div className={`jp-toast${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</div>;
}
