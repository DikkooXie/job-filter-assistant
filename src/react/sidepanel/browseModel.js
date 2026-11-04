// 岗位浏览的纯展示规则。不读写存储，也不发起分析或流程推进。

export const FLOW_STATUS_LABELS = {
  prepared: '招呼语已准备',
  opened: '待确认发送',
  sent: '已发送（手动确认）',
};

export const FLOW_ENTRY_LABELS = {
  prepared: '继续流程',
  opened: '确认发送',
  sent: '查看流程',
};

export function flowStatusLabel(status) {
  return FLOW_STATUS_LABELS[status] || '待打招呼';
}

export function flowEntryLabel(status) {
  return FLOW_ENTRY_LABELS[status] || '打招呼';
}

// 读取中、读取失败、空库互斥。失败不能落到空库或「无搜索结果」。
export function librarySurface({ loading, loadError, jobCount }) {
  if (loading) return 'loading';
  if (loadError) return 'error';
  if (!jobCount) return 'empty';
  return 'ready';
}

// 原岗位还在可见列表里就回到它的标题；被移除时落到第一条；列表空了回到搜索。
export function returnFocusTarget(visibleUids, returnedUid) {
  if (returnedUid && visibleUids.includes(returnedUid)) return { kind: 'job', uid: returnedUid };
  if (visibleUids.length) return { kind: 'job', uid: visibleUids[0] };
  return { kind: 'search' };
}

export function viewConditionsChanged(view) {
  return Boolean(
    String(view?.search || '').trim()
    || (view?.platform && view.platform !== 'all')
    || (view?.verdict && view.verdict !== 'all')
    || (view?.sort && view.sort !== 'recent'),
  );
}

export function filterVisibleJobs(jobs, view) {
  const platform = view?.platform || 'all';
  const verdict = view?.verdict || 'all';
  const sort = view?.sort || 'recent';
  let list = (jobs || []).filter((job) => platform === 'all' || job.platform === platform);
  const query = String(view?.search || '').trim().toLowerCase();
  if (query) {
    list = list.filter((job) => [job.title, job.company, job.city, ...(job.skills || []), ...(job.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(query));
  }
  if (verdict !== 'all') {
    list = list.filter((job) => (verdict === 'unscored' ? !job.match : job.match?.verdict === verdict));
  }
  const recent = (a, b) => String(b.lastSeenAt || b.savedAt || '').localeCompare(String(a.lastSeenAt || a.savedAt || ''));
  const score = (a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1);
  const salary = (a, b) => (b.salaryMaxK ?? b.salaryMinK ?? 0) - (a.salaryMaxK ?? a.salaryMinK ?? 0);
  return list.sort(sort === 'score' ? score : sort === 'salary' ? salary : recent);
}

export function riskLines(job) {
  const lines = [];
  for (const word of job?._filter?.risks || []) {
    if (word) lines.push(`含「${word}」，沟通时确认相关安排`);
  }
  for (const line of job?.match?.risks || []) {
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

export function exclusionReasons(job) {
  if (!job?._filter || job._filter.keep !== false) return [];
  return (job._filter.reasons || []).filter(Boolean);
}

export function platformLabel(platform) {
  return platform === 'boss' ? 'BOSS' : '51job';
}

// 列表方案 E 的分级展示。只读已有 match.score，不另存档位。
// ≤20 一格、≤40 两格为「偏低」；≤60 三格「一般」；≤80 四格「沟通确认」；高于 80 五格「匹配」。
export function analysisGrade(match) {
  if (!match || match.score == null || match.score === '') return null;
  const raw = Number(match.score);
  if (!Number.isFinite(raw)) return null;
  const score = Math.min(100, Math.max(0, Math.round(raw)));
  if (score <= 20) return { score, filled: 1, tone: 'low', label: '偏低' };
  if (score <= 40) return { score, filled: 2, tone: 'low', label: '偏低' };
  if (score <= 60) return { score, filled: 3, tone: 'mid', label: '一般' };
  if (score <= 80) return { score, filled: 4, tone: 'mid', label: '沟通确认' };
  return { score, filled: 5, tone: 'high', label: '匹配' };
}

// 新收录胶囊展开后自动收回的时间。点击胶囊或滚动列表会提前收回。
export const FRESH_CAPSULE_MS = 8000;
// 胶囊收回后，新岗位行在列表里连续可见这么久，就清掉这一条 NEW。
export const FRESH_MARK_VISIBLE_MS = 2000;

function idSet(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value.filter(Boolean));
  return new Set();
}

// 会话内比较岗位 id。首次成功读取只建立基线，不算新收录；之后多出来的 id 记入 fresh。
// 不读写存储。岗位从库里消失时，同步从 fresh 去掉。
export function noteCapturedJobs(session, jobs) {
  const present = new Set();
  const order = [];
  for (const job of jobs || []) {
    const uid = job?.uid;
    if (!uid || present.has(uid)) continue;
    present.add(uid);
    order.push(uid);
  }
  const fresh = idSet(session?.fresh);
  for (const uid of fresh) if (!present.has(uid)) fresh.delete(uid);
  if (session?.ready !== true) {
    return { ready: true, seen: present, fresh, arrived: [] };
  }
  const seen = idSet(session?.seen);
  const arrived = [];
  for (const uid of order) {
    if (seen.has(uid)) continue;
    seen.add(uid);
    fresh.add(uid);
    arrived.push(uid);
  }
  return { ready: true, seen, fresh, arrived };
}

// 智能分析抽屉的范围。unscored 只跑已选里还没有分析结果的岗位；force 原样返回已选，交给 AI_MATCH_SCORE 的 force。
// 画像指纹项本轮不可选，不返回岗位。
export function analysisTargets(jobs, mode) {
  const list = (jobs || []).filter((job) => job?.uid);
  if (mode === 'force') return list.slice();
  if (mode === 'unscored') return list.filter((job) => !job.match);
  return [];
}
