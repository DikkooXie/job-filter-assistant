// 设置页 hash。#updated 是更新完成后的入口，必须继续落在「通用与隐私」，
// 且不能在 UpdatePanel 读取 location.hash 之前被改写成 #general。

export const SETTINGS_PAGES = [
  { id: 'profile', label: '个人画像' },
  { id: 'ai', label: 'AI 接口' },
  { id: 'filters', label: '岗位筛选' },
  { id: 'general', label: '通用与隐私' },
];

const PAGE_IDS = new Set(SETTINGS_PAGES.map((page) => page.id));

export function pageFromHash(hash) {
  const id = String(hash || '').replace(/^#/, '');
  if (id === 'updated') return 'general';
  return PAGE_IDS.has(id) ? id : 'profile';
}

export function isUpdatedHash(hash) {
  return String(hash || '') === '#updated';
}

export function nextNavIndex(index, key, count) {
  if (count <= 0 || index < 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1) % count;
  return -1;
}

export function formatSavedClock(timestamp) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
