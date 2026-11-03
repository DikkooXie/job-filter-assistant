// THROWAWAY #30: 三种岗位侧栏结构，?variant=A|B|C；仅内存模拟，不导入扩展消息或存储。
// 独立相邻入口用于隔离真实个人数据；生产 Vite input 不包含此页面。
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleAlert, ExternalLink, FileText, Filter, Info, ListFilter, LoaderCircle, MoreHorizontal, Search, Star, ThumbsDown, X } from 'lucide-react';
import './sidepanel-prototype.css';

const variants = {
  A: { name: '紧凑清单', purpose: '先比较，再处理', description: '按收录顺序连续浏览，筛选收进一个入口。每条岗位保留薪资、匹配与沟通进度，打开详情后返回原位并提示刚看过的岗位。', tradeoff: '连续扫读最直接；深度比较需要往返详情。' },
  B: { name: '处理阶段', purpose: '围绕下一步行动', description: '岗位按真实沟通进度分组，每组直接呈现下一步动作。展开、收起分组，在收录与跟进之间切换。', tradeoff: '跟进路径最清楚；跨阶段比较岗位需要切换分组。' },
  C: { name: '列表 / 详情', purpose: '边选边看', description: '上方候选列表，下方固定详情。在窄侧栏用上下分区保留上下文，切换岗位时分析与详情就地更新。', tradeoff: '适合逐条精读；同时看见的候选更少。' },
};
const stages = { none: '待打招呼', prepared: '招呼语已准备', opened: '待确认发送', sent: '已发送（手动确认）' };
const ruleCopy = { label: '应用筛选规则', hint: '隐藏不符合规则的岗位；关闭后仍标注原因。' };
const initialRules = { include: '', exclude: '外包、实习', companies: '', cities: '', salary: '' };
const ruleWords = value => value.split(/[,，、\n]/).map(word => word.trim()).filter(Boolean);
const exclusionReason = (job, rules) => {
  const text = `${job.title} ${job.company} ${job.skills.join(' ')} ${job.exclude}`;
  const excluded = ruleWords(rules.exclude).find(word => text.includes(word));
  if (excluded) return `命中排除词：${excluded}`;
  if (ruleWords(rules.include).length && !ruleWords(rules.include).some(word => text.includes(word))) return '未命中包含词';
  if (ruleWords(rules.companies).some(word => job.company.includes(word))) return '命中屏蔽公司';
  if (ruleWords(rules.cities).length && !ruleWords(rules.cities).includes(job.city)) return `城市不符合：${job.city}`;
  if (rules.salary && (job.salary.includes('天') || parseInt(job.salary) < Number(rules.salary))) return '薪资未达到月薪下限';
  return '';
};
const flowLabels = { none: '打招呼', prepared: '继续流程', opened: '确认发送', sent: '查看流程' };
const verdicts = { strong: '强匹配', good: '较匹配', weak: '一般', none: '未分析' };
const seedJobs = [
  { id: 1, title: '前端开发工程师', salary: '18–25K', company: '青禾科技', city: '深圳', area: '南山', exp: '应届', degree: '本科', platform: 'BOSS', scale: '100–499人', skills: ['Vue 3', 'TypeScript', 'AI 应用'], score: 92, verdict: 'strong', stage: 'none', starred: true, risk: '', exclude: '', note: 'Vue 与 TypeScript 要求吻合，有 AI 应用工程实践的加分项。' },
  { id: 2, title: 'AI 应用全栈工程师', salary: '20–30K', company: '远山智能', city: '深圳', area: '福田', exp: '1–3年', degree: '本科', platform: 'BOSS', scale: '20–99人', skills: ['React', 'Node.js', 'LLM'], score: 84, verdict: 'good', stage: 'none', starred: false, risk: '要求独立交付，沟通时确认是否接受应届生', exclude: '', note: '技术方向契合，但独立交付经验要求高于应届岗位，建议在沟通中确认。' },
  { id: 3, title: 'Web 前端开发（校招）', salary: '15–22K', company: '方舟网络', city: '广州', area: '天河', exp: '应届', degree: '本科', platform: '51job', scale: '500–999人', skills: ['JavaScript', 'Vue', '工程化'], score: null, verdict: 'none', stage: 'none', starred: false, risk: '', exclude: '', note: '' },
  { id: 4, title: '前端工程师 · 企业级低代码与可视化协作平台方向', salary: '18–28K', company: '墨石软件', city: '深圳', area: '宝安', exp: '1–3年', degree: '本科', platform: 'BOSS', scale: '100–499人', skills: ['React', '可视化', '组件库'], score: 78, verdict: 'good', stage: 'prepared', starred: false, risk: '', exclude: '', note: '组件开发与工程化经验相关，需要补充复杂业务场景的实践说明。' },
  { id: 5, title: '前端开发工程师', salary: '12–16K', company: '城际信息服务', city: '深圳', area: '龙岗', exp: '1–3年', degree: '本科', platform: '51job', scale: '100–499人', skills: ['Vue', '小程序'], score: 61, verdict: 'weak', stage: 'none', starred: false, risk: '含“驻场”，沟通时确认工作地点与安排', exclude: '命中排除词：外包', note: '技术栈部分匹配，岗位涉及驻场和外包交付，需确认劳动合同主体。' },
  { id: 6, title: 'Node.js 后端开发', salary: '18–26K', company: '松果云', city: '杭州', area: '滨江', exp: '应届', degree: '本科', platform: 'BOSS', scale: '20–99人', skills: ['Node.js', 'NestJS', 'SQL'], score: 86, verdict: 'good', stage: 'opened', starred: true, risk: '', exclude: '', note: 'Node.js 和 NestJS 经验与岗位要求相符，需进一步确认数据库能力要求。' },
  { id: 7, title: '前端开发实习生', salary: '200–250 / 天', company: '白鹭互动', city: '上海', area: '徐汇', exp: '在校', degree: '本科', platform: 'BOSS', scale: '100–499人', skills: ['React', 'CSS'], score: null, verdict: 'none', stage: 'none', starred: false, risk: '', exclude: '命中排除词：实习', note: '' },
  { id: 8, title: '软件开发工程师（校招）', salary: '16–24K', company: '北辰数字', city: '深圳', area: '南山', exp: '应届', degree: '本科', platform: '51job', scale: '500–999人', skills: ['JavaScript', 'Java', 'SQL'], score: 80, verdict: 'good', stage: 'sent', starred: false, risk: '', exclude: '', note: '工程实践要求匹配，Java 岗位职责比重需要沟通确认。' },
];
const initialFilters = { platform: 'all', verdict: 'all', stage: 'all', starred: false, enabled: false };
const query = new URLSearchParams(location.search);
const startVariant = variants[query.get('variant')] ? query.get('variant') : 'A';
const frameWidths = [320, 390, 480];
const cloneJobs = () => seedJobs.map(j => ({ ...j }));
const Button = ({ children, className = '', ...props }) => <button className={`btn ${className}`} {...props}>{children}</button>;
const IconButton = ({ label, children, ...props }) => <button className="icon-btn" aria-label={label} title={label} {...props}>{children}</button>;

function Overlay({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const nodes = () => [...ref.current.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    nodes()[0]?.focus();
    const keys = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const items = nodes(), first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const root = ref.current;
    root.addEventListener('keydown', keys);
    return () => { root.removeEventListener('keydown', keys); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <header className="sheet-head"><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X /></IconButton></header>
      {children}
    </section>
  </div>;
}

function JobRow({ job, checked, toggle, open, patch, analyze, busy, compact = false, active = false, returned = false }) {
  const matchLabel = job.score !== null ? `查看 ${job.company} 的匹配分析：${job.score} 分，${verdicts[job.verdict]}` : `分析 ${job.company} 的岗位匹配`;
  return <article className={`job-row ${compact ? 'compact' : ''} ${active ? 'active' : ''} ${returned ? 'just-viewed' : ''} ${job.exclude ? 'has-exclusion' : ''}`} data-job-id={job.id}>
    <div className="row-top">
      <input type="checkbox" aria-label={`选择 ${job.company} ${job.title}`} checked={checked} onChange={toggle} />
      <button className="job-title" onClick={() => open(job.id, 'info')}>{job.title}</button>
      <span className="salary">{job.salary}</span>
    </div>
    <div className="row-body">
      <div className="company-row"><span className="company">{job.company}</span><span className="source">{job.platform}</span>{returned && <span className="viewed-cue">刚看过</span>}
        <button className={`star ${job.starred ? 'on' : ''}`} title={job.starred ? '取消收藏' : '收藏后可集中回看，且不参与超额自动清理'} aria-label={`${job.starred ? '取消收藏' : '收藏'} ${job.company}`} aria-pressed={job.starred} onClick={() => patch(job.id, { starred: !job.starred })}><Star fill={job.starred ? 'currentColor' : 'none'} /></button>
      </div>
      {!compact && <>
        <div className="job-meta">{job.city}·{job.area}<span />{job.exp}<span />{job.degree}</div>
        <ul className="skills" aria-label="岗位技能">{job.skills.map(skill => <li key={skill}>{skill}</li>)}</ul>
        <div className="row-assessment"><button className={`match-summary ${job.verdict}`} aria-label={matchLabel} onClick={() => job.score !== null ? open(job.id, 'match') : analyze(job)} disabled={busy}>
          {busy ? <><LoaderCircle className="spin" /><span>分析中…</span></> : job.score !== null ? <span className="match-result"><strong>{job.score}<small>分</small></strong><span>{verdicts[job.verdict]}</span><ChevronRight /></span> : <><FileText /><span>分析匹配</span></>}
        </button><button className={`flow-link ${job.stage !== 'none' ? 'progressed' : ''}`} aria-label={`${job.company}，流程：${stages[job.stage]}`} onClick={() => open(job.id, 'greeting')}>{flowLabels[job.stage]}<ChevronRight /></button>
        {job.score !== null && <p className="match-reason" title={job.note}>{job.note}</p>}</div>
        {job.exclude && <div className="exclusion"><Filter /><div><strong>应用筛选规则后将隐藏</strong><span>{job.exclude}</span></div></div>}
        {job.risk && <div className="risk"><CircleAlert /><span>{job.risk}</span></div>}
      </>}
      {compact && <><div className="compact-foot"><button className={`match ${job.verdict}`} aria-label={matchLabel} onClick={() => job.score !== null ? open(job.id, 'match') : analyze(job)} disabled={busy}>{busy ? '分析中…' : job.score !== null ? <><strong>{job.score}</strong>{verdicts[job.verdict]}</> : '分析匹配'}</button><span className="stage">{stages[job.stage]}</span></div>{job.exclude ? <div className="compact-signal danger-text"><Filter />{job.exclude}</div> : job.risk && <div className="compact-signal"><CircleAlert />{job.risk}</div>}</>}
    </div>
  </article>;
}

export function VariantA({ jobs, rowProps }) {
  return <div className="continuous-list">{jobs.map(job => <JobRow key={job.id} job={job} {...rowProps(job)} />)}</div>;
}
export function VariantB({ jobs, rowProps }) {
  const [opened, setOpened] = useState(new Set(['none', 'prepared']));
  return <div className="grouped-list">{Object.entries(stages).map(([key, name]) => {
    const items = jobs.filter(j => j.stage === key), expanded = opened.has(key);
    if (!items.length) return null;
    return <section className="stage-group" key={key}>
      <button className="group-header" aria-expanded={expanded} onClick={() => setOpened(old => { const s = new Set(old); s.has(key) ? s.delete(key) : s.add(key); return s; })}>
        {expanded ? <ChevronDown /> : <ChevronRight />}<span>{name}</span><span className="group-count">{items.length}</span>
      </button>
      {expanded && items.map(job => <JobRow job={job} key={job.id} {...rowProps(job)} />)}
    </section>;
  })}</div>;
}
export function VariantC({ jobs, rowProps, selected, detail }) {
  return <div className="split-layout">
    <div className="candidate-list" aria-label="候选岗位">{jobs.map(job => <JobRow job={job} key={job.id} {...rowProps(job)} compact active={selected === job.id} />)}</div>
    <div className="inline-detail">{detail}</div>
  </div>;
}

function Detail({ job, tab, setTab, back, patch, analyze, busy, notify, greetings, setGreetings, openModal, inline = false }) {
  const titleRef = useRef(null);
  useEffect(() => { if (!inline) titleRef.current?.focus(); }, [job.id, inline]);
  const greeting = greetings[job.id] ?? `您好，我对贵司的${job.title}岗位很感兴趣。我有前端项目实践经验，希望进一步了解岗位职责与团队方向。`;
  return <section className={`job-detail ${inline ? 'is-inline' : ''}`}>
    <header className="detail-heading">
      {!inline && <button className="back" onClick={back}><ArrowLeft />岗位库</button>}
      <div className="detail-title-line"><h2 ref={titleRef} tabIndex={-1}>{job.title}</h2><span className="salary">{job.salary}</span></div>
      <p>{job.company}<span> · </span>{job.city} · {job.exp} · {job.degree}</p>
    </header>
    <div className="detail-tabs" role="tablist" aria-label="岗位详情内容" onKeyDown={e => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; next.click(); next.focus();
    }}>
      {[['info', '岗位'], ['match', '匹配'], ['company', '公司'], ['advice', '简历'], ['greeting', '流程']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className="detail-content" role="tabpanel" aria-label={{ info: '岗位信息', match: '匹配分析', company: '公司信息', advice: '简历建议', greeting: '岗位流程' }[tab]}>
      {tab === 'info' && <>
        <h3>岗位职责</h3><p>参与业务前端功能开发与迭代，和产品、设计及后端共同完成需求交付。维护组件与工程规范，改善页面性能及使用体验。</p>
        <h3>任职要求</h3><p>熟悉 {job.skills.join('、')}，能清晰描述项目中的技术选择与问题解决过程。有完整项目实践经验。</p>
        <div className="detail-signals">{job.exclude && <div className="exclusion"><Filter /><div><strong>应用筛选规则后将隐藏</strong><span>{job.exclude}</span></div></div>}{job.risk && <div className="risk"><CircleAlert /><span>{job.risk}</span></div>}</div>
        <div className="detail-actions"><Button onClick={() => openModal({ type: 'source', job })}><ExternalLink />打开原岗位</Button><Button onClick={() => openModal({ type: 'feedback', job })}><ThumbsDown />不喜欢</Button><Button className="danger-text" onClick={() => openModal({ type: 'delete', job })}>删除</Button></div>
      </>}
      {tab === 'match' && <>
        {job.score !== null ? <><div className={`analysis-score ${job.verdict}`}><strong>{job.score}<small> / 100</small></strong><span>{verdicts[job.verdict]}</span></div><h3>匹配依据</h3><p>{job.note}</p><h3>需要确认</h3><p>{job.risk || '薪资构成、工作时间及实际项目职责仍需与招聘方确认。'}</p></> : <div className="empty-inline"><FileText /><h3>还没有匹配分析</h3><p>分析会使用已配置的 AI 接口。</p></div>}
        <div className="detail-actions"><Button className={job.score !== null ? '' : 'primary'} disabled={busy} onClick={() => analyze(job)}>{busy ? <><LoaderCircle className="spin" />分析中…</> : job.score !== null ? '重新分析' : '分析匹配'}</Button><Button onClick={() => setTab('greeting')}>查看流程<ArrowRight /></Button></div>
      </>}
      {tab === 'company' && <><h3>{job.company}</h3><p>{job.scale} · 软件与信息技术服务</p><p>当前只有岗位中公开的公司信息。融资、经营与团队情况需进一步核实。</p><h3>沟通时可以确认</h3><ul><li>团队规模与开发协作方式</li><li>主要产品、客户和岗位职责边界</li><li>试用期、薪资结构与工作时间</li></ul></>}
      {tab === 'advice' && <><h3>突出岗位相关经验</h3><p>把与 {job.skills[0]} 相关的项目放在靠前位置，说明你负责的部分、遇到的问题，以及实际采用的解决办法。</p><h3>补充项目证据</h3><p>优先使用能验证的项目链接和真实结果；没有的数据留空。</p></>}
      {tab === 'greeting' && <ol className="workflow" aria-label="岗位推进流程">
        <li className={`workflow-step ${job.stage === 'sent' ? 'complete' : 'current'}`} aria-current={job.stage === 'sent' ? undefined : 'step'}>
          <span className="step-marker" aria-hidden="true">{job.stage === 'sent' ? <Check /> : '1'}</span>
          <div className="step-heading"><h3>打招呼</h3><span>{stages[job.stage]}</span></div>
          <div className="step-body">
            <ul className="greeting-milestones" aria-label="打招呼进度">{[['准备招呼语', job.stage !== 'none'], ['尝试打开沟通', ['opened', 'sent'].includes(job.stage)], ['手动确认发送', job.stage === 'sent']].map(([label, done], index) => { const current = !done && index === ['none', 'prepared', 'opened'].indexOf(job.stage); return <li key={label} className={done ? 'done' : current ? 'current' : ''} aria-current={current ? 'step' : undefined}>{done ? <Check /> : <span className="milestone-dot" />}{label}</li>; })}</ul>
            <label className="greeting-label" htmlFor="greeting">招呼语</label><textarea id="greeting" rows={5} value={greeting} onChange={e => setGreetings(old => ({ ...old, [job.id]: e.target.value }))} /><div className="char-count">{greeting.length} 字</div>
            <div className="flow-actions">
              {job.stage === 'none' ? <Button className="primary" disabled={!greeting.trim()} onClick={() => { patch(job.id, { stage: 'prepared' }); notify('招呼语已准备 · 仅保留在本次原型'); }}>保存招呼语</Button> : job.stage === 'prepared' ? <Button className="primary" onClick={() => openModal({ type: 'communication', job })}>打开沟通<ExternalLink /></Button> : job.stage === 'opened' ? <Button className="primary" onClick={() => openModal({ type: 'sent', job })}>确认已发送</Button> : <span className="sent-record"><Check />已手动确认发送</span>}
              <Button disabled={!greeting.trim()} onClick={() => notify('已模拟复制招呼语')}>复制</Button>
            </div>
            {job.stage === 'prepared' && <button className="text-action manual-record" onClick={() => openModal({ type: 'sent', job })}>已自行发送，补记进度</button>}
            {job.stage === 'opened' && <button className="text-action manual-record" onClick={() => openModal({ type: 'communication', job })}>再次打开沟通<ExternalLink /></button>}
            <p className="fine-print">打开沟通不会自动发送，发送后请手动确认。</p>
          </div>
        </li>
        <li className="workflow-step future"><span className="step-marker" aria-hidden="true" /><div className="step-heading"><h3>后续流程</h3><span>待扩展</span></div></li>
      </ol>}
    </div>
  </section>;
}

function App() {
  const [variant, setVariant] = useState(startVariant);
  const [jobs, setJobs] = useState(cloneJobs);
  const [filters, setFilters] = useState(initialFilters);
  const [rules, setRules] = useState(initialRules);
  const [ruleSettings, setRuleSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [checked, setChecked] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [lastViewedId, setLastViewedId] = useState(null);
  const [tab, setTab] = useState('info');
  const [modal, setModal] = useState(null);
  const [theme, setTheme] = useState(query.get('theme') === 'dark' ? 'dark' : 'light');
  const [width, setWidth] = useState(frameWidths.includes(Number(query.get('width'))) ? Number(query.get('width')) : 390);
  const [scenario, setScenario] = useState('normal');
  const [notice, setNotice] = useState('');
  const [greetings, setGreetings] = useState({});
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(new Set());
  const [simulateFailure, setSimulateFailure] = useState(true);
  const [feedback, setFeedback] = useState('');
  const listRef = useRef(null), listScroll = useRef(0), workbenchRef = useRef(null), stopQueue = useRef(false), timerRef = useRef(null), running = useRef(false);
  const notify = text => { setNotice(text); clearTimeout(timerRef.current); timerRef.current = setTimeout(() => setNotice(''), 4000); };
  useEffect(() => () => { stopQueue.current = true; clearTimeout(timerRef.current); }, []);
  const patch = (id, data) => setJobs(old => old.map(j => j.id === id ? { ...j, ...data } : j));
  const syncUrl = updates => { const url = new URL(location.href); Object.entries(updates).forEach(([key, value]) => url.searchParams.set(key, value)); history.replaceState(null, '', url); };
  useEffect(() => {
    const handler = () => { const p = new URLSearchParams(location.search); if (variants[p.get('variant')]) setVariant(p.get('variant')); };
    window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler);
  }, []);
  const changeFilter = (key, value) => setFilters(old => ({ ...old, [key]: value }));
  const filterCount = ['platform', 'verdict', 'stage'].filter(k => filters[k] !== 'all').length + Number(filters.starred);
  const viewChanged = filterCount > 0 || search !== '' || sort !== 'recent';
  const resetView = () => { setSearch(''); setFilters(old => ({ ...initialFilters, enabled: old.enabled })); setSort('recent'); };
  const evaluatedJobs = jobs.map(job => ({ ...job, exclude: exclusionReason(job, rules) }));
  const visible = (scenario === 'empty' ? [] : evaluatedJobs).filter(j =>
    (!search || `${j.title} ${j.company} ${j.city} ${j.skills.join(' ')}`.toLowerCase().includes(search.toLowerCase())) &&
    (filters.platform === 'all' || j.platform === filters.platform) && (filters.verdict === 'all' || j.verdict === filters.verdict) &&
    (filters.stage === 'all' || j.stage === filters.stage) && (!filters.starred || j.starred) && (!filters.enabled || !j.exclude)
  ).sort((a, b) => sort === 'score' ? (b.score ?? -1) - (a.score ?? -1) : sort === 'salary' ? (b.salary.includes('天') ? -1 : parseInt(b.salary)) - (a.salary.includes('天') ? -1 : parseInt(a.salary)) : a.id - b.id);
  const visibleIds = new Set(visible.map(j => j.id));
  const selectedJobs = visible.filter(j => checked.has(j.id));
  const allSelected = visible.length > 0 && selectedJobs.length === visible.length;
  const hiddenSelected = [...checked].filter(id => !visibleIds.has(id) && jobs.some(j => j.id === id)).length;
  const toggleAll = () => setChecked(old => { const set = new Set(old); visible.forEach(j => allSelected ? set.delete(j.id) : set.add(j.id)); return set; });
  const toggle = id => setChecked(old => { const set = new Set(old); set.has(id) ? set.delete(id) : set.add(id); return set; });
  const open = (id, newTab) => { if (detailId === null) { listScroll.current = listRef.current?.scrollTop || 0; setLastViewedId(null); } setDetailId(id); setTab(newTab); };
  const back = () => { setLastViewedId(detailId); setDetailId(null); requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listScroll.current; listRef.current?.querySelector(`article[data-job-id="${detailId}"] .job-title`)?.focus({ preventScroll: true }); }); };
  const analyze = async job => {
    if (busy.has(job.id) || running.current) { notify('请等待当前分析完成'); return; }
    setBusy(old => new Set(old).add(job.id));
    await new Promise(resolve => setTimeout(resolve, 900));
    patch(job.id, { score: job.score ?? 82, verdict: job.verdict === 'none' ? 'good' : job.verdict, note: job.note || '技术方向基本符合，需要在沟通中核实具体职责与经验要求。' });
    setBusy(old => { const s = new Set(old); s.delete(job.id); return s; });
    notify('模拟分析完成');
  };
  async function startQueue(items) {
    if (running.current || busy.size || !items.length) return;
    running.current = true; stopQueue.current = false;
    const ids = items.map(j => ({ id: j.id, title: j.title, company: j.company }));
    let results = ids.map(j => ({ ...j, state: 'pending', reason: '' }));
    const update = (index, state, reason = '') => { results = results.map((r, i) => i === index ? { ...r, state, reason } : r); setQueue({ items: results, active: state === 'running' ? index : null, running: true, stopped: false, stopping: stopQueue.current }); };
    setQueue({ items: results, active: null, running: true, stopped: false, stopping: false });
    for (let i = 0; i < ids.length; i++) {
      if (stopQueue.current) break;
      update(i, 'running');
      setBusy(old => new Set(old).add(ids[i].id));
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (simulateFailure && i === 0) update(i, 'failed', '接口限流（模拟 429），可稍后重试。');
      else { patch(ids[i].id, { score: 85, verdict: 'good', note: '技术方向和项目实践基本匹配，具体职责与团队情况仍需确认。' }); update(i, 'success'); }
      setBusy(old => { const s = new Set(old); s.delete(ids[i].id); return s; });
    }
    running.current = false;
    setQueue({ items: results, active: null, running: false, stopped: stopQueue.current, stopping: false });
  }
  const stop = () => { stopQueue.current = true; setQueue(q => ({ ...q, stopping: true })); };
  const rowProps = job => ({ checked: checked.has(job.id), toggle: () => toggle(job.id), open, patch, analyze, busy: busy.has(job.id), returned: lastViewedId === job.id });
  const shownDetail = variant === 'C' ? (visible.find(j => j.id === detailId) || visible[0]) : evaluatedJobs.find(j => j.id === detailId);
  const singleDetail = ruleSettings || (variant !== 'C' && !!shownDetail);
  const detailProps = shownDetail && { job: shownDetail, tab, setTab, back, patch, analyze, busy: busy.has(shownDetail.id), notify, greetings, setGreetings, openModal: setModal };
  const failed = queue?.items.filter(j => j.state === 'failed') || [];
  const done = queue?.items.filter(j => ['success', 'failed'].includes(j.state)).length || 0;
  const selecting = selectedJobs.length > 0;
  const exportMock = () => notify(`已模拟导出 ${selecting ? selectedJobs.length : visible.length} 个当前可见岗位`);

  return <div className="prototype-page" data-theme={theme}>
    <header className="preview-header"><div><strong>岗位列表 / 结构原型</strong><span>模拟数据 · 仅本次会话</span></div>
      <div className="preview-controls"><label>宽度<select aria-label="预览宽度" value={width} onChange={e => { setWidth(Number(e.target.value)); syncUrl({ width: e.target.value }); }}>{frameWidths.map(w => <option key={w} value={w}>{w}px</option>)}</select></label>
        <label>主题<select aria-label="原型主题" value={theme} onChange={e => { setTheme(e.target.value); syncUrl({ theme: e.target.value }); }}><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label>场景<select aria-label="原型场景" value={scenario} onChange={e => { setScenario(e.target.value); setDetailId(null); }}><option value="normal">常规岗位</option><option value="empty">空岗位库</option><option value="loading">加载中</option><option value="error">加载失败</option></select></label>
      </div>
    </header>
    <main className="preview-stage" style={{ '--preview-width': `${width}px` }}>
      <aside className="review-notes"><h1>让岗位回到<br />页面中心。</h1><p>已选定 A · 紧凑清单。<br />本轮评审密度与流程。</p>
        <nav aria-label="已选方案">{Object.entries(variants).filter(([key]) => key === 'A').map(([key, value]) => <button key={key} aria-current={variant === key ? 'page' : undefined} onClick={() => { setVariant(key); setDetailId(null); setModal(null); syncUrl({ variant: key }); }}><span>{key}</span><div><strong>{value.name}</strong><small>{value.purpose}</small></div><ChevronRight /></button>)}</nav>
        <div className="variant-note"><h2>{variants[variant].purpose}</h2><p>{variants[variant].description}</p><p className="tradeoff">{variants[variant].tradeoff}</p></div>
      </aside>
      <section className={`workbench variant-${variant}`} aria-label={`方案 ${variant} ${variants[variant].name}`} ref={workbenchRef}>
        {!singleDetail && <header className="app-header"><div className="app-heading"><h1>岗位库<span aria-label={`显示 ${visible.length} 个，共 ${jobs.length} 个`}>{visible.length === jobs.length ? jobs.length : `${visible.length} / ${jobs.length}`}</span></h1><div className="heading-actions"><button className={`favorites-view ${filters.starred ? 'on' : ''}`} aria-pressed={filters.starred} title="集中回看收藏；收藏的岗位不参与超额自动清理" onClick={() => changeFilter('starred', !filters.starred)}><Star fill={filters.starred ? 'currentColor' : 'none'} />收藏 {jobs.filter(j => j.starred).length}</button><button className="current-job" onClick={() => { const current = jobs.find(j => j.id === 3); current ? open(current.id, 'info') : notify('当前模拟岗位已被删除'); }}>当前岗位<ExternalLink /></button></div></div>
          <div className="search-line"><label className="search-box"><Search /><input aria-label="搜索岗位、公司或技能" placeholder="搜索岗位、公司或技能" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="清除搜索" onClick={() => setSearch('')}><X /></button>}</label><button className={`filter-trigger ${filterCount ? 'has-filters' : ''}`} aria-label={`筛选${filterCount ? `，${filterCount} 个条件` : ''}`} onClick={() => setModal({ type: 'filters' })}><ListFilter />{filterCount ? `筛选 ${filterCount}` : '筛选'}</button></div>
          <div className="view-toolbar"><div className="filter-switch-group"><label className="local-filter"><input type="checkbox" role="switch" aria-describedby="local-filter-hint" checked={filters.enabled} onChange={e => changeFilter('enabled', e.target.checked)} /><span className="switch-track" /><span>{ruleCopy.label}</span></label><IconButton label="筛选规则说明" onClick={() => setModal({ type: 'filters' })}><Info /></IconButton><span id="local-filter-hint" className="sr-only">{ruleCopy.hint}</span></div><label className="sort-label"><select aria-label="岗位排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近收录</option><option value="score">匹配优先</option><option value="salary">月薪优先</option></select></label></div>
          {viewChanged && <div className="applied-filters"><span>{search ? `“${search}”` : ''}{filters.platform !== 'all' ? ` ${filters.platform}` : ''}{filters.verdict !== 'all' ? ` ${verdicts[filters.verdict]}` : ''}{filters.stage !== 'all' ? ` ${stages[filters.stage]}` : ''}{filters.starred ? ' 已收藏' : ''}</span><button onClick={resetView}>重置视图<X /></button></div>}
        </header>}
        {ruleSettings ? <section className="rule-settings"><header className="detail-heading"><button className="back" onClick={() => { setRuleSettings(false); setModal({ type: 'filters' }); }}><ArrowLeft />返回筛选岗位</button><h2>岗位筛选</h2></header><div className="detail-content"><div className="rule-explanation"><label className="local-filter"><input type="checkbox" role="switch" aria-describedby="rules-settings-hint" checked={filters.enabled} onChange={e => changeFilter('enabled', e.target.checked)} /><span className="switch-track" /><span>{ruleCopy.label}</span></label><p id="rules-settings-hint">{ruleCopy.hint}</p></div><div className="rule-fields">{[['include', '包含任一'], ['exclude', '排除关键词'], ['companies', '屏蔽公司'], ['cities', '只看这些城市'], ['salary', '月薪下限（K）']].map(([key, label]) => <label key={key}>{label}<input type={key === 'salary' ? 'number' : 'text'} min={key === 'salary' ? 0 : undefined} value={rules[key]} placeholder={key === 'salary' ? '不限' : '多个词用顿号分隔'} onChange={e => setRules(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div><p className="fine-print">风险词只提醒；AI 评分不参与规则筛选。</p></div></section> : scenario === 'loading' ? <div className="surface-state" role="status"><LoaderCircle className="spin" /><h2>正在读取岗位</h2><div className="skeletons"><i /><i /><i /></div><Button onClick={() => setScenario('normal')}>完成模拟加载</Button></div> : scenario === 'error' ? <div className="surface-state" role="alert"><CircleAlert /><h2>岗位读取失败</h2><p>本地数据暂时无法读取，请重试。</p><Button onClick={() => setScenario('normal')}>重新加载</Button></div> : !visible.length ? <div className="surface-state"><Search /><h2>{scenario === 'empty' || !jobs.length ? '还没有收录岗位' : '没有符合条件的岗位'}</h2><p>{scenario === 'empty' || !jobs.length ? '浏览招聘网站后，岗位会出现在这里。' : filters.enabled ? '可重置搜索与视图条件，或关闭“应用筛选规则”。' : '试试其他关键词或重置视图条件。'}</p>{(viewChanged || filters.enabled) && <Button onClick={resetView}>重置视图条件</Button>}{scenario === 'empty' && <Button onClick={() => setScenario('normal')}>加载模拟岗位</Button>}</div> : variant !== 'C' && shownDetail ? <div className="detail-wrap"><Detail {...detailProps} /></div> : <>
          {variant !== 'C' && <div className="list-scroll" ref={listRef}>{variant === 'A' ? <VariantA jobs={visible} rowProps={rowProps} /> : <VariantB jobs={visible} rowProps={rowProps} />}</div>}
          {variant === 'C' && <VariantC jobs={visible} rowProps={rowProps} selected={shownDetail?.id} detail={<Detail {...detailProps} inline />} />}
        </>}
        {queue && <div className={`queue-strip ${failed.length ? 'has-error' : ''}`} role="status"><button onClick={() => setModal({ type: 'queue' })}>{queue.running ? <LoaderCircle className="spin" /> : failed.length ? <CircleAlert /> : <Check />}<span>{queue.running ? queue.stopping ? '停止后续队列中' : '批量分析' : queue.stopped ? '队列已停止' : '批量分析完成'}<small>{done}/{queue.items.length}{failed.length ? ` · ${failed.length} 失败` : ''}</small></span><ChevronRight /></button>{queue.running ? <button className="text-action" disabled={queue.stopping} onClick={stop}>停止后续</button> : <IconButton label="收起队列状态" onClick={() => setQueue(null)}><X /></IconButton>}</div>}
        {!singleDetail && <footer className={`selection-bar ${selecting ? 'is-selecting' : ''}`}>
          <label className="select-all"><input type="checkbox" aria-label="全选当前可见岗位" checked={allSelected} disabled={!visible.length || scenario === 'loading' || scenario === 'error'} ref={el => { if (el) el.indeterminate = selecting && !allSelected; }} onChange={toggleAll} /><span>{selecting ? `已选 ${selectedJobs.length}` : '全选'}</span></label>
          {selecting ? <><button className="text-action clear-select" onClick={() => setChecked(new Set())}>取消</button><Button className="primary" disabled={running.current || busy.size > 0} onClick={() => startQueue(selectedJobs)}>分析 {selectedJobs.length} 项</Button><IconButton label="所选岗位更多操作" onClick={() => setModal({ type: 'batch' })}><MoreHorizontal /></IconButton></> : <><span className="selection-scope">当前可见</span><Button disabled={!visible.length || scenario === 'loading' || scenario === 'error'} onClick={exportMock}>导出 {visible.length} 项</Button></>}
        </footer>}
        {!singleDetail && hiddenSelected > 0 && <div className="hidden-selection">另有 {hiddenSelected} 项被筛选隐藏，不参与当前操作<button onClick={() => setChecked(new Set(selectedJobs.map(j => j.id)))}>清除</button></div>}
        {notice && !modal && <div className="toast" role="status">{notice}</div>}
        {modal?.type === 'filters' && <Overlay title="筛选岗位" onClose={() => setModal(null)}><div className="sheet-content filters-form">
          <div className="rule-explanation"><div className="rule-control"><label className="local-filter"><input type="checkbox" role="switch" aria-describedby="rules-dialog-hint" checked={filters.enabled} onChange={e => changeFilter('enabled', e.target.checked)} /><span className="switch-track" /><span>{ruleCopy.label}</span></label><button className="text-action" onClick={() => { setModal(null); setRuleSettings(true); }}>调整规则<ArrowRight /></button></div><p id="rules-dialog-hint">{ruleCopy.hint}</p></div>
          <fieldset><legend>平台</legend><div className="segmented">{[['all', '全部'], ['BOSS', 'BOSS直聘'], ['51job', '前程无忧']].map(([key, label]) => <button key={key} aria-pressed={filters.platform === key} onClick={() => changeFilter('platform', key)}>{label}</button>)}</div></fieldset>
          <fieldset><legend>匹配结果</legend><div className="filter-options">{[['all', '全部'], ...Object.entries(verdicts)].map(([key, label]) => <label key={key}><input type="radio" name="verdict" checked={filters.verdict === key} onChange={() => changeFilter('verdict', key)} />{label}</label>)}</div></fieldset>
          <fieldset><legend>流程进度</legend><select aria-label="流程进度" value={filters.stage} onChange={e => changeFilter('stage', e.target.value)}><option value="all">全部进度</option>{Object.entries(stages).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></fieldset>
          <label className="checkbox-label"><input type="checkbox" checked={filters.starred} onChange={e => changeFilter('starred', e.target.checked)} />只看收藏</label><p className="fine-print favorite-hint">收藏便于集中回看；超出岗位库上限时，收藏的岗位不会被自动清理。</p>
          <div className="sheet-actions"><Button onClick={resetView}>重置视图</Button><Button className="primary" onClick={() => setModal(null)}>查看 {visible.length} 个岗位</Button></div>
        </div></Overlay>}
        {modal?.type === 'queue' && <Overlay title="批量分析队列" onClose={() => setModal(null)}><div className="sheet-content queue-content"><p className="queue-context">任务开始时选中的 {queue.items.length} 项，之后改变筛选不会改变此队列。</p><div className="queue-totals"><span>{queue.items.filter(j => j.state === 'success').length} 成功</span><span>{failed.length} 失败</span><span>{queue.items.filter(j => j.state === 'pending').length} 未执行</span></div>
          <ul className="queue-items">{queue.items.map(item => <li key={item.id}><div><strong>{item.title}</strong><small>{item.company}</small>{item.reason && <p>{item.reason}</p>}</div><span className={item.state === 'failed' ? 'error-label' : ''}>{{ pending: '未执行', running: '分析中', success: '成功', failed: '失败' }[item.state]}</span></li>)}</ul>
          {queue.stopping && <p>当前请求仍可能完成，后续岗位不再开始。</p>}
          <div className="sheet-actions">{queue.running ? <Button disabled={queue.stopping} onClick={stop}>停止后续队列</Button> : <>{failed.length > 0 && <Button className="primary" onClick={() => { setModal(null); startQueue(failed.map(item => jobs.find(j => j.id === item.id)).filter(Boolean)); }}>重试失败 {failed.length} 项</Button>}{queue.items.some(j => j.state === 'pending') && <Button onClick={() => { setModal(null); startQueue(queue.items.filter(j => j.state === 'pending').map(item => jobs.find(j => j.id === item.id)).filter(Boolean)); }}>继续未执行项</Button>}</>}</div>
          <label className="checkbox-label debug-option"><input type="checkbox" checked={simulateFailure} onChange={e => setSimulateFailure(e.target.checked)} disabled={queue.running} />模拟首项限流（关闭后可成功重试）</label>
        </div></Overlay>}
        {modal?.type === 'batch' && <Overlay title={`所选 ${selectedJobs.length} 个岗位`} onClose={() => setModal(null)}><div className="sheet-content action-menu"><Button onClick={() => { selectedJobs.forEach(j => { if (j.stage === 'none') patch(j.id, { stage: 'prepared' }); }); setModal(null); notify('已为所选未处理岗位模拟准备招呼语'); }}>准备未处理岗位</Button><Button onClick={() => { const next = selectedJobs.find(j => j.stage !== 'sent'); setModal(null); if (next) open(next.id, 'greeting'); else notify('所选岗位均已手动确认发送'); }}>处理下一个</Button><Button onClick={() => { exportMock(); setModal(null); }}>导出所选 {selectedJobs.length} 项</Button></div></Overlay>}
        {modal && ['sent', 'communication', 'source', 'delete', 'feedback'].includes(modal.type) && <Overlay title={{ sent: '确认发送记录', communication: '模拟打开沟通', source: '原岗位链接', delete: '删除岗位', feedback: '不喜欢这个岗位' }[modal.type]} onClose={() => { setModal(null); setFeedback(''); }}><div className="sheet-content">
          {modal.type === 'sent' && <><p>你已在招聘网站上手动发送了给 {modal.job.company} 的消息吗？</p><p className="fine-print">此操作只更新记录，不会发送消息。</p><div className="sheet-actions"><Button onClick={() => setModal(null)}>还没有</Button><Button className="primary" onClick={() => { patch(modal.job.id, { stage: 'sent' }); setModal(null); notify('已记录：已发送（手动确认）'); }}>已手动发送</Button></div></>}
          {modal.type === 'communication' && <><p>正式版本会尝试打开招聘网站的沟通入口。打开入口不能证明消息已发送。</p><p className="fine-print">原型仅模拟一次打开尝试。</p><div className="sheet-actions"><Button className="primary" onClick={() => { if (modal.job.stage !== 'sent') patch(modal.job.id, { stage: 'opened' }); setModal(null); notify('已记录：已尝试打开沟通'); }}>模拟打开</Button></div></>}
          {modal.type === 'source' && <><p>{modal.job.platform} · {modal.job.title}</p><p className="fine-print">模拟岗位没有真实招聘链接。</p><div className="sheet-actions"><Button onClick={() => setModal(null)}>知道了</Button></div></>}
          {modal.type === 'delete' && <><p>删除「{modal.job.title}」？原型刷新后会恢复模拟数据。</p><div className="sheet-actions"><Button onClick={() => setModal(null)}>保留</Button><Button className="danger" onClick={() => { setJobs(old => old.filter(j => j.id !== modal.job.id)); setChecked(old => { const s = new Set(old); s.delete(modal.job.id); return s; }); setModal(null); back(); }}>删除</Button></div></>}
          {modal.type === 'feedback' && <><label className="feedback-label" htmlFor="feedback">不喜欢的原因</label><textarea id="feedback" rows={3} value={feedback} placeholder="例如：不考虑驻场岗位" onChange={e => setFeedback(e.target.value)} /><p className="fine-print">正式版本将按既有偏好反馈流程写入画像；原型只演示反馈入口。</p><div className="sheet-actions"><Button className="primary" disabled={!feedback.trim()} onClick={() => { setModal(null); setFeedback(''); notify('已模拟记录反馈，未改动真实画像'); }}>记录反馈</Button></div></>}
        </div></Overlay>}
      </section>
      <aside className="review-state"><h2>本次预览</h2><dl><div><dt>结构</dt><dd>{variant} · {variants[variant].name}</dd></div><div><dt>侧栏</dt><dd>{width} × 820</dd></div><div><dt>可见 / 总数</dt><dd>{visible.length} / {jobs.length}</dd></div><div><dt>当前可见选中</dt><dd>{selectedJobs.length}</dd></div><div><dt>隐藏选中</dt><dd>{hiddenSelected}</dd></div><div><dt>应用筛选规则</dt><dd>{filters.enabled ? '开启' : '关闭'}</dd></div><div><dt>当前详情</dt><dd>{shownDetail?.company || '—'}</dd></div></dl><details><summary>交互走查</summary><ol><li>查看已有分数，再独立重新分析。</li><li>全选后切换平台，检查操作数量。</li><li>开始批量分析，停止后续队列。</li><li>在队列中关闭模拟限流并重试。</li><li>进入流程，完成打招呼并手动确认发送。</li></ol></details><button className="text-action reset-demo" disabled={running.current || busy.size > 0} onClick={() => { setJobs(cloneJobs()); setChecked(new Set()); setFilters(initialFilters); setRules(initialRules); setRuleSettings(false); setSearch(''); setSort('recent'); setScenario('normal'); setDetailId(null); setLastViewedId(null); setTab('info'); setQueue(null); setGreetings({}); setSimulateFailure(true); setNotice(''); }}>重置全部模拟数据</button></aside>
    </main>
  </div>;
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
