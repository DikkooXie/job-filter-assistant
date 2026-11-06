// 沟通 Tab v3.3 的纯展示规则。不读写存储，不发消息。
// 节点只来自已确认记录；没有记录时只保留「打招呼」这一真实节点。

export const COMM_CHIPS = [
  { id: 'overtime', label: '问问加班' },
  { id: 'outsourcing', label: '排除外包' },
  { id: 'scope', label: '明确工作内容' },
  { id: 'format', label: '确认面试形式' },
  { id: 'salary', label: '问薪资结构' },
];

const CHIP_IDS = new Set(COMM_CHIPS.map((chip) => chip.id));

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

export function sanitizeComm(raw) {
  const source = asObject(raw);
  const nodes = [];
  for (const item of Array.isArray(source.nodes) ? source.nodes : []) {
    const label = clean(item?.label, 16);
    if (!label) continue;
    const id = clean(item?.id, 40) || `node-${nodes.length + 1}`;
    nodes.push({
      id,
      label,
      state: item?.state === 'done' ? 'done' : 'current',
      sub: clean(item?.sub, 24),
      detail: clean(item?.detail, 40),
    });
  }
  let seenCurrent = false;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index].state !== 'current') continue;
    if (!seenCurrent) {
      seenCurrent = true;
      continue;
    }
    nodes[index] = { ...nodes[index], state: 'done' };
  }
  if (nodes.length && !seenCurrent) nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], state: 'current' };

  const pendingLabel = clean(source.pending?.label, 16);
  const pending = pendingLabel ? {
    id: clean(source.pending?.id, 40) || `pending-${nodes.length + 1}`,
    label: pendingLabel,
    sub: clean(source.pending?.sub, 24),
    hint: clean(source.pending?.hint, 24) || '摘自对话',
  } : null;

  let sync = null;
  const count = Number(source.sync?.count);
  if (Number.isFinite(count) && count > 0) {
    sync = { at: clean(source.sync?.at, 40), count: Math.min(9999, Math.round(count)) };
  }

  return {
    nodes,
    pending,
    baseline: clean(source.baseline, 600),
    messages: sanitizeMessages(source.messages),
    sync,
  };
}

function sanitizeMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const messages = [];
  const used = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const text = clean(item.text ?? item.content, 500);
    if (!text) continue;
    const roleRaw = clean(item.role ?? item.from, 16).toLowerCase();
    const role = /^(me|self|user|mine|candidate|我)$/u.test(roleRaw) ? 'me' : 'hr';
    let id = clean(item.id, 40) || `msg-${messages.length + 1}`;
    if (used.has(id)) id = `${id}-${messages.length + 1}`;
    used.add(id);
    messages.push({ id, role, text, at: clean(item.at, 40) });
    if (messages.length >= 40) break;
  }
  return messages;
}

function chatDayLabel(at, now) {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const same = (left, right) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  if (same(date, now)) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (same(date, yesterday)) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function groupChatDays(messages, now = new Date()) {
  const groups = [];
  (messages || []).forEach((message, index) => {
    const label = chatDayLabel(message?.at, now);
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) {
      groups.push({ key: `${label || 'undated'}-${message?.id || index}`, label, messages: [message] });
    } else {
      last.messages.push(message);
    }
  });
  return groups;
}

export function confirmedNodes({ progressStatus, record }) {
  const cleanRecord = sanitizeComm(record);
  if (cleanRecord.nodes.length) return cleanRecord.nodes;
  const sent = progressStatus === 'sent';
  return [{
    id: 'greet',
    label: '打招呼',
    state: sent ? 'done' : 'current',
    sub: '',
    detail: sent ? '已发' : '',
  }];
}

// 未完成打招呼时不展示建议和输入条。已发送，或已有招呼之后的确认节点，才开门。
export function isGreetGateOpen({ progressStatus, record }) {
  if (progressStatus === 'sent') return true;
  return sanitizeComm(record).nodes.some((node) => node.id !== 'greet');
}

export function canExpandNodes(nodes) {
  return Array.isArray(nodes) && nodes.length >= 2;
}

export function stageFrom(nodes, pending) {
  if (pending?.label) return { label: pending.label, sub: pending.sub || '' };
  const current = (nodes || []).find((node) => node.state === 'current') || (nodes || [])[nodes.length - 1];
  return { label: current?.label || '打招呼', sub: current?.sub || '' };
}

export function headlineBadge(nodes, pending) {
  if (pending?.label) return 'pending';
  const current = (nodes || []).find((node) => node.state === 'current') || (nodes || [])[nodes.length - 1];
  return current?.state === 'done' ? 'done' : 'current';
}

// 展开后的步骤条只在真实节点 ≥2 时出现。末尾「待生长」不计入节点，单节点永不出现。
export function railSteps(nodes, expanded) {
  if (!expanded || !canExpandNodes(nodes)) return [];
  const steps = nodes.map((node) => ({
    id: node.id,
    label: node.label,
    sub: node.sub || '',
    detail: node.detail || '',
    state: node.state,
    ghost: false,
    mark: node.state === 'done' ? '已过' : node.state === 'current' ? '当前' : '',
  }));
  steps.push({
    id: 'growth',
    label: '等结果…',
    sub: '',
    detail: '对话继续识别',
    state: 'ghost',
    ghost: true,
    mark: '待生长',
  });
  return steps;
}

export function confirmPending(record, progressStatus) {
  const cleanRecord = sanitizeComm(record);
  if (!cleanRecord.pending) return cleanRecord;
  const nodes = confirmedNodes({ progressStatus, record: cleanRecord }).map((node) => ({ ...node, state: 'done' }));
  const used = new Set(nodes.map((node) => node.id));
  let id = cleanRecord.pending.id;
  if (used.has(id)) id = `${id}-confirmed`;
  nodes.push({
    id,
    label: cleanRecord.pending.label,
    state: 'current',
    sub: cleanRecord.pending.sub,
    detail: '已确认',
  });
  return { ...cleanRecord, nodes, pending: null };
}

export function ignorePending(record) {
  const cleanRecord = sanitizeComm(record);
  return { ...cleanRecord, pending: null };
}

export function nextChip(current, chipId) {
  if (!CHIP_IDS.has(chipId)) return current || null;
  return current === chipId ? null : chipId;
}

function lead(stage) {
  if (stage?.sub) return `好的，${stage.sub}下午都可以。`;
  if (stage?.label === '初聊') return '好的，谢谢回复。';
  return '好的，收到。';
}

export function defaultBaseline(stage) {
  if (stage?.label === '一面' && stage.sub) return `好的，${stage.sub}下午都可以。一面是视频还是现场？`;
  if (stage?.label === '一面') return '好的。一面是视频还是现场？';
  if (stage?.label === '初聊') return '好的，谢谢回复。';
  return '好的，收到。';
}

export function suggestionFromChip(baseline, chipId, stage) {
  const text = String(baseline || '');
  if (!chipId || !CHIP_IDS.has(chipId)) return { text, emphasis: '', source: 'baseline', chipId: null };
  if (chipId === 'overtime') {
    const emphasis = '想了解下咱们团队平时加班大概怎样？周末需要到岗吗？';
    const head = !stage?.sub || stage?.label === '初聊' ? '好的，谢谢回复。' : lead(stage);
    return { text: `${head}${emphasis}`, emphasis, source: 'chip', chipId };
  }
  if (chipId === 'outsourcing') {
    const emphasis = '岗位是正式编制还是外包？';
    const mid = stage?.label === '一面' ? '一面是视频还是现场？' : '';
    return {
      text: `${lead(stage)}${mid}${mid ? '另外想确认下：' : '想确认下：'}${emphasis}`,
      emphasis,
      source: 'chip',
      chipId,
    };
  }
  if (chipId === 'scope') {
    const emphasis = '日常主要负责哪些模块、前后端协作怎么分';
    return { text: `${lead(stage)}想请教下：${emphasis}？团队大概多少人？`, emphasis, source: 'chip', chipId };
  }
  if (chipId === 'format') {
    const emphasis = stage?.label === '一面'
      ? '一面是视频还是现场？需要提前准备什么吗？'
      : '这次是视频还是现场？需要提前准备什么吗？';
    const head = stage?.sub ? `收到，${stage.sub}我都方便。` : '收到。';
    return { text: `${head}${emphasis}`, emphasis, source: 'chip', chipId };
  }
  const emphasis = '底薪、绩效和年终大概怎么组成？';
  return { text: `${lead(stage)}想确认下薪资结构：${emphasis}`, emphasis, source: 'chip', chipId };
}

// 自填发送只吃输入条里的改写说明，不读取当前选中的建议标签。
export function suggestionFromDemand(demand, stage) {
  const raw = String(demand || '').trim();
  if (!raw) return null;
  const body = /[。？！!?]$/.test(raw) ? raw : `${raw}。`;
  const head = stage?.sub ? `好的，${stage.sub}下午都可以。` : '好的。';
  return {
    text: `${head}${body}`,
    emphasis: raw.replace(/[。？！!?]+$/u, ''),
    source: 'demand',
    chipId: null,
  };
}

export function syncLabel(sync, now = new Date()) {
  if (!sync?.count) return '';
  const at = new Date(sync.at);
  if (Number.isNaN(at.getTime())) return `已同步 · ${sync.count} 条`;
  const sameDay = at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate();
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const when = sameDay ? `今日 ${hh}:${mm}` : `${at.getMonth() + 1}/${at.getDate()} ${hh}:${mm}`;
  return `已同步 · ${when} · ${sync.count} 条`;
}

export function chipLabel(chipId) {
  return COMM_CHIPS.find((chip) => chip.id === chipId)?.label || '';
}
