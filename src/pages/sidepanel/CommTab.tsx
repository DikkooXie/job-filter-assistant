import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Image, RefreshCw, Send } from 'lucide-react';
import type { Job } from '../../common/types.js';
import {
  COMM_CHIPS, canExpandNodes, confirmPending, confirmedNodes, defaultBaseline, groupChatDays,
  headlineBadge, ignorePending, isGreetGateOpen, nextChip, railSteps, sanitizeComm, stageFrom,
} from './commTab.js';
import type { CommMessage, CommNode, CommPending, CommStage, CommState } from './commTab.js';
import { cn } from '../../lib/cn.js';

// 沟通页正文：`.job-panel` 的未分层重置（button 的字体/边框/背景/内边距、svg 尺寸）会压过普通工具类，所以按钮类带 `!`。
const commBody = 'flex min-h-0 min-w-0 flex-1 flex-col bg-jp-surface text-jp-ink';
const commScroll = 'flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain';
const commChat = 'flex flex-1 flex-col gap-2.5 px-3.5 pt-3.5 pb-3';
const commDayGroup = 'flex flex-col gap-2.5';
const commDay = 'self-center rounded-full bg-[var(--jp-lift)] px-2 py-0.5 text-[10px] text-jp-muted';
const commRow = 'flex w-full';
const commBubble = 'max-w-[78%] rounded-xl px-[11px] py-2 text-[13px] leading-[1.5] text-jp-ink [overflow-wrap:anywhere]';
const commBubbleThem = 'rounded-tl-[4px] border border-jp-line bg-jp-surface-2';
const commBubbleMe = 'rounded-tr-[4px] border border-jp-accent-line bg-jp-accent-soft';
const commWho = 'mb-[3px] block text-[10px] font-[650]';
const commDrawerClass = 'border-b border-jp-line bg-jp-surface-2';
const commDrawerRow = 'flex min-h-9 w-full items-center gap-2 !px-3.5 text-left';
const commDot = 'size-1.5 shrink-0 rounded-full bg-jp-accent shadow-[0_0_0_3px_var(--jp-accent-soft)]';
const commDrawerKey = 'shrink-0 text-[11px] text-jp-muted';
const commDrawerValue = 'flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-[650] text-jp-ink';
const commChev = 'inline-flex shrink-0 items-center gap-1 text-[11px] text-jp-muted';
const commBadge = 'rounded-full px-1.5 py-px text-[9px] font-[650]';
const commBadgeTone = {
  current: 'border border-jp-accent-line text-jp-accent',
  pending: 'border border-[color:color-mix(in_srgb,var(--jp-grade-mid)_40%,transparent)] text-jp-grade-mid',
  done: 'border border-jp-line text-jp-muted',
};
const commToast = 'flex min-h-8 items-center gap-2 border-t border-jp-line bg-jp-field px-3 text-[12px] text-jp-secondary';
const commToastBar = 'h-3.5 w-0.5 shrink-0 rounded-[1px] bg-jp-grade-mid';
const commToastAi = 'rounded-[3px] border border-[color:color-mix(in_srgb,var(--jp-grade-mid)_40%,transparent)] px-1 text-[9px] font-[650] text-jp-grade-mid';
const commToastHint = 'min-w-0 flex-1 text-[10px] text-jp-muted';
const commToastActs = 'ml-auto flex gap-1';
const commToastButton = '!h-[22px] !rounded-full !border !border-jp-line !bg-transparent !px-2 !text-[10px] !font-[650] !text-jp-muted';
const commSteps = 'flex overflow-x-auto border-t border-jp-line px-3.5 pt-2.5 pb-3';
const commStep = 'relative flex min-w-0 flex-1 basis-0 flex-col items-start gap-1 pr-2 [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:left-3.5 [&:not(:last-child)]:after:right-0 [&:not(:last-child)]:after:top-[5px] [&:not(:last-child)]:after:h-px [&:not(:last-child)]:after:bg-jp-line [&:not(:last-child)]:after:content-[""]';
const commStepDot = 'relative z-[1] size-2.5 rounded-full border-[1.5px] border-jp-accent bg-jp-accent shadow-[0_0_0_3px_var(--jp-accent-soft)]';
const commStepLabel = 'flex max-w-full items-center gap-1 whitespace-nowrap text-[12px] font-[650] text-jp-ink';
const commStepMark = 'rounded-[3px] px-1 text-[9px] font-[650]';
const commStepMeta = 'max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-[1.3] text-jp-muted';
const commWork = 'flex flex-col gap-2.5 px-3.5 pt-3 pb-4';
const commWorkKey = 'flex text-[10px] tracking-[0.04em] text-jp-muted';
const commDraft = '!min-h-[88px] !rounded-[10px] !border !border-jp-line !bg-jp-inset !px-3 !py-2.5 !text-[12px] !leading-[1.55] !text-jp-ink';
const commGreetEmpty = 'rounded-[10px] border border-jp-line bg-jp-field px-3 py-2.5';
const commGreetCopy = '!mb-2 text-[12px] leading-[1.55] text-jp-secondary';
const commTools = 'grid grid-cols-2 gap-2';
const commTool = 'inline-flex min-h-9 items-center justify-center gap-1.5 !rounded-lg !border !border-jp-line !bg-jp-surface-2 !px-2.5 !text-[12px] !font-semibold !text-jp-ink disabled:opacity-45 [&_svg]:!size-[13px]';
const commToolPrimary = '!border-jp-accent-line !bg-jp-accent-soft !text-jp-accent';
const commSent = 'inline-flex min-h-9 w-full items-center justify-center !rounded-lg !border !border-jp-line !bg-transparent !px-2.5 !text-[12px] !font-semibold !text-jp-summary hover:!border-jp-line-strong hover:!text-jp-ink';
const stickyComm = 'flex shrink-0 flex-col gap-2 border-t border-jp-line bg-jp-surface px-3 pt-2.5 pb-3';
const suggestBox = 'relative rounded-[10px] border border-jp-line bg-jp-field py-2.5 pl-3 pr-9';
const suggestBody = 'max-h-[148px] overflow-auto text-[13px] leading-[1.55] text-jp-summary';
const suggestCopy = 'absolute right-2 top-2 inline-flex size-[22px] items-center justify-center !border-0 !bg-transparent !p-0 !text-jp-muted disabled:opacity-40 [&_svg]:!size-[13px]';
const commChips = 'flex flex-wrap gap-1.5';
const commChip = '!rounded-full !border !border-jp-line !bg-jp-surface-2 !px-2.5 !py-1.5 !text-[12px] !font-medium !text-jp-secondary disabled:opacity-45';
const commChipOn = '!border-jp-accent-line !bg-jp-accent-soft !font-semibold !text-jp-accent';
const commPill = 'flex h-10 items-center gap-2 rounded-full border border-jp-line bg-jp-field pl-3.5 pr-1.5 outline-none focus-within:border-[rgba(45,212,191,0.38)]';
const commPillInput = 'h-8 min-w-0 flex-1 !border-0 !bg-transparent !p-0 !text-[13px] !text-jp-ink caret-[#2dd4bf] focus:!outline-none';
const commSend = 'inline-flex size-[30px] shrink-0 items-center justify-center !rounded-full !border-0 !bg-jp-accent !p-0 !text-jp-on-accent disabled:opacity-45 [&_svg]:!size-[13px]';
const commFoot = 'flex items-center justify-end gap-2 px-0.5';
const commOpen = 'inline-flex shrink-0 items-center gap-[3px] !bg-transparent !p-0 !text-[11px] !font-medium !text-jp-muted [&_svg]:!size-[13px]';

interface DrawerProps {
  nodes: CommNode[];
  pending: CommPending | null;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onIgnore: () => void;
}

function Drawer({
  nodes, pending, expanded, onToggle, onConfirm, onIgnore,
}: DrawerProps) {
  const expandable = canExpandNodes(nodes);
  const stage = stageFrom(nodes, pending);
  const badge = headlineBadge(nodes, pending);
  const steps = railSteps(nodes, expanded);
  const badgeText = badge === 'pending' ? '待确认' : badge === 'done' ? '已过' : '当前';
  const row = (
    <>
      <span className={commDot} aria-hidden="true" />
      <span className={commDrawerKey}>当前岗位进展</span>
      <span className={commDrawerValue}>
        {stage.label}
        {stage.sub && <span className="text-[11px] font-medium text-jp-muted">{stage.sub}</span>}
        <span className={cn(commBadge, commBadgeTone[badge])}>{badgeText}</span>
      </span>
      {expandable && (
        <span className={commChev} aria-hidden="true">
          {expanded && <span className="text-[10px]">收起</span>}
          {expanded ? '▾' : '▸'}
        </span>
      )}
    </>
  );
  return (
    <div className={commDrawerClass}>
      {expandable ? (
        <button type="button" className={commDrawerRow} aria-expanded={expanded} onClick={onToggle}>
          {row}
        </button>
      ) : (
        <div className={commDrawerRow}>{row}</div>
      )}
      {pending && (
        <div className={commToast} role="status">
          <span className={commToastBar} aria-hidden="true" />
          <span className={commToastAi}>模型</span>
          <span className="font-[650] text-jp-ink">{pending.label}？</span>
          <span className={commToastHint}>{pending.hint || '摘自对话'}</span>
          <span className={commToastActs}>
            <button type="button" className={commToastButton} onClick={onIgnore}>忽略</button>
            <button type="button" className={cn(commToastButton, '!border-jp-accent-line !text-jp-accent')} onClick={onConfirm}>确认</button>
          </span>
        </div>
      )}
      {steps.length > 0 && (
        <ol className={commSteps} aria-label="岗位进展">
          {steps.map((step) => (
            <li key={step.id} className={commStep}>
              <span className={cn(commStepDot, step.ghost ? 'border-dashed border-jp-line-strong bg-transparent shadow-none' : step.state === 'done' ? 'opacity-55 shadow-none' : '')} aria-hidden="true" />
              <span className={cn(commStepLabel, (step.ghost || step.state === 'done') && 'font-medium text-jp-muted')}>
                {step.label}
                {step.mark && <span className={cn(commStepMark, step.ghost ? 'border border-[color:color-mix(in_srgb,var(--jp-grade-mid)_35%,transparent)] text-jp-grade-mid' : step.state === 'current' ? 'border border-jp-accent-line text-jp-accent' : 'border border-jp-line text-jp-muted')}>{step.mark}</span>}
              </span>
              {(step.sub || step.detail) && <span className={commStepMeta}>{[step.sub, step.detail].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChatThread({ messages }: { messages: CommMessage[] }) {
  const groups = groupChatDays(messages);
  return (
    <div className={commChat} aria-label="对话">
      {groups.map((group) => (
        <div key={group.key} className={commDayGroup}>
          {group.label && <div className={commDay}>{group.label}</div>}
          {group.messages.map((message) => {
            const me = message.role === 'me';
            return (
              <div key={message.id} className={cn(commRow, me ? 'justify-end' : 'justify-start')}>
                <div className={cn(commBubble, me ? commBubbleMe : commBubbleThem)}>
                  <span className={cn(commWho, me ? 'text-jp-accent' : 'text-jp-muted')}>{me ? '我' : 'HR'}</span>
                  {message.text}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface GreetWorkProps {
  greeting: string;
  scoring: boolean;
  onGreeting: (value: string) => void;
  onCopy: (text: string) => void;
  onAnalyze: () => void;
  onRegenerate: () => void;
  onSendGreeting: () => void;
  onMarkSent: () => void;
  onNotice: (message: string, error?: boolean) => void;
}

function GreetWork({
  greeting, scoring, onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onNotice,
}: GreetWorkProps) {
  const ready = Boolean(greeting.trim());
  return (
    <section className={commWork}>
      <div className={commWorkKey}><span>招呼语</span></div>
      {ready ? (
        <textarea className={commDraft} rows={4} aria-label="招呼语" value={greeting} onChange={(event) => onGreeting(event.target.value)} />
      ) : (
        <div className={commGreetEmpty}>
          <p className={commGreetCopy}>还没有可编辑的招呼语。可以先做一次分析。</p>
          {/* 空状态按钮原样式没有禁用透明度，这里显式覆盖回 100%。 */}
          <button type="button" className={cn(commTool, commToolPrimary, 'disabled:opacity-100')} disabled={scoring} onClick={onAnalyze}>{scoring ? '分析中…' : '生成招呼语'}</button>
        </div>
      )}
      <div className={commTools}>
        <button type="button" className={cn(commTool, commToolPrimary)} onClick={() => onNotice('还没有可附带的简历图')}>
          <Image aria-hidden="true" />发简历图
        </button>
        <button type="button" className={commTool} disabled={!ready} onClick={() => onCopy(greeting)}>
          <Copy aria-hidden="true" />复制
        </button>
        <button type="button" className={commTool} disabled={!ready} onClick={onSendGreeting}>
          <ExternalLink aria-hidden="true" />打开沟通并复制
        </button>
        <button type="button" className={commTool} disabled={scoring} onClick={onRegenerate}>
          <RefreshCw aria-hidden="true" />{scoring ? '生成中…' : '重新生成'}
        </button>
      </div>
      <button type="button" className={commSent} onClick={onMarkSent}>我已发出招呼</button>
    </section>
  );
}

export interface SuggestRequest {
  instruction: string;
  current?: string;
  stage: CommStage;
  messages: CommMessage[];
}

export interface CommTabProps {
  job: Pick<Job, 'uid'> | null | undefined;
  progressStatus?: string | null;
  record?: unknown;
  greeting: string;
  scoring: boolean;
  onGreeting: (value: string) => void;
  onCopy: (text: string) => void;
  onAnalyze: () => void;
  onRegenerate: () => void;
  onSendGreeting: () => void;
  onMarkSent: () => void;
  onOpenChat: (text: string) => void;
  onComm: (record: CommState) => void;
  onNotice: (message: string, error?: boolean) => void;
  onSuggest?: (request: SuggestRequest) => Promise<{ text?: string } | null | undefined> | null | undefined;
}

export function CommTab({
  job, progressStatus, record, greeting, scoring,
  onGreeting, onCopy, onAnalyze, onRegenerate, onSendGreeting, onMarkSent, onOpenChat, onComm, onNotice, onSuggest,
}: CommTabProps) {
  const [expanded, setExpanded] = useState(false);
  const [chipId, setChipId] = useState<string | null>(null);
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

  const rewrite = async (instruction: string, { chip = null, current }: { chip?: string | null; current?: string } = {}) => {
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
      onNotice?.(error instanceof Error ? error.message : '改写失败', true);
    } finally {
      if (ticket === generation.current) {
        inflight.current = false;
        setBusy(false);
      }
    }
  };

  const pickChip = (id: string) => {
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
    <div className={commBody} role="tabpanel" aria-label="沟通">
      <Drawer
        nodes={nodes}
        pending={pending}
        expanded={expanded && canExpandNodes(nodes)}
        onToggle={() => setExpanded((value) => !value)}
        onConfirm={() => onComm(confirmPending(clean, progressStatus))}
        onIgnore={() => onComm(ignorePending(clean))}
      />
      <div className={commScroll}>
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
        <div className={stickyComm}>
          <div className={cn(suggestBox, busy && 'opacity-[.72]')} aria-busy={busy}>
            <button type="button" className={suggestCopy} aria-label="复制建议" disabled={!suggestion} onClick={() => onCopy(suggestion)}>
              <Copy aria-hidden="true" />
            </button>
            <div className={suggestBody}>{busy ? '正在改写…' : suggestion}</div>
          </div>
          <div className={commChips} role="group" aria-label="建议标签">
            {COMM_CHIPS.map((chip) => (
              <button type="button" key={chip.id} className={cn(commChip, chipId === chip.id && commChipOn)} aria-pressed={chipId === chip.id} disabled={busy} onClick={() => pickChip(chip.id)}>
                {chip.label}
              </button>
            ))}
          </div>
          <form className={commPill} onSubmit={(event) => { event.preventDefault(); rewrite(demand, { current: suggestion }); }}>
            <input
              className={commPillInput}
              value={demand}
              onChange={(event) => setDemand(event.target.value)}
              placeholder="说说怎么改这条建议"
              aria-label="怎么改这条建议"
              disabled={busy}
            />
            <button type="submit" className={commSend} aria-label="按说明改写建议" disabled={busy || !demand.trim()}>
              <Send aria-hidden="true" />
            </button>
          </form>
          <div className={commFoot}>
            <button type="button" className={commOpen} onClick={() => onOpenChat(suggestion)}>
              <ExternalLink aria-hidden="true" />打开沟通
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
