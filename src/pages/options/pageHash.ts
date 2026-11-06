// 设置页 hash。#updated 是更新完成后的入口，必须继续落在「通用与隐私」，
// 且不能在 UpdatePanel 读取 location.hash 之前被改写成 #general。
import { pageFromOptionsHash } from '../../common/optionsLink.js';
import type { OptionsPage } from '../../common/optionsLink.js';

export { optionsUrlHash, sectionTargetId } from '../../common/optionsLink.js';

export interface SettingsPageMeta {
  id: OptionsPage;
  label: string;
  lead?: string;
}

export const SETTINGS_PAGES: readonly SettingsPageMeta[] = [
  { id: 'profile', label: '个人画像', lead: 'AI 按这些信息给岗位打匹配分，不会隐藏岗位。' },
  { id: 'ai', label: '模型接口' },
  { id: 'filters', label: '岗位筛选', lead: '按规则直接决定列表里显示哪些岗位，不经过 AI。' },
  { id: 'general', label: '通用与隐私' },
];

export function pageFromHash(hash: string): OptionsPage {
  return pageFromOptionsHash(hash);
}

export function isUpdatedHash(hash: unknown): boolean {
  return String(hash || '') === '#updated';
}

// 更新日志是主区里的一页，不是第五个设置导航项。
// 不要把它写进 pageFromHash：未知 hash 仍回「个人画像」，#updated 仍回「通用与隐私」。
export const CHANGELOG_HASH = '#changelog';
export const CHANGELOG_RETURN_KEY = 'jfa-changelog-return';

export function isChangelogHash(hash: unknown): boolean {
  return String(hash || '') === CHANGELOG_HASH;
}

const CHANGELOG_RETURN_HASHES = new Set(['#profile', '#ai', '#ai-list', '#filters', '#general', '#updated']);

/** 「‹ 设置」回到进入日志前的地址。无法识别时回个人画像，且不会停在日志页自己。 */
export function changelogReturnTarget(saved: unknown): string {
  const hash = String(saved || '');
  return CHANGELOG_RETURN_HASHES.has(hash) ? hash : '#profile';
}

export function nextNavIndex(index: number, key: string, count: number): number {
  if (count <= 0 || index < 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1) % count;
  return -1;
}

export function formatSavedClock(timestamp: number | null): string {
  if (timestamp == null || Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
