// 侧栏岗位库只采用扩展已经收录的列表。
// 预览页的虚构岗位在 dev/browse-preview-chrome.ts，不从这里补进来。
import { PLATFORM, PLATFORM_META } from '../../common/constants.js';
import type { Job } from '../../common/types.js';

export const BOSS_BROWSE_URL = PLATFORM_META[PLATFORM.boss].searchUrl;

export function jobsForLibrary(stored: unknown): Job[] {
  if (!Array.isArray(stored)) throw new Error('岗位库数据无效');
  return stored.filter((job): job is Job => Boolean(job && typeof job.uid === 'string' && job.uid));
}
