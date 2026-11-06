// 岗位库数量只从 JOB_LIST_REQUEST 的列表统计，不新增后台消息。
import type { Job } from '../../common/types.js';

export interface JobStats {
  total: number;
  starred: number;
}

export function summarizeJobs(list: unknown): JobStats {
  if (!Array.isArray(list)) return { total: 0, starred: 0 };
  let starred = 0;
  for (const job of list as Array<Pick<Job, 'star'> | null | undefined>) {
    if (job && job.star) starred += 1;
  }
  return { total: list.length, starred };
}
