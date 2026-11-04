import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Image, RefreshCw, Send } from 'lucide-react';
import {
  COMM_CHIPS, canExpandNodes, chipLabel, confirmPending, confirmedNodes, defaultBaseline, headlineBadge,
  ignorePending, isGreetGateOpen, nextChip, railSteps, sanitizeComm, stageFrom, suggestionFromChip,
  suggestionFromDemand, syncLabel,
} from './commTab.js';

function SuggestionText({ text, emphasis }) {
  if (!emphasis || !text.includes(emphasis)) return text;
  const index = text.indexOf(emphasis);
  return (
    <>
      {text.slice(0, index)}
      <em>{emphasis}</em>
      {text.slice(index + emphasis.length)}
    </>
  );
}

function Drawer({
  nodes, pending, expanded, onToggle, onConfirm, onIgnore,
}) {
  const expandable = canExpandNodes(nodes);
  const stage = stageFrom(nodes, pending);
  const badge = headlineBadge(nodes, pending);
  const steps = railSteps(nodes, expanded);
  const badgeText = badge === 'pending' ? '待确认' : badge === 'done' ? '已过' : '当前';
  const row = (
    <>
      <span className="comm-dot" aria-hidden="true" />
      <span className="comm-drawer-k">当前岗位进展</span>
      <span className="comm-drawer-v">
        {stage.label}
        {stage.sub && <span className="sub">{stage.sub}</span>}
        <span className={`comm-badge ${badge}`}>{badgeText}</span>
      </span>
      {expandable ? (
        <span className="comm-chev" aria-hidden="true">
          {expanded && <span className="comm-chev-hint">收起</span>}
          {expanded ? '▾' : '▸'}
        </span>
      ) : (
        <span className="comm-no-expand">单节点 · 不可展</span>
      )}
    </>
  );
  return (
    <div className="comm-drawer">
      {expandable ? (
        <button type="button" className="comm-drawer-row" aria-expanded={expanded} onClick={onToggle}>
          {row}
        </button>
      ) : (
        <div className="comm-drawer-row">{row}</div>
      )}
      {pending && (
        <div className="comm-toast" role="status">
          <span className="comm-toast-bar" aria-hidden="true" />
          <span className="comm-toast-ai">模型</span>
          <span className="comm-toast-q">{pending.label}？</span>
          <span className="comm-toast-hint">{pending.hint || '摘自对话'}</span>
          <span className="comm-toast-acts">
            <button type="button" onClick={onIgnore}>忽略</button>
            <button type="button" className="ok" onClick={onConfirm}>确认</button>
          </span>
        </div>
      )}
      {steps.length > 0 && (
        <ol className="comm-steps" aria-label="岗位进展">
          {steps.map((step) => (
            <li key={step.id} className={step.ghost ? 'ghost' : step.state}>
              <span className={`comm-step-dot${step.ghost ? ' ghost' : step.state === 'done' ? ' done' : ' cur'}`} aria-hidden="true" />
              <span className="comm-step-label">
                {step.label}
                {step.mark && <span className={step.ghost ? 'growth' : step.state === 'current' ? 'now' : 'past'}>{step.mark}</span>}
              </span>
              {(step.sub || step.detail) && <span className="comm-step-meta">{[step.sub, step.detail].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GreetWork({
  greeting, scoring, onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onNotice,
}) {
  const ready = Boolean(greeting.trim());
  return (
    <section className="comm-work">
      <div className="comm-work-k"><span>招呼语</span><em>单一稿 · 无分档</em></div>
      {ready ? (
        <textarea className="comm-draft" rows={4} aria-label="招呼语" value={greeting} onChange={(event) => onGreeting(event.target.value)} />
      ) : (
        <div className="comm-greet-empty">
          <p>还没有可编辑的招呼语。可以先做一次分析。</p>
          <button type="button" className="primary" disabled={scoring} onClick={onAnalyze}>{scoring ? '分析中…' : '生成招呼语'}</button>
        </div>
      )}
      <div className="comm-tools">
        <button type="button" className="primary" onClick={() => onNotice('还没有可附带的简历图')}>
          <Image aria-hidden="true" />发简历图
        </button>
        <button type="button" disabled={!ready} onClick={() => onCopy(greeting)}>
          <Copy aria-hidden="true" />复制
        </button>
        <button type="button" disabled={!ready} onClick={onSendGreeting}>
          <ExternalLink aria-hidden="true" />打开沟通并复制
        </button>
        <button type="button" disabled={scoring} onClick={onRegenerate}>
          <RefreshCw aria-hidden="true" />{scoring ? '生成中…' : '重新生成'}
        </button>
      </div>
      <p className="comm-wait"><span className="comm-wait-dot" aria-hidden="true" />等 HR 回复 · 完成招呼后解锁建议区</p>
      <button type="button" className="comm-sent" onClick={onMarkSent}>我已发出招呼</button>
    </section>
  );
}

export function CommTab({
  job, progressStatus, record, greeting, scoring,
  onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onOpenChat, onComm, onNotice,
}) {
  const [expanded, setExpanded] = useState(false);
  const [chipId, setChipId] = useState(null);
  const [rewritten, setRewritten] = useState(false);
  const [demand, setDemand] = useState('');
  const [demandSuggestion, setDemandSuggestion] = useState(null);
  const uid = job?.uid;

  useEffect(() => {
    setExpanded(false);
    setChipId(null);
    setRewritten(false);
    setDemand('');
    setDemandSuggestion(null);
  }, [uid]);

  const clean = sanitizeComm(record);
  const open = isGreetGateOpen({ progressStatus, record: clean });
  const nodes = confirmedNodes({ progressStatus, record: clean });
  const pending = open ? clean.pending : null;
  const stage = stageFrom(nodes, pending);
  const baseline = clean.baseline || defaultBaseline(stage);
  const chipSuggestion = suggestionFromChip(baseline, chipId, stage);
  const model = demandSuggestion || chipSuggestion;
  const fromLabel = model.source === 'demand'
    ? '自填'
    : model.source === 'chip'
      ? (rewritten ? '刚按芯片改写' : `单选 · ${chipLabel(model.chipId)}`)
      : '';
  const synced = syncLabel(clean.sync);

  const pickChip = (id) => {
    setDemandSuggestion(null);
    setChipId((current) => {
      const next = nextChip(current, id);
      setRewritten(Boolean(current) && next != null);
      return next;
    });
  };

  const sendDemand = () => {
    const next = suggestionFromDemand(demand, stage);
    if (!next) return;
    setDemandSuggestion(next);
    setDemand('');
  };

  return (
    <div className="comm-body" role="tabpanel" aria-label="沟通">
      <div className="comm-scroll">
        <Drawer
          nodes={nodes}
          pending={pending}
          expanded={expanded && canExpandNodes(nodes)}
          onToggle={() => setExpanded((value) => !value)}
          onConfirm={() => onComm(confirmPending(clean, progressStatus))}
          onIgnore={() => onComm(ignorePending(clean))}
        />
        {open ? (
          <section className="suggest-zone" aria-label="建议回复">
            <div className="comm-k">
              <span>建议回复</span>
              {synced && <span className="comm-sync">{synced}</span>}
            </div>
            <div className={`suggest${model.source === 'chip' ? ' hi' : ''}`}>
              <button type="button" className="sg-copy" aria-label="复制建议" onClick={() => onCopy(model.text)}>
                <Copy aria-hidden="true" />
              </button>
              <div className="sg-top">
                <span className="sg-lab">模型建议<span>答/问均可</span></span>
                {fromLabel && <span className={`sg-from${model.source === 'chip' ? ' amber' : ''}`}>{fromLabel}</span>}
              </div>
              <div className="sg-body"><SuggestionText text={model.text} emphasis={model.emphasis} /></div>
            </div>
          </section>
        ) : (
          <GreetWork
            greeting={greeting}
            scoring={scoring}
            onGreeting={onGreeting}
            onCopy={onCopy}
            onAnalyze={onAnalyze}
            onRegenerate={onRegenerate}
            onSendGreeting={onSendGreeting}
            onMarkSent={onMarkSent}
            onNotice={onNotice}
          />
        )}
      </div>
      {open && (
        <div className="sticky-comm">
          <div className="comm-chips" role="group" aria-label="建议芯片">
            {COMM_CHIPS.map((chip) => (
              <button type="button" key={chip.id} className={chipId === chip.id ? 'on' : ''} aria-pressed={chipId === chip.id} onClick={() => pickChip(chip.id)}>
                {chip.label}
              </button>
            ))}
          </div>
          <form className="comm-pill" onSubmit={(event) => { event.preventDefault(); sendDemand(); }}>
            <input
              value={demand}
              onChange={(event) => setDemand(event.target.value)}
              placeholder="输入沟通需求，或点芯片改上方建议"
              aria-label="沟通需求"
            />
            <button type="submit" className="comm-send" aria-label="发送自填需求">
              <Send aria-hidden="true" />
            </button>
          </form>
          <div className="comm-foot">
            <p>芯片单选 · 点选即改写 · 胶囊发送仅自填</p>
            <button type="button" className="comm-open" onClick={() => onOpenChat(model.text)}>
              <ExternalLink aria-hidden="true" />打开沟通
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
