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
