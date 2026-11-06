// 侧栏岗位库只采用扩展已经收录的列表。
// 预览页的虚构岗位在 dev/browse-preview-chrome.js，不从这里补进来。
import { PLATFORM, PLATFORM_META } from '../../common/constants.js';

export const BOSS_BROWSE_URL = PLATFORM_META[PLATFORM.boss].searchUrl;

export function jobsForLibrary(stored) {
  if (!Array.isArray(stored)) throw new Error('岗位库数据无效');
  return stored.filter((job) => job && typeof job.uid === 'string' && job.uid);
}
