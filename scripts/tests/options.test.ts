// 设置页：页面结构、hash、筛选与通用页

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { defaultFilters, defaultSettings, STORAGE_KEYS } from '../../src/common/constants.js';
import { loadSettings, saveSettings } from '../../src/common/settingsStore.js';
import type { Settings } from '../../src/common/types.js';
import { commitTags, filterSettingsPatch, mergeFilterPatch, parseSalaryMinK, removeLastTag } from '../../src/pages/options/filterForm.js';
import { test, testAsync, section, memoryChrome, ROOT } from './harness.js';

section('设置页结构与筛选页');
test('设置页仍然使用 200 / 600 / 500 毫秒防抖', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/options/OptionsApp.tsx'), 'utf8');
  assert.match(src, /enqueue\('settings',[\s\S]*?,\s*200\)/);
  assert.match(src, /enqueue\('profile',[\s\S]*?,\s*600\)/);
  assert.match(src, /enqueue\('providers',[\s\S]*?,\s*500\)/);
  assert.doesNotMatch(src, /import\(/);
  const queueSrc = fs.readFileSync(path.join(ROOT, 'src/pages/options/saveQueue.ts'), 'utf8');
  assert.match(queueSrc, /pagehide/);
  assert.match(queueSrc, /beforeunload/);
  assert.doesNotMatch(queueSrc, /import\(/);
});

const { pageFromHash, isUpdatedHash, isChangelogHash, changelogReturnTarget, nextNavIndex, SETTINGS_PAGES, optionsUrlHash, sectionTargetId } = await import('../../src/pages/options/pageHash.js');
test('设置页 hash 保持四个页面，#updated 落到通用与隐私', () => {
  assert.deepEqual(SETTINGS_PAGES.map((page) => page.id), ['profile', 'ai', 'filters', 'general']);
  assert.equal(SETTINGS_PAGES.find((page) => page.id === 'ai')!.label, '模型接口');
  assert.equal(pageFromHash(''), 'profile');
  assert.equal(pageFromHash('#profile'), 'profile');
  assert.equal(pageFromHash('#ai'), 'ai');
  assert.equal(pageFromHash('#ai-list'), 'ai');
  assert.equal(pageFromHash('#filters'), 'filters');
  assert.equal(pageFromHash('#general'), 'general');
  assert.equal(pageFromHash('#updated'), 'general');
  assert.equal(pageFromHash('#changelog'), 'profile');
  assert.equal(pageFromHash('#nope'), 'profile');
  assert.equal(isChangelogHash('#changelog'), true);
  assert.equal(isChangelogHash('#updated'), false);
  assert.equal(isChangelogHash('#general'), false);
  assert.equal(SETTINGS_PAGES.some((page) => String(page.id) === 'changelog'), false);
  assert.equal(changelogReturnTarget('#filters'), '#filters');
  assert.equal(changelogReturnTarget('#ai-list'), '#ai-list');
  assert.equal(changelogReturnTarget('#updated'), '#updated');
  assert.equal(changelogReturnTarget('#changelog'), '#profile');
  assert.equal(changelogReturnTarget('#nope'), '#profile');
  assert.equal(changelogReturnTarget(''), '#profile');
  assert.equal(sectionTargetId('#ai'), 'ai-list-title');
  assert.equal(sectionTargetId('#ai-list'), 'ai-list-title');
  assert.equal(sectionTargetId('#profile'), '');
  assert.equal(optionsUrlHash('ai', 'options.html#profile'), '#ai');
  assert.equal(optionsUrlHash('ai', 'options.html#ai'), '#ai-list');
  assert.equal(optionsUrlHash('ai', 'options.html#ai-list'), '#ai');
  assert.equal(optionsUrlHash('profile', ''), '#profile');
  assert.equal(optionsUrlHash('', ''), '');
  assert.equal(isUpdatedHash('#updated'), true);
  assert.equal(isUpdatedHash('#general'), false);
  assert.equal(nextNavIndex(0, 'ArrowDown', 4), 1);
  assert.equal(nextNavIndex(0, 'ArrowUp', 4), 3);
  assert.equal(nextNavIndex(1, 'ArrowLeft', 4), 0);
  assert.equal(nextNavIndex(3, 'ArrowRight', 4), 0);
  assert.equal(nextNavIndex(2, 'Home', 4), 0);
  assert.equal(nextNavIndex(2, 'End', 4), 3);
  assert.equal(nextNavIndex(1, 'Enter', 4), -1);
});

test('个人画像页去掉重复完整度，右栏保留缺失项', () => {
  const root = ROOT;
  const tab = fs.readFileSync(path.join(root, 'src/pages/options/ProfileTab.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src/pages/options/SettingsShell.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/options/shell.css'), 'utf8');
  assert.doesNotMatch(tab, /完整度/);
  assert.match(tab, /简历文件/);
  assert.match(tab, /粘贴文本/);
  assert.match(tab, /画像 JSON/);
  assert.match(tab, /抽取时文本会发给当前启用的 AI，确认后才写入画像。/);
  assert.match(tab, /只用于匹配打分，不会写进招呼语/);
  assert.match(tab, /AI 撰写招呼语时只会引用这里写到的事实/);
  assert.match(tab, /字面或 AI 语义命中都会降低匹配分，岗位仍会保留/);
  assert.ok(!tab.includes('label="规避关键词"'));
  assert.ok(!tab.includes('一票否决'));
  assert.match(tab, /合并到画像/);
  assert.match(tab, /替换现有画像/);
  assert.match(shell, /aria-label="画像完整度"/);
  assert.match(shell, /score\.missing\.map/);
  assert.match(css, /max-width:\s*1080px/);
  assert.match(css, /max-width:\s*860px/);
});

test('设置页颜色变量挂在 .settings-root，错误使用 alert', () => {
  const root = ROOT;
  const html = fs.readFileSync(path.join(root, 'extension-pages/options.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/options/shell.css'), 'utf8');
  const globals = fs.readFileSync(path.join(root, 'src/pages/globals.css'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/pages/options/OptionsApp.tsx'), 'utf8');
  assert.match(html, /<body class="settings-root">/);
  assert.match(css, /\.settings-root\s*\{/);
  assert.match(css, /--s-page:\s*#f1f2f0/);
  assert.match(css, /--s-page:\s*#161d22/);
  assert.doesNotMatch(css, /:root\s*\{[^}]*--s-page/);
  // globals.css 只能用 var(--s-page) 起工具类名，不能在这里定义它。
  assert.doesNotMatch(globals, /--s-page\s*:/);
  assert.match(options, /role=\{notice\?\.error \? 'alert' : 'status'\}/);
  assert.match(options, /aria-live="polite"/);
  assert.doesNotMatch(options, /import\(/);
});

// ---------- 岗位筛选页 ----------
section('岗位筛选页');
test('风险词默认值不变', () => {
  assert.deepEqual(defaultFilters().riskKeywords, ['外包', '驻场', '猎头', '销售', '电销', '中介']);
});
test('标签回车逗号确认、空退格删除、大小写去重', () => {
  assert.deepEqual(commitTags(['前端'], 'React'), ['前端', 'React']);
  assert.deepEqual(commitTags([], '前端，React'), ['前端', 'React']);
  const existing = ['React'];
  assert.equal(commitTags(existing, 'react'), existing);
  const same = ['前端'];
  assert.equal(commitTags(same, ''), same);
  assert.equal(commitTags(same, '   '), same);
  assert.deepEqual(removeLastTag(['前端', 'React'], ''), ['前端']);
  assert.deepEqual(removeLastTag(['前端', 'React'], 'R'), ['前端', 'React']);
  assert.deepEqual(removeLastTag([], ''), []);
});
test('月薪下限空值写成 null，非法数字不落成 NaN', () => {
  assert.equal(parseSalaryMinK(''), null);
  assert.equal(parseSalaryMinK('  '), null);
  assert.equal(parseSalaryMinK(null), null);
  assert.equal(parseSalaryMinK('18'), 18);
  assert.equal(parseSalaryMinK('18.5'), 18.5);
  assert.equal(parseSalaryMinK('0'), 0);
  assert.equal(parseSalaryMinK('abc'), null);
});
test('筛选页补丁不携带 salaryMaxK，合并后原值还在', () => {
  const current = { ...defaultFilters(), salaryMaxK: 36, salaryMinK: 12, keywordsInclude: ['前端'], note: 'keep' };
  const patch = filterSettingsPatch({ salaryMinK: 20, enabled: true, salaryMaxK: null, keywordsExclude: ['电销'] });
  assert.deepEqual(Object.keys(patch.filters).sort(), ['enabled', 'keywordsExclude', 'salaryMinK']);
  assert.equal('salaryMaxK' in patch.filters, false);
  const merged = mergeFilterPatch(current, { salaryMinK: 20, salaryMaxK: null, keywordsExclude: ['电销'] });
  assert.equal(merged.salaryMaxK, 36);
  assert.equal(merged.salaryMinK, 20);
  assert.deepEqual(merged.keywordsInclude, ['前端']);
  assert.deepEqual(merged.keywordsExclude, ['电销']);
  assert.equal(merged.note, 'keep');
  for (const key of Object.keys(defaultFilters())) assert.ok(Object.prototype.hasOwnProperty.call(merged, key), key);
});
test('筛选页不渲染月薪上限，保存仍走字段合并', () => {
  const root = ROOT;
  const tab = fs.readFileSync(path.join(root, 'src/pages/options/FiltersTab.tsx'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/pages/options/OptionsApp.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/common/settingsStore.ts'), 'utf8');
  assert.match(tab, /filterSettingsPatch/);
  assert.match(tab, /包含任一/);
  assert.match(tab, /公司与城市/);
  assert.match(tab, /薪资与要求/);
  // 风险词标签用红色底，和普通标签区分。
  assert.match(tab, /tone="risk"/);
  assert.match(tab, /tone === 'risk' && 'bg-danger-soft text-danger'/);
  assert.match(tab, /岗位最高薪资低于这个数就不显示/);
  assert.match(tab, /只在岗位上标注提醒，筛选关闭时也生效/);
  assert.match(tab, /value="filters"/);
  assert.doesNotMatch(tab, /salaryMaxK/);
  assert.match(options, /filters:\s*\{\s*\.\.\.old\.filters,\s*\.\.\.patch\.filters\s*\}/);
  assert.match(store, /filters:\s*\{\s*\.\.\.cur\.filters,\s*\.\.\.\(patch && patch\.filters\)\s*\}/);
});


await testAsync('保存筛选补丁时 storage 里的 salaryMaxK 原样保留', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = memoryChrome();
  try {
    const stored = defaultSettings();
    stored.filters = { ...defaultFilters(), salaryMaxK: 36, salaryMinK: 12, keywordsInclude: ['前端'] };
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: stored });
    const patch = filterSettingsPatch({
      salaryMinK: parseSalaryMinK('20'),
      enabled: true,
      salaryMaxK: null,
      keywordsExclude: commitTags([], '电销'),
    });
    const saved = await saveSettings(patch);
    assert.equal(saved.filters.salaryMaxK, 36);
    assert.equal(saved.filters.salaryMinK, 20);
    assert.equal(saved.filters.enabled, true);
    assert.deepEqual(saved.filters.keywordsInclude, ['前端']);
    assert.deepEqual(saved.filters.keywordsExclude, ['电销']);
    assert.deepEqual(saved.filters.riskKeywords, defaultFilters().riskKeywords);
    assert.deepEqual(Object.keys(saved.filters).sort(), Object.keys(defaultFilters()).sort());
    const again = await saveSettings({ filters: { salaryMinK: 22 } });
    assert.equal(again.filters.salaryMaxK, 36);
    assert.equal(again.filters.salaryMinK, 22);
    const loaded = await loadSettings();
    assert.equal(loaded.filters.salaryMaxK, 36);
    assert.deepEqual(Object.keys(loaded.filters).sort(), Object.keys(defaultFilters()).sort());
  } finally {
    if (previous === undefined) delete (globalThis as { chrome?: typeof chrome }).chrome;
    else globalThis.chrome = previous;
  }
});

await testAsync('旧设置没有 updateChannel 时按稳定读回，非法值不会落库', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = memoryChrome();
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: { mode: 'boss', showBadge: false, maxJobs: 500 },
    });
    const loaded = await loadSettings();
    assert.equal(loaded.updateChannel, 'stable');
    assert.equal(loaded.mode, 'boss');
    assert.equal(loaded.showBadge, false);
    assert.equal(loaded.maxJobs, 500);
    assert.equal(loaded.autoCapture, true);
    const preview = await saveSettings({ updateChannel: 'preview' });
    assert.equal(preview.updateChannel, 'preview');
    assert.equal(preview.showBadge, false);
    assert.equal(preview.mode, 'boss');
    // 模拟存储里混进的非法渠道值，绕过类型检查直接传入。
    const nightly: unknown = 'nightly';
    const junk = await saveSettings({ updateChannel: nightly as Settings['updateChannel'] });
    assert.equal(junk.updateChannel, 'stable');
    assert.equal(junk.showBadge, false);
    assert.equal((await loadSettings()).updateChannel, 'stable');
  } finally {
    if (previous === undefined) delete (globalThis as { chrome?: typeof chrome }).chrome;
    else globalThis.chrome = previous;
  }
});

const { summarizeJobs } = await import('../../src/pages/options/jobStats.js');
test('岗位库数量只统计列表和收藏', () => {
  assert.deepEqual(summarizeJobs(null), { total: 0, starred: 0 });
  assert.deepEqual(summarizeJobs([{ star: true }, { star: false }, {}, null]), { total: 4, starred: 1 });
});

test('通用与隐私页保留原设置字段，并用岗位列表统计数量', () => {
  const root = ROOT;
  const page = fs.readFileSync(path.join(root, 'src/pages/options/GeneralTab.tsx'), 'utf8');
  const recipes = fs.readFileSync(path.join(root, 'src/pages/options/recipes.ts'), 'utf8');
  for (const key of ['autoCapture', 'autoScore', 'showBadge', 'dedupe', 'maxJobs', 'redactPII', 'sendCompanyName', 'confirmBeforeSend']) {
    assert.match(page, new RegExp(key));
  }
  assert.match(page, /JOB_LIST_REQUEST/);
  assert.match(page, /跟随当前网站/);
  assert.match(page, /只用 BOSS 直聘/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /type="radio"/);
  assert.match(page, /<UpdatePanel /);
  assert.match(page, /UpdatePanel/);
  assert.match(page, /updateChannel/);
  const panel = fs.readFileSync(path.join(root, 'src/pages/options/UpdatePanel.tsx'), 'utf8');
  const updater = fs.readFileSync(path.join(root, 'src/extension/update.ts'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts/release.ts'), 'utf8');
  assert.match(panel, /更新通道/);
  assert.match(panel, /\['stable', '稳定'\]/);
  assert.match(panel, /\['preview', '预览'\]/);
  assert.match(panel, /fetchLatestRelease\(channel\)/);
  assert.match(panel, /aheadOfStable/);
  assert.match(panel, /正式版发布页/);
  assert.match(panel, /打开扩展管理页/);
  assert.match(updater, /resolvePreviewCheck/);
  assert.match(updater, /parseRelease\(await fetchGithub\(request\.url\)\)/);
  assert.match(updater, /fetchReleaseNotes/);
  assert.match(updater, /releaseRequest\('preview'\)/);
  assert.match(updater, /changelogEntries\(json, channel\)/);
  assert.match(panel, /checkToken/);
  assert.match(panel, /fetchLatestRelease\(channel\)/);
  const shell = fs.readFileSync(path.join(root, 'src/pages/options/SettingsShell.tsx'), 'utf8');
  const logPage = fs.readFileSync(path.join(root, 'src/pages/options/ChangelogPage.tsx'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/pages/options/OptionsApp.tsx'), 'utf8');
  const shellCss = fs.readFileSync(path.join(root, 'src/pages/options/shell.css'), 'utf8');
  assert.match(shell, /检查更新/);
  assert.match(shell, /更新日志/);
  assert.match(shell, /onCheckUpdate/);
  assert.match(shell, /isChangelogHash/);
  assert.match(shell, /changelogReturnTarget/);
  assert.match(shell, /aria-current=\{!logOpen && page === item\.id \? 'page' : undefined\}/);
  assert.doesNotMatch(shell, /改动区/);
  assert.doesNotMatch(shell, /ChangelogDrawer/);
  assert.doesNotMatch(shell, /location\.hash = '#general'/);
  assert.match(logPage, /fetchReleaseNotes/);
  assert.match(logPage, /在 GitHub 查看全部/);
  assert.match(logPage, /近期版本改动一览/);
  assert.match(logPage, /formatChangelogWhen/);
  assert.match(logPage, /当前/);
  assert.match(logPage, /返回设置/);
  assert.match(logPage, /CHANGELOG_SECTION_ORDER/);
  assert.match(logPage, /aria-expanded/);
  assert.match(logPage, /暂时还没有整理好的版本说明/);
  assert.match(logPage, /在 GitHub 查看/);
  assert.match(logPage, /本版暂无整理好的更新说明/);
  assert.doesNotMatch(logPage, /还没有发布/);
  assert.doesNotMatch(logPage, /还没有正式版/);
  assert.doesNotMatch(logPage, /本版无新功能/);
  assert.doesNotMatch(logPage, /item\.bullets/);
  assert.doesNotMatch(logPage, /示意条目/);
  assert.doesNotMatch(logPage, /CHANGELOG\.md/);
  assert.doesNotMatch(logPage, /预览通道/);
  assert.doesNotMatch(logPage, /settings-log-scrim/);
  assert.match(options, /isChangelogHash\(location\.hash\) \|\| pageFromHash\(location\.hash\) !== 'general'/);
  assert.match(panel, /location\.hash === '#updated'/);
  assert.doesNotMatch(shellCss, /settings-log-scrim/);
  assert.doesNotMatch(shellCss, /settings-log-panel/);
  assert.doesNotMatch(shellCss, /50vh/);
  assert.match(shellCss, /padding:\s*18px 28px 14px/);
  assert.match(shellCss, /margin:\s*0 0 8px/);
  assert.match(shellCss, /margin:\s*4px 0 0/);
  assert.match(shellCss, /margin-top:\s*28px/);
  assert.match(shellCss, /padding:\s*18px 28px 20px/);
  assert.match(shellCss, /padding-left:\s*18px/);
  assert.match(shellCss, /margin-bottom:\s*22px/);
  assert.match(shellCss, /gap:\s*8px 12px/);
  assert.match(shellCss, /margin-bottom:\s*8px/);
  assert.match(shellCss, /gap:\s*5px/);
  assert.match(shellCss, /settings-tl-sec-head/);
  assert.match(shellCss, /rotate\(90deg\)/);
  assert.match(shellCss, /settings-tl-sec-body\[hidden\]/);
  assert.match(shellCss, /settings-tl-features/);
  assert.match(script, /prerelease \? \['--prerelease'\] : \[\]/);
  assert.match(script, /四段版本号/);
  assert.doesNotMatch(page, /JOB_COUNT|JOB_STATS|SHOW_BADGE/);
  // 开关保持 36×21 的胶囊尺寸，并有键盘聚焦环。
  assert.match(page, /role="switch" className=\{switchInput\}/);
  assert.match(recipes, /export const switchInput = \[[^\]]*h-\[21px\] w-9/);
  assert.match(recipes, /focus-visible:outline-2/);
});

test('cn 认识设置页字号令牌，且与 globals.css 的 --text-* 一一对应', async () => {
  const { cn, SIZE_TOKENS } = await import('../../src/lib/cn.js');
  // 默认的 cn 会把 text-body 当成文字颜色，和 text-ink-1 合并时丢掉字号。
  assert.equal(cn('text-body text-ink-1'), 'text-body text-ink-1');
  assert.equal(cn('text-sm text-control'), 'text-control');
  const globals = fs.readFileSync(path.join(ROOT, 'src/pages/globals.css'), 'utf8');
  const declared = [...globals.matchAll(/--text-([a-z]+):/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...SIZE_TOKENS].sort());
});
