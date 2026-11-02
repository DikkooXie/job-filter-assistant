// 岗位库数量只从 JOB_LIST_REQUEST 的列表统计，不新增后台消息。

export function summarizeJobs(list) {
  if (!Array.isArray(list)) return { total: 0, starred: 0 };
  let starred = 0;
  for (const job of list) {
    if (job && job.star) starred += 1;
  }
  return { total: list.length, starred };
}
