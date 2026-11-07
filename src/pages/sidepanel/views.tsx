import React, { useEffect, useRef, useState } from 'react';
import markUrl from '../../../icons/128.png';
import { ArrowLeft, Briefcase, ChevronRight, CircleAlert, Download, ExternalLink, Filter, HeartCrack, MoreHorizontal, RefreshCw, Search, Settings, Star, Trash2, X } from 'lucide-react';
import { DIM_LABELS } from '../../common/ai/prompts.js';
import type { TailorSuggestion } from '../../common/ai/prompts.js';
import type { Job } from '../../common/types.js';
import { analysisGrade, analysisSummary, descriptionGap, exclusionReasons, flowEntryLabel, flowStatusLabel, jobDescriptionText, platformLabel, riskLines, warningZone } from './browseModel.js';
import type { AnalysisGrade, BrowseView } from './browseModel.js';
import type { CardCopy } from './batchQueue.js';
import { CommTab } from './CommTab.jsx';
import type { SuggestRequest } from './CommTab.jsx';
import type { CommState } from './commTab.js';

const DETAIL_TABS = [
  ['info', '岗位'],
  ['match', '分析'],
  ['company', '公司'],
  ['resume', '简历'],
  ['flow', '沟通'],
] as const;
const DIM_KEYS = ['skill', 'experience', 'requirement', 'location'] as const;

function Tags({ values }: { values?: string[] | null }) {
  if (!values?.length) return null;
  return <div className="tags">{values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div>;
}

function Facts({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
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

function GradeMarks({ grade }: { grade: AnalysisGrade }) {
  return (
    <span className="segs" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < grade.filled ? `cell on ${grade.tone}` : 'cell'} />
      ))}
    </span>
  );
}

function JobSummaryCard({ job, onOpenAnalysis }: { job: Job; onOpenAnalysis: () => void }) {
  const gap = descriptionGap(job);
  const summary = analysisSummary(job);
  if (gap || !summary.grade) {
    return (
      <section className="detail-summary">
        <h3>分析摘要</h3>
        <div className="analysis bare detail-sum">
          <div className="analysis-top">
            <span className={gap ? 'grade gap' : 'grade muted'}>{gap ? gap.label : '尚未分析'}</span>
          </div>
          {gap && <p className="detail-sum-copy">{gap.detail}</p>}
          <div className="sum-foot">
            <button type="button" className="detail-jump" onClick={onOpenAnalysis}>{gap ? '重试分析' : '去分析'}<ChevronRight aria-hidden="true" /></button>
          </div>
        </div>
      </section>
    );
  }
  const { grade } = summary;
  return (
    <section className="detail-summary">
      <h3>分析摘要</h3>
      <div className="analysis detail-sum">
        <div className="analysis-top">
          <div className="sum-main">
            <GradeMarks grade={grade} />
            <span className={`grade ${grade.tone}`}>{grade.label}</span>
          </div>
          <span className={`score-num ${grade.tone}`}>{grade.score}<span className="score-den">/100</span></span>
        </div>
        {summary.summary && <p className="detail-sum-copy">{summary.summary}</p>}
        <div className="sum-foot">
          {summary.warnLabel && (
            <span className="warn-chip warn">
              <span className="dot" aria-hidden="true" />
              {summary.warnLabel}
            </span>
          )}
          <button type="button" className="detail-jump" onClick={onOpenAnalysis}>查看完整分析<ChevronRight aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}

interface AnalysisBodyProps {
  job: Job;
  scoring: boolean;
  onAnalyze: () => void;
  onAccept: (line: string) => void;
}

function AnalysisBody({ job, scoring, onAnalyze, onAccept }: AnalysisBodyProps) {
  const gap = descriptionGap(job);
  const summary = analysisSummary(job);
  const risks = riskLines(job);
  const match = job.match;
  const blockers = match?.blockers ?? [];
  const reasons = match?.reasons ?? [];
  const gaps = match?.gaps ?? [];
  const dims = DIM_KEYS
    .map((key) => [key, match?.dims?.[key]] as const)
    .filter((entry): entry is readonly [typeof DIM_KEYS[number], number] => entry[1] != null);
  return (
    <>
      {gap ? (
        <p className="analysis-empty">{gap.detail}</p>
      ) : summary.grade ? (
        <>
          <div className="score-card">
            <div className="a-top">
              <div className="segs-row">
                <GradeMarks grade={summary.grade} />
                <span className={`grade ${summary.grade.tone}`}>{summary.grade.label}</span>
              </div>
              <div className="score-wrap">
                <span className={`score-num ${summary.grade.tone}`}>{summary.grade.score}</span>
                <span className="score-den">/100</span>
              </div>
            </div>
            {summary.summary && <p className="a-sum">{summary.summary}</p>}
          </div>
          {dims.length > 0 && (
            <div className="dims">
              {dims.map(([key, value]) => (
                <div className="dim" key={key}>
                  <span className="dim-lab">{DIM_LABELS[key]}</span>
                  <div className="dim-track" role="meter" aria-label={DIM_LABELS[key]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
                    <div className={value < 40 ? 'dim-fill low' : 'dim-fill'} style={{ width: `${value}%` }} />
                  </div>
                  <span className="dim-n">{value}</span>
                </div>
              ))}
            </div>
          )}
          {match?.eligible === false && blockers.length > 0 && (
            <section className="detail-sec">
              <h3>存在硬性门槛</h3>
              <ul className="bullet-list gap">{blockers.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          )}
          {reasons.length > 0 && (
            <section className="detail-sec">
              <h3>契合点</h3>
              <ul className="bullet-list">{reasons.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          )}
          {gaps.length > 0 && (
            <section className="detail-sec">
              <h3>差距 / 需补齐</h3>
              <ul className="bullet-list gap">{gaps.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          )}
        </>
      ) : (
        <p className="analysis-empty">尚未分析</p>
      )}
      {!gap && risks.length > 0 && (
        <section className="detail-sec">
          <h3>风险提示</h3>
          <div className="detail-warn">
            {risks.map((line) => (
              <div className="detail-warn-row" key={line}>
                <CircleAlert aria-hidden="true" />
                <span className="warn-txt">{line}</span>
                <button type="button" className="tune-link" onClick={() => onAccept(line)}>可以接受</button>
              </div>
            ))}
          </div>
        </section>
      )}
      <button type="button" className="reanalyze" disabled={scoring} onClick={onAnalyze}>
        <RefreshCw aria-hidden="true" />
        {scoring ? '分析中…' : summary.grade ? '重新分析' : gap ? '重试分析' : '分析'}
      </button>
    </>
  );
}

interface AcceptRiskSheetProps {
  risk: string;
  draft: string;
  saving: boolean;
  onDraft: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

function AcceptRiskSheet({ risk, draft, saving, onDraft, onClose, onSave }: AcceptRiskSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const field = root.querySelector('textarea');
    field?.focus();
    const nodes = () => [...root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')].filter((element) => !element.disabled);
    const onKey = (event: KeyboardEvent) => {
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="scrim accept-scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet accept-sheet" role="dialog" aria-modal="true" aria-labelledby="accept-risk-title" ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="accept-risk-title">接受这条</h2>
        <p className="sheet-sub">将这条风险记入画像偏好，后续同类可不提示</p>
        <p className="accept-origin"><strong>本条</strong>：{risk}</p>
        <label htmlFor="accept-risk-note">自然语言（可改）</label>
        <textarea id="accept-risk-note" rows={4} value={draft} onChange={(event) => onDraft(event.target.value)} />
        <div className="accept-actions">
          <button type="button" className="jp-btn" onClick={onClose}>取消</button>
          <button type="button" className="jp-btn jp-btn-primary" disabled={saving || !draft.trim()} onClick={onSave}>{saving ? '写入中…' : '写入画像'}</button>
        </div>
      </section>
    </div>
  );
}

interface DislikeSheetProps {
  job: Job | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: string) => Promise<boolean | string | undefined> | boolean | string | undefined;
}

export function DislikeSheet({ job, saving, onClose, onSave }: DislikeSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const field = root.querySelector('textarea');
    field?.focus();
    const nodes = () => [...root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')].filter((element) => !element.disabled);
    const onKey = (event: KeyboardEvent) => {
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const title = job?.title || '该岗位';
  const salary = String(job?.salaryText || '').trim();
  const city = String(job?.city || '').trim();
  const submit = async () => {
    if (saving || !draft.trim()) return;
    setError('');
    const result = await onSave(draft);
    if (typeof result === 'string' && result) setError(result);
  };
  return (
    <div className="scrim dislike-scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet dislike-sheet" role="dialog" aria-modal="true" aria-labelledby="dislike-title" ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="dislike-title">不喜欢的地方</h2>
        <p className="sheet-sub">画像不全易误判。用一句话告诉我要避开什么，写入画像。</p>
        <p className="dislike-context">针对 · <strong>{title}</strong>{salary ? ` · ${salary}` : ''}{city ? ` · ${city}` : ''}</p>
        <textarea
          id="dislike-note"
          rows={4}
          aria-label="不喜欢的地方"
          placeholder="例如：太偏销售、不要驻场…"
          value={draft}
          disabled={saving}
          onChange={(event) => { setDraft(event.target.value); if (error) setError(''); }}
        />
        {error && <p className="dislike-error" role="alert">{error}</p>}
        <div className="dislike-actions">
          <button type="button" className="jp-btn" disabled={saving} onClick={onClose}>取消</button>
          <button type="button" className="jp-btn jp-btn-primary" disabled={saving || !draft.trim()} onClick={submit}>确认写入</button>
        </div>
      </section>
    </div>
  );
}

function LibraryCount({ shown, total, freshCount, onShowFresh }: { shown: number; total: number; freshCount: number; onShowFresh: () => void }) {
  const fresh = freshCount > 0;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!fresh) {
      setExpanded(false);
      return undefined;
    }
    const id = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(id);
  }, [fresh]);
  if (!fresh) {
    return (
      <span className="library-count" aria-label={`显示 ${shown} 个，共 ${total} 个`}>
        {shown === total ? total : `${shown} / ${total}`}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`library-count is-fresh${expanded ? ' is-open' : ''}`}
      aria-label={`找到 ${freshCount} 个新岗位`}
      onClick={onShowFresh}
    >
      <span className="fresh-dot" aria-hidden="true" />
      <span>找到 {freshCount} 个新岗位</span>
    </button>
  );
}

interface ListHeaderProps {
  total: number;
  shown: number;
  freshCount: number;
  view: BrowseView;
  filterEnabled: boolean;
  settingsReady: boolean;
  filterCount: number;
  applied: string;
  viewChanged: boolean;
  dev: boolean;
  onSearch: (value: string) => void;
  onClearSearch: () => void;
  onSort: (sort: string) => void;
  onToggleFilters: (enabled: boolean) => void;
  onOpenFilters: () => void;
  onOpenCurrent: () => void;
  onOptions: () => void;
  onReset: () => void;
  onShowFresh: () => void;
}

export function ListHeader({
  total, shown, freshCount, view, filterEnabled, settingsReady, filterCount, applied, viewChanged, dev,
  onSearch, onClearSearch, onSort, onToggleFilters, onOpenFilters, onOpenCurrent, onOptions, onReset, onShowFresh,
}: ListHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-heading">
        <div className="heading-title">
          <img className="sp-logo" src={markUrl} alt="Offercome" width={28} height={28} />
          <h1>岗位库</h1>
          {dev && <span className="dev-mark">dev</span>}
          <span className="library-count-slot" aria-live="polite">
            <LibraryCount shown={shown} total={total} freshCount={freshCount} onShowFresh={onShowFresh} />
          </span>
        </div>
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

function AnalysisWarnings({ job }: { job: Job }) {
  const zone = warningZone(job);
  if (!zone) return null;
  return (
    <>
      <div className="warn-chips">
        <span className={`warn-chip ${zone.chip}`}>
          <span className="dot" aria-hidden="true" />
          {zone.label}
        </span>
      </div>
      <div className="warn-list">
        <div className="warn-list-inner">
          <ul className="warn-items">
            {zone.items.map((item, index) => (
              <li key={`${item.kind}-${index}`} className={item.kind === 'filter' ? 'warn-item filter-hit' : 'warn-item'}>
                <span className="pfx" aria-hidden="true">·</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

// 列表和详情共用：第一次点删除只进入确认，180ms 内的连点不算第二次，再点才提交。
function useDeleteConfirm(resetKey: string) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const armedAt = useRef(0);
  const scopeRef = useRef<HTMLElement>(null);

  useEffect(() => { setConfirming(null); }, [resetKey]);

  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirming(null); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest<HTMLElement>('[data-row-action]');
      if (action && scopeRef.current?.contains(action) && action.dataset.rowAction === confirming) return;
      setConfirming(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [confirming]);

  const arm = (kind: string) => {
    if (confirming === kind) {
      if (performance.now() - armedAt.current < 180) return false;
      setConfirming(null);
      return true;
    }
    armedAt.current = performance.now();
    setConfirming(kind);
    return false;
  };

  return { confirming, arm, scopeRef };
}

interface JobRowProps {
  job: Job;
  checked: boolean;
  returned: boolean;
  isNew: boolean;
  progressStatus?: string | null;
  queueCard: CardCopy | null;
  onToggle: () => void;
  onOpen: (uid: string, sub: string) => void;
  onStar: () => void;
  onDelete: () => void;
  onDislike: () => void;
}

export function JobRow({ job, checked, returned, isNew, progressStatus, queueCard, onToggle, onOpen, onStar, onDelete, onDislike }: JobRowProps) {
  const gap = descriptionGap(job);
  const grade = gap ? null : analysisGrade(job.match);
  const summary = grade ? (job.match?.summary || '') : '';
  const { confirming, arm, scopeRef } = useDeleteConfirm(job.uid);
  const name = job.title || '岗位';
  const skills = job.skills?.length ? job.skills : (job.tags || []);

  return (
    <article ref={scopeRef} className={`job-row${returned ? ' just-viewed' : ''}${isNew ? ' is-new' : ''}${confirming ? ' is-confirming' : ''}`} data-job-uid={job.uid}>
      <div className="row-top">
        <input type="checkbox" aria-label={`选择 ${job.company || ''} ${job.title || '岗位'}`} checked={checked} onChange={onToggle} />
        <button type="button" className="job-title" onClick={() => onOpen(job.uid, 'info')}>
          {job.title || '未命名岗位'}
          {isNew && <span className="job-new">NEW</span>}
        </button>
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
        {skills.length > 0 && (
          <ul className="skills" aria-label="岗位技能">{skills.slice(0, 6).map((skill) => <li key={skill}>{skill}</li>)}</ul>
        )}
        <div className={`analysis${grade ? '' : ' bare'}${queueCard ? ` queue-${queueCard.kind}` : ''}`}>
          <div className="analysis-top">
            <button
              type="button"
              className="analysis-main"
              aria-label={queueCard ? `${job.company || '该岗位'}，${queueCard.label}` : grade ? `查看 ${job.company || '该岗位'} 的分析：${grade.score} 分，${grade.label}` : `查看 ${job.company || '该岗位'} 的分析，${gap ? gap.label : '尚未分析'}`}
              onClick={() => onOpen(job.uid, 'match')}
            >
              {queueCard ? (
                <span className="queue-card-line">
                  {queueCard.kind === 'running' && <i className="batch-spin" aria-hidden="true" />}
                  <span className="grade">{queueCard.label}</span>
                </span>
              ) : gap ? (
                <span className="grade gap">{gap.label}</span>
              ) : grade ? (
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
            {!queueCard && grade && (
              <button type="button" className={`score-num ${grade.tone}`} aria-label={`${grade.score} 分`} onClick={() => onOpen(job.uid, 'match')}>
                {grade.score}
              </button>
            )}
          </div>
          {queueCard?.hint && <p className="queue-card-hint">{queueCard.hint}</p>}
          {!queueCard && summary && <button type="button" className="analysis-sub" title={summary} onClick={() => onOpen(job.uid, 'match')}>{summary}</button>}
          {!queueCard && <AnalysisWarnings job={job} />}
        </div>
        <ListRowActions
          name={name}
          company={job.company}
          confirming={confirming}
          progressStatus={progressStatus}
          onDelete={() => { if (arm('delete')) onDelete(); }}
          onDislike={onDislike}
          onGreet={() => onOpen(job.uid, 'flow')}
        />
      </div>
    </article>
  );
}

function DeleteRowButton({ confirming, name, onClick }: { confirming: string | null; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="act-icon del"
      data-row-action="delete"
      aria-pressed={confirming === 'delete'}
      aria-hidden={confirming && confirming !== 'delete' ? true : undefined}
      tabIndex={confirming && confirming !== 'delete' ? -1 : 0}
      aria-label={confirming === 'delete' ? `再次点击确认删除 ${name}` : `删除 ${name}`}
      onClick={onClick}
    >
      <Trash2 aria-hidden="true" />
      <span className="lbl" aria-hidden="true">{confirming === 'delete' ? '再次点击确认删除' : '删除'}</span>
    </button>
  );
}

function DislikeRowButton({ confirming, name, onDislike }: { confirming: string | null; name: string; onDislike: () => void }) {
  return (
    <button
      type="button"
      className="act-icon dislike"
      data-row-action="dislike"
      aria-hidden={confirming ? true : undefined}
      tabIndex={confirming ? -1 : 0}
      aria-label={`不喜欢 ${name}`}
      onClick={onDislike}
    >
      <HeartCrack aria-hidden="true" />
      <span className="lbl" aria-hidden="true">不喜欢</span>
    </button>
  );
}

interface ListRowActionsProps {
  name: string;
  company?: string;
  confirming: string | null;
  progressStatus?: string | null;
  onDelete: () => void;
  onDislike: () => void;
  onGreet: () => void;
}

function ListRowActions({ name, company, confirming, progressStatus, onDelete, onDislike, onGreet }: ListRowActionsProps) {
  return (
    <div className="row-actions">
      <div className="row-actions-inner">
        <div className={`actions-row${confirming ? ` is-confirm-${confirming}` : ''}`}>
          <DeleteRowButton confirming={confirming} name={name} onClick={onDelete} />
          <DislikeRowButton confirming={confirming} name={name} onDislike={onDislike} />
          <button
            type="button"
            className={`act-greet${progressStatus ? ' progressed' : ''}`}
            data-row-action="greet"
            tabIndex={confirming ? -1 : 0}
            aria-hidden={confirming ? true : undefined}
            aria-label={`${company || '该岗位'}，${flowStatusLabel(progressStatus)}`}
            onClick={onGreet}
          >
            {flowEntryLabel(progressStatus)}<ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailActionBar({ job, onOpenOriginal, onStar, onDislike, onDelete }: {
  job: Job;
  onOpenOriginal: () => void;
  onStar: () => void;
  onDislike: () => void;
  onDelete: () => void;
}) {
  const name = job.title || '岗位';
  const starred = !!job.star;
  const { confirming, arm, scopeRef } = useDeleteConfirm(job.uid);
  return (
    <footer className="detail-sticky" ref={scopeRef}>
      <div className={`actions-row${confirming ? ` is-confirm-${confirming}` : ''}`}>
        <button
          type="button"
          className="jp-btn jp-btn-primary detail-open"
          data-row-action="open"
          disabled={!job.url}
          aria-hidden={confirming ? true : undefined}
          tabIndex={confirming ? -1 : 0}
          onClick={onOpenOriginal}
        >
          <ExternalLink aria-hidden="true" />打开原岗位
        </button>
        <button
          type="button"
          className={`act-icon fav${starred ? ' is-on' : ''}`}
          data-row-action="star"
          aria-pressed={starred}
          aria-hidden={confirming ? true : undefined}
          tabIndex={confirming ? -1 : 0}
          aria-label={starred ? `取消收藏 ${name}` : `收藏 ${name}`}
          onClick={onStar}
        >
          <Star aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
          <span className="lbl" aria-hidden="true">{starred ? '取消收藏' : '收藏'}</span>
        </button>
        <DislikeRowButton confirming={confirming} name={name} onDislike={onDislike} />
        <DeleteRowButton confirming={confirming} name={name} onClick={() => { if (arm('delete')) onDelete(); }} />
      </div>
    </footer>
  );
}

interface ListFooterProps {
  total: number;
  selectedCount: number;
  allSelected: boolean;
  indeterminate: boolean;
  menuOpen: boolean;
  onToggleAll: () => void;
  onToggleMenu: (open: boolean) => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
  onAnalyze: () => void;
  onWorkbench: () => void;
}

export function ListFooter({
  total, selectedCount, allSelected, indeterminate, menuOpen,
  onToggleAll, onToggleMenu, onDeleteSelected, onExportSelected, onAnalyze, onWorkbench,
}: ListFooterProps) {
  const selecting = selectedCount > 0;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggleMenu(false); };
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target instanceof Node ? event.target : null)) onToggleMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen, onToggleMenu]);
  return (
    <footer className={`selection-bar${selecting ? ' is-selecting' : ''}`}>
      <label className="select-all">
        <input
          type="checkbox"
          aria-label="全选"
          checked={allSelected}
          disabled={!total}
          ref={(element) => { if (element) element.indeterminate = indeterminate; }}
          onChange={onToggleAll}
        />
        <span>全选</span>
        {selecting && <span className="selected-count">已选 {selectedCount}</span>}
      </label>
      {selecting ? (
        <div className="selection-actions">
          <div className="more-wrap" ref={menuRef}>
            {menuOpen && (
              <div className="more-menu" role="menu" aria-label="更多操作">
                <button type="button" role="menuitem" className="more-item" onClick={onDeleteSelected}>
                  <Trash2 aria-hidden="true" />删除
                </button>
              </div>
            )}
            <button
              type="button"
              className={`ghost-icon${menuOpen ? ' is-active' : ''}`}
              aria-label="更多"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => onToggleMenu(!menuOpen)}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="ghost-icon" aria-label="导出已选岗位" title="导出" onClick={onExportSelected}>
            <Download aria-hidden="true" />
          </button>
          <button type="button" className="jp-btn jp-btn-primary workbench-btn" onClick={onAnalyze}>
            智能分析<ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button type="button" className="jp-btn jp-btn-primary workbench-btn" onClick={onWorkbench}>
          进入工作台<ChevronRight aria-hidden="true" />
        </button>
      )}
    </footer>
  );
}

interface AnalyzeChoice {
  id: string;
  title: string;
  desc: string;
  tag?: string;
  disabled?: boolean;
}

const ANALYZE_CHOICES: AnalyzeChoice[] = [
  { id: 'unscored', title: '只分析尚未分析的', desc: '跳过已有分数的岗位，只补未分析项', tag: '推荐' },
  { id: 'force', title: '全部重新分析', desc: '覆盖已有结果，按当前画像重跑全部已选' },
  { id: 'fingerprint', title: '只分析当前画像下未分析的', desc: '跳过已在当前画像下分析过的岗位；画像变化后的旧结果会重新分析' },
];

export function AnalyzeSheet({ selectedCount, onClose, onStart }: { selectedCount: number; onClose: () => void; onStart: (mode: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mode, setMode] = useState('unscored');
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const nodes = () => [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea')].filter((element) => !element.disabled);
    nodes()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet analyze-sheet" role="dialog" aria-modal="true" aria-labelledby="analyze-title" ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="analyze-title">智能分析</h2>
        <p className="analyze-sub">已选 {selectedCount} 个岗位 · 选择分析范围</p>
        <div className="analyze-options" role="radiogroup" aria-label="分析范围">
          {ANALYZE_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice.id}
              role="radio"
              aria-checked={!choice.disabled && mode === choice.id}
              aria-disabled={choice.disabled || undefined}
              disabled={choice.disabled}
              className={`analyze-option${mode === choice.id ? ' is-selected' : ''}${choice.disabled ? ' is-disabled' : ''}`}
              onClick={() => { if (!choice.disabled) setMode(choice.id); }}
            >
              <span className="analyze-radio" aria-hidden="true" />
              <span className="analyze-copy">
                <span className="analyze-label">
                  {choice.title}
                  {choice.tag === '推荐' && <span className="tag-recommend">推荐</span>}
                </span>
                <span className="analyze-desc">{choice.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="analyze-actions">
          <button type="button" className="jp-btn" onClick={onClose}>取消</button>
          <button type="button" className="jp-btn jp-btn-primary" onClick={() => onStart(mode)}>开始分析</button>
        </div>
      </section>
    </div>
  );
}

export function SurfaceState({ kind, message, viewChanged, onRetry, onReset, onBrowseBoss }: {
  kind: 'loading' | 'error' | 'empty' | 'nomatch';
  message?: string | null;
  viewChanged?: boolean;
  onRetry?: () => void;
  onReset?: () => void;
  onBrowseBoss?: () => void;
}) {
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
        <p>打开 BOSS 直聘的岗位浏览页，看到的岗位会自动收录到这里。</p>
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

interface JobDetailProps {
  mode: 'job' | 'removed' | 'unmatched' | null;
  job: Job | null;
  sub: string;
  followLive: boolean;
  progressStatus?: string | null;
  greeting: string;
  advice: TailorSuggestion | null | undefined;
  scoring: boolean;
  tailoring: boolean;
  hasProfile: boolean;
  dev: boolean;
  comm?: CommState | null;
  onBack: () => void;
  onSub: (sub: string) => void;
  onAnalyze: () => void;
  onRegenerate: () => void;
  onTailor: () => void;
  onGreeting: (value: string) => void;
  onCopy: (text: string) => void;
  onSend: () => void;
  onOpenChat: (text: string) => void;
  onComm: (record: CommState) => void;
  onNotice: (message: string, error?: boolean) => void;
  onSuggest?: (job: Job, payload: SuggestRequest) => Promise<{ text?: string } | null | undefined> | null | undefined;
  onMarkSent: () => void;
  onOpenOriginal: () => void;
  onStar: () => void;
  onDislike: () => void;
  onDelete: () => void;
  onAcceptRisk?: (text: string) => Promise<boolean>;
  onProfileSettings: () => void;
}

export function JobDetail({
  mode, job, sub, followLive, progressStatus, greeting, advice, scoring, tailoring,
  hasProfile, dev, comm, onBack, onSub, onAnalyze, onRegenerate, onTailor, onGreeting, onCopy,
  onSend, onOpenChat, onComm, onNotice, onSuggest, onMarkSent, onOpenOriginal, onStar, onDislike, onDelete, onAcceptRisk, onProfileSettings,
}: JobDetailProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptDraft, setAcceptDraft] = useState('');
  const [acceptSaving, setAcceptSaving] = useState(false);
  useEffect(() => { if (mode === 'job') titleRef.current?.focus(); }, [job?.uid, mode]);
  useEffect(() => { setAccepting(null); setAcceptDraft(''); }, [job?.uid, sub]);
  const openAccept = (line: string) => {
    setAccepting(line);
    setAcceptDraft(`可以接受：${line}`);
  };
  const saveAccept = async () => {
    const text = acceptDraft.trim();
    if (!text || acceptSaving) return;
    setAcceptSaving(true);
    try {
      const ok = await onAcceptRisk?.(text);
      if (ok !== false) setAccepting(null);
    } finally {
      setAcceptSaving(false);
    }
  };
  const onTabsKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next?.click();
    next?.focus();
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
              <p>{mode === 'removed' ? '它可能刚被删除或清出岗位库。返回后可以从列表继续。' : '在 BOSS直聘打开岗位详情后，再点当前岗位。'}</p>
            </>
          ) : (
            <>
              <div className="detail-title-line">
                <h2 ref={titleRef} tabIndex={-1}>{job?.title || '未命名岗位'}</h2>
                {job?.salaryText && <span className="salary">{job.salaryText}</span>}
              </div>
              <p>
                {[job?.company, [job?.city, job?.district].filter(Boolean).join(' · '), job?.experience, job?.degree].filter(Boolean).join(' · ')}
                {followLive && <span className="follow-note"> · 跟随当前页面</span>}
              </p>
            </>
          )}
        </header>
        {mode === 'job' && job && (
          <>
            <div className="detail-tabs" role="tablist" aria-label="岗位详情" onKeyDown={onTabsKey}>
              {DETAIL_TABS.map(([key, label]) => (
                <button type="button" key={key} role="tab" aria-selected={sub === key} tabIndex={sub === key ? 0 : -1} onClick={() => onSub(key)}>{label}</button>
              ))}
            </div>
            {sub !== 'flow' && <div className="detail-content" role="tabpanel">
              {sub === 'info' && (
                <>
                  <Facts rows={[
                    ['薪资', job.salaryText],
                    ['城市', [job.city, job.district].filter(Boolean).join(' · ')],
                    ['经验', job.experience],
                    ['学历', job.degree],
                    ['平台', job.platform === 'boss' ? 'BOSS直聘' : '其他平台'],
                  ]} />
                  {(job.skills?.length || job.tags?.length || 0) > 0 && <><h3>技能 / 标签</h3><Tags values={(job.skills?.length ? job.skills : job.tags || []).slice(0, 20)} /></>}
                  {(job.welfare?.length ?? 0) > 0 && <><h3>福利</h3><Tags values={job.welfare?.slice(0, 20)} /></>}
                  <h3>岗位描述</h3>
                  <p className="pre desc-box">{jobDescriptionText(job)}</p>
                  {exclusionReasons(job).length > 0 && (
                    <div className="exclusion"><Filter aria-hidden="true" /><div><strong>开启过滤后将隐藏</strong><span>{exclusionReasons(job).join('；')}</span></div></div>
                  )}
                  <JobSummaryCard job={job} onOpenAnalysis={() => onSub('match')} />
                </>
              )}
              {sub === 'match' && (
                <AnalysisBody job={job} scoring={scoring} onAnalyze={onAnalyze} onAccept={openAccept} />
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
                            {([['可突出的匹配点', advice.matchedSkills], ['建议对齐的岗位关键词', advice.keywordsToAlign], ['暂未体现', advice.missingSkills]] as Array<[string, string[]]>).map(([title, values]) => values.length > 0 && (
                              <div key={title}><h3>{title}</h3><Tags values={values} /></div>
                            ))}
                            {advice.summaryDraft && (
                              <>
                                <h3>自我评价草稿</h3>
                                <p className="pre">{advice.summaryDraft}</p>
                                <button type="button" className="jp-btn" onClick={() => onCopy(advice.summaryDraft)}>复制草稿</button>
                              </>
                            )}
                            {([['经历改写建议', advice.bulletSuggestions], ['投递提醒', advice.tips]] as Array<[string, string[]]>).map(([title, values]) => values.length > 0 && (
                              <div key={title}><h3>{title}</h3><ul>{values.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
                            ))}
                            {advice.note && <p>{advice.note}</p>}
                          </>
                        )}
                      </>
                    )
              )}
            </div>}
            {sub === 'flow' && (
              <CommTab
                job={job}
                progressStatus={progressStatus}
                record={comm}
                greeting={greeting}
                scoring={scoring}
                onGreeting={onGreeting}
                onCopy={onCopy}
                onAnalyze={onAnalyze}
                onRegenerate={onRegenerate}
                onSendGreeting={onSend}
                onMarkSent={onMarkSent}
                onOpenChat={onOpenChat}
                onComm={onComm}
                onNotice={onNotice}
                onSuggest={(payload) => onSuggest?.(job, payload)}
              />
            )}
            {sub !== 'flow' && (
              <DetailActionBar
                job={job}
                onOpenOriginal={onOpenOriginal}
                onStar={onStar}
                onDislike={onDislike}
                onDelete={onDelete}
              />
            )}
            {accepting && (
              <AcceptRiskSheet
                risk={accepting}
                draft={acceptDraft}
                saving={acceptSaving}
                onDraft={setAcceptDraft}
                onClose={() => { if (!acceptSaving) setAccepting(null); }}
                onSave={saveAccept}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function FilterSheet({ view, shown, onView, onReset, onClose }: {
  view: BrowseView;
  shown: number;
  onView: (patch: BrowseView) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement;
    const nodes = () => [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea')].filter((element) => !element.disabled);
    nodes()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
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
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
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

export function ModelNotice({ onOpenSettings, onDismiss }: { onOpenSettings: () => void; onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-jp-line bg-jp-field py-[7px] pr-2 pl-3 text-hint leading-[1.5] text-jp-secondary" role="status">
      <span>尚未配置模型接口。</span>
      <button type="button" className="text-action ml-auto" onClick={onOpenSettings}>前往设置</button>
      <button type="button" className="inline-flex size-7 items-center justify-center rounded-md text-jp-muted hover:!bg-jp-inset hover:!text-jp-ink" aria-label="关闭提示" onClick={onDismiss}><X aria-hidden="true" /></button>
    </div>
  );
}

