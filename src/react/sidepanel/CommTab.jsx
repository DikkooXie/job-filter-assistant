import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Image, RefreshCw, Send } from 'lucide-react';
import {
  COMM_CHIPS, canExpandNodes, confirmPending, confirmedNodes, defaultBaseline, groupChatDays,
  headlineBadge, ignorePending, isGreetGateOpen, nextChip, railSteps, sanitizeComm, stageFrom,
} from './commTab.js';

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
      {expandable && (
        <span className="comm-chev" aria-hidden="true">
          {expanded && <span className="comm-chev-hint">收起</span>}
          {expanded ? '▾' : '▸'}
        </span>
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

function ChatThread({ messages }) {
  const groups = groupChatDays(messages);
  return (
    <div className="comm-chat" aria-label="对话">
      {groups.map((group) => (
        <div key={group.key} className="comm-day-group">
          {group.label && <div className="comm-day">{group.label}</div>}
          {group.messages.map((message) => (
            <div key={message.id} className={`comm-row ${message.role === 'me' ? 'me' : 'them'}`}>
              <div className="comm-bubble">
                <span className="comm-who">{message.role === 'me' ? '我' : 'HR'}</span>
                {message.text}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function GreetWork({
  greeting, scoring, onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onNotice,
}) {
  const ready = Boolean(greeting.trim());
  return (
    <section className="comm-work">
      <div className="comm-work-k"><span>招呼语</span></div>
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
  onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onOpenChat, onComm, onNotice, onSuggest,
}) {
  const [expanded, setExpanded] = useState(false);
  const [chipId, setChipId] = useState(null);
  const [demand, setDemand] = useState('');
  const [anchor, setAnchor] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inflight = useRef(false);
  const uid = job?.uid;

  useEffect(() => {
    generation.current += 1;
    inflight.current = false;
    setExpanded(false);
    setChipId(null);
    setDemand('');
    setAnchor('');
    setDraft('');
    setBusy(false);
  }, [uid]);

  const clean = sanitizeComm(record);
  const open = isGreetGateOpen({ progressStatus, record: clean });
  const nodes = confirmedNodes({ progressStatus, record: clean });
  const pending = open ? clean.pending : null;
  const stage = stageFrom(nodes, pending);
  const baseline = clean.baseline || defaultBaseline(stage);
  const suggestion = draft || anchor || baseline;

  const rewrite = async (instruction, { chip = null, current } = {}) => {
    const ask = String(instruction || '').trim();
    if (!ask || inflight.current) return;
    const ticket = generation.current;
    inflight.current = true;
    setBusy(true);
    try {
      const result = await onSuggest?.({
        instruction: ask,
        current,
        stage,
        messages: clean.messages,
      });
      if (ticket !== generation.current) return;
      const text = String(result?.text || '').trim();
      if (!text) return;
      if (chip) {
        setChipId(chip);
        setDraft(text);
      } else {
        setChipId(null);
        setAnchor(text);
        setDraft(text);
        setDemand('');
      }
    } catch (error) {
      if (ticket !== generation.current) return;
      onNotice?.(error?.message || '改写失败', true);
    } finally {
      if (ticket === generation.current) {
        inflight.current = false;
        setBusy(false);
      }
    }
  };

  const pickChip = (id) => {
    const next = nextChip(chipId, id);
    if (!next) {
      setChipId(null);
      setDraft(anchor);
      return;
    }
    const chip = COMM_CHIPS.find((item) => item.id === next);
    if (!chip || busy) return;
    rewrite(chip.label, { chip: next, current: anchor || baseline });
  };

  return (
    <div className="comm-body" role="tabpanel" aria-label="沟通">
      <Drawer
        nodes={nodes}
        pending={pending}
        expanded={expanded && canExpandNodes(nodes)}
        onToggle={() => setExpanded((value) => !value)}
        onConfirm={() => onComm(confirmPending(clean, progressStatus))}
        onIgnore={() => onComm(ignorePending(clean))}
      />
      <div className="comm-scroll">
        {open ? <ChatThread messages={clean.messages} /> : (
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
          <div className={`suggest${busy ? ' is-busy' : ''}`} aria-busy={busy}>
            <button type="button" className="sg-copy" aria-label="复制建议" disabled={!suggestion} onClick={() => onCopy(suggestion)}>
              <Copy aria-hidden="true" />
            </button>
            <div className="sg-body">{busy ? '正在改写…' : suggestion}</div>
          </div>
          <div className="comm-chips" role="group" aria-label="建议标签">
            {COMM_CHIPS.map((chip) => (
              <button type="button" key={chip.id} className={chipId === chip.id ? 'on' : ''} aria-pressed={chipId === chip.id} disabled={busy} onClick={() => pickChip(chip.id)}>
                {chip.label}
              </button>
            ))}
          </div>
          <form className="comm-pill" onSubmit={(event) => { event.preventDefault(); rewrite(demand, { current: suggestion }); }}>
            <input
              value={demand}
              onChange={(event) => setDemand(event.target.value)}
              placeholder="说说怎么改这条建议"
              aria-label="怎么改这条建议"
              disabled={busy}
            />
            <button type="submit" className="comm-send" aria-label="按说明改写建议" disabled={busy || !demand.trim()}>
              <Send aria-hidden="true" />
            </button>
          </form>
          <div className="comm-foot">
            <button type="button" className="comm-open" onClick={() => onOpenChat(suggestion)}>
              <ExternalLink aria-hidden="true" />打开沟通
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
