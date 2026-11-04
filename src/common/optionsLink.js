// 设置页深链。只决定打开哪一页，不改存储字段或消息类型名。
// `#ai` 与 `#ai-list` 都落在「模型接口」；两者交替是为了重复打开时再次滚到该分组。

export const OPTIONS_PAGES = ['profile', 'ai', 'filters', 'general'];

export function pageFromOptionsHash(hash) {
  const id = String(hash || '').replace(/^#/, '');
  if (id === 'updated') return 'general';
  if (id === 'ai' || id === 'ai-list') return 'ai';
  return OPTIONS_PAGES.includes(id) ? id : 'profile';
}

export function sectionTargetId(hash) {
  const id = String(hash || '').replace(/^#/, '');
  if (id === 'ai' || id === 'ai-list') return 'ai-list-title';
  return '';
}

export function optionsUrlHash(page, currentUrl = '') {
  if (!OPTIONS_PAGES.includes(page)) return '';
  if (page !== 'ai') return `#${page}`;
  const current = String(currentUrl).split('#')[1] || '';
  return current === 'ai' ? '#ai-list' : '#ai';
}
