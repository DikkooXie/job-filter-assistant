// 扩展内更新

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { defaultSettings } from '../../src/common/constants.js';
import { mergeSettings } from '../../src/common/settingsStore.js';
import {
  parseVersion, compareVersions, parseRelease, extensionIdFromKey, packageManifestError, isSameInstall, safeEntryPath, planWrites, unzipGuard, toHex, staleAssets, RELEASE_API, RELEASES_API, NO_PREVIEW_MESSAGE, AHEAD_OF_STABLE_MESSAGE, normalizeUpdateChannel, releaseRequest, selectPreviewRelease, resolvePreviewCheck, assessUpdate, changelogTitle, changelogSummary, changelogBullets, changelogSections, formatChangelogWhen, isCurrentChangelogVersion, changelogEntries, RELEASES_PAGE,
} from '../../src/common/update.js';
import { test, testAsync, section, ROOT } from './harness.js';

section('扩展内更新');
const selfManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SELF_ID = 'bpepclacjmlmbljmggblckdocinkdide';
const release = (over = {}) => ({
  tag_name: 'v1.2.0', name: 'v1.2.0', body: ' 说明 ', html_url: 'https://github.com/x/y/releases/tag/v1.2.0',
  assets: [{ name: 'job-filter-assistant-1.2.0.zip', size: 10, browser_download_url: 'https://github.com/DikkooXie/job-filter-assistant/releases/download/v1.2.0/a.zip' }],
  ...over,
});

test('版本解析与比较', () => {
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0, 0]);
  assert.equal(parseVersion('1.2.beta'), null);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.0.3.1', '1.0.3'), 1);
  assert.equal(compareVersions('1.0.3', '1.0.3.0'), 0);
  assert.throws(() => compareVersions('x', '1'));
});
test('解析 Release：正常', () => {
  const r = parseRelease(release());
  assert.equal(r.version, '1.2.0');
  assert.equal(r.notes, '说明');
  assert.ok(r.zipUrl.endsWith('a.zip'));
});
test('解析 Release：拒绝预发布、无 zip、非 GitHub 地址', () => {
  assert.throws(() => parseRelease(release({ prerelease: true })));
  assert.throws(() => parseRelease(release({ assets: [] })));
  assert.throws(() => parseRelease(release({ assets: [{ name: 'a.zip', browser_download_url: 'https://evil.example/a.zip' }] })));
  assert.throws(() => parseRelease(release({ tag_name: 'latest' })));
  assert.throws(() => parseRelease(release({ assets: [{ name: 'a.zip', browser_download_url: 'https://github.com/someone/else/releases/download/v1/a.zip' }] })), /本项目/);
});
test('更新通道缺省为稳定，预览才请求发布列表', () => {
  assert.equal(normalizeUpdateChannel(undefined), 'stable');
  assert.equal(normalizeUpdateChannel(''), 'stable');
  assert.equal(normalizeUpdateChannel('beta'), 'stable');
  assert.equal(normalizeUpdateChannel('preview'), 'preview');
  assert.equal(releaseRequest().url, RELEASE_API);
  assert.equal(releaseRequest('stable').url, RELEASE_API);
  assert.equal(releaseRequest('nope').channel, 'stable');
  assert.equal(releaseRequest('preview').channel, 'preview');
  assert.equal(releaseRequest('preview').url, `${RELEASES_API}?per_page=20`);
  assert.equal(mergeSettings(null).updateChannel, 'stable');
  assert.equal(mergeSettings({ mode: 'boss' }).updateChannel, 'stable');
  assert.equal(mergeSettings({ updateChannel: 'preview', mode: 'boss' }).updateChannel, 'preview');
  assert.equal(mergeSettings({ updateChannel: 'preview', mode: 'boss' }).mode, 'boss');
  assert.equal(mergeSettings({ updateChannel: 'nightly' }).updateChannel, 'stable');
  assert.equal(defaultSettings().updateChannel, 'stable');
});
test('稳定通道拒绝 prerelease 和 draft，预览通道接受 prerelease', () => {
  assert.throws(() => parseRelease(release({ prerelease: true }), { channel: 'stable' }), /正式版本/);
  assert.throws(() => parseRelease(release({ draft: true })), /正式版本/);
  assert.throws(() => parseRelease(release({ draft: true, prerelease: true }), { channel: 'preview' }), /正式版本/);
  const preview = parseRelease(release({
    prerelease: true,
    tag_name: 'v1.0.3.1',
    assets: [{ name: 'a.zip', size: 12, browser_download_url: 'https://github.com/DikkooXie/job-filter-assistant/releases/download/v1.0.3.1/a.zip' }],
  }), { channel: 'preview' });
  assert.equal(preview.version, '1.0.3.1');
  assert.equal(preview.zipSize, 12);
  assert.throws(() => parseRelease(release({
    prerelease: true,
    assets: [{ name: 'a.zip', browser_download_url: 'https://evil.example/a.zip' }],
  }), { channel: 'preview' }), /本项目/);
});
test('预览列表按版本号取最高的带 zip prerelease，没有则暂无预览版', () => {
  const zip = (tag: string) => ({ name: 'a.zip', browser_download_url: `https://github.com/DikkooXie/job-filter-assistant/releases/download/${tag}/a.zip` });
  const pre = (tag: string, over: Record<string, unknown> = {}) => release({ tag_name: tag, prerelease: true, assets: [zip(tag)], ...over });
  // GitHub /releases 按 tag_name 字符串降序：.9 … .2 在 .10 前面
  const githubOrder = [
    pre('v1.0.3.9'),
    pre('v1.0.3.8'),
    pre('v1.0.3.2'),
    pre('v1.0.3.10'),
    pre('v1.0.3.1'),
  ];
  const draft = pre('v1.0.3.11', { draft: true });
  const stable = release({ tag_name: 'v1.0.3', prerelease: false, assets: [zip('v1.0.3')] });
  const noZip = release({ tag_name: 'v1.0.3.12', prerelease: true, assets: [] });
  assert.equal(selectPreviewRelease([draft, stable, noZip, ...githubOrder])!.version, '1.0.3.10');
  assert.equal(selectPreviewRelease([githubOrder[3], githubOrder[0]])!.version, '1.0.3.10');
  assert.equal(selectPreviewRelease([]), null);
  assert.equal(selectPreviewRelease([stable, draft, noZip]), null);
  const empty = resolvePreviewCheck([stable, draft, noZip], '1.0.3');
  assert.equal(empty.previewUnavailable, true);
  assert.equal(empty.hasUpdate, false);
  assert.equal(empty.aheadOfStable, false);
  assert.equal(empty.message, NO_PREVIEW_MESSAGE);
  assert.equal(resolvePreviewCheck([], '1.0.3').previewUnavailable, true);
  assert.equal(resolvePreviewCheck([], '1.0.3').message, '暂无预览版');
  assert.throws(() => selectPreviewRelease({ message: 'nope' }), /格式不正确/);
  const newer = resolvePreviewCheck(githubOrder, '1.0.3.9');
  assert.equal(newer.hasUpdate, true);
  assert.equal(newer.previewUnavailable, false);
  assert.equal(newer.version, '1.0.3.10');
  assert.equal(newer.channel, 'preview');
});
test('稳定通道上正式版更旧时只提示手动覆盖，不标记可更新', () => {
  const stable = parseRelease(release({ tag_name: 'v1.0.3' }));
  const ahead = assessUpdate(stable, '1.0.3.1', 'stable');
  assert.equal(ahead.hasUpdate, false);
  assert.equal(ahead.aheadOfStable, true);
  assert.equal(ahead.message, AHEAD_OF_STABLE_MESSAGE);
  assert.equal(ahead.channel, 'stable');
  const same = assessUpdate(stable, '1.0.3', 'stable');
  assert.equal(same.hasUpdate, false);
  assert.equal(same.aheadOfStable, false);
  assert.match(same.message, /^已是最新版本（1\.0\.3）$/);
  const newer = assessUpdate(parseRelease(release({ tag_name: 'v1.0.4' })), '1.0.3', 'stable');
  assert.equal(newer.hasUpdate, true);
  assert.equal(newer.aheadOfStable, false);
  assert.equal(newer.message, '');
  const previewCurrent = assessUpdate(parseRelease(release({
    tag_name: 'v1.0.3.1',
    prerelease: true,
    assets: [{ name: 'a.zip', browser_download_url: 'https://github.com/DikkooXie/job-filter-assistant/releases/download/v1.0.3.1/a.zip' }],
  }), { channel: 'preview' }), '1.0.3.1', 'preview');
  assert.equal(previewCurrent.hasUpdate, false);
  assert.equal(previewCurrent.aheadOfStable, false);
});
test('更新日志按通道过滤正式版和预发布，版本号标题不重复', () => {
  const note = '**更新**机制的 [说明](https://example.com) `代码`';
  const list = [
    release({
      tag_name: 'v1.0.3.7', name: 'v1.0.3.7', prerelease: true, draft: false,
      published_at: '2026-11-04T07:26:09Z', body: '预览：列表抽屉',
      html_url: 'https://github.com/DikkooXie/job-filter-assistant/releases/tag/v1.0.3.7',
    }),
    release({
      tag_name: 'v1.0.3', name: '固定文件名', prerelease: false,
      published_at: '2026-11-02T12:28:37Z', body: note, assets: [],
    }),
    release({ tag_name: 'v9.9.9', prerelease: false, draft: true, body: '草稿' }),
    release({ tag_name: 'latest', prerelease: false, body: '坏版本' }),
    null,
  ];
  assert.equal(changelogTitle('v1.0.3.7', '1.0.3.7', 'v1.0.3.7'), '');
  assert.equal(changelogTitle('固定文件名', '1.0.3', 'v1.0.3'), '固定文件名');
  assert.equal(changelogSummary(note), '更新机制的 说明 代码');
  const long = '字'.repeat(120);
  const summary = changelogSummary(long);
  assert.equal(summary.length, 81);
  assert.ok(summary.endsWith('…'));
  const stable = changelogEntries(list, 'stable');
  assert.equal(stable.length, 1);
  assert.equal(stable[0]!.version, '1.0.3');
  assert.equal(stable[0]!.title, '固定文件名');
  assert.equal(stable[0]!.summary, '更新机制的 说明 代码');
  assert.equal(stable[0]!.prerelease, false);
  assert.equal(stable[0]!.pageUrl, list[1]!.html_url);
  const preview = changelogEntries(list, 'nope');
  assert.deepEqual(preview.map((item) => item.version), ['1.0.3']);
  const withPreview = changelogEntries(list, 'preview');
  assert.deepEqual(withPreview.map((item) => item.version), ['1.0.3.7', '1.0.3']);
  assert.equal(withPreview[0]!.title, '');
  assert.equal(withPreview[0]!.summary, '预览：列表抽屉');
  assert.deepEqual(withPreview[0]!.bullets, ['列表抽屉']);
  assert.deepEqual(withPreview[0]!.sections, { added: [], ui: [], fixed: [] });
  assert.equal(withPreview[0]!.prerelease, true);
  assert.equal(withPreview[0]!.publishedAt, '2026-11-04T07:26:09Z');
  assert.throws(() => changelogEntries({ message: 'nope' }), /格式不正确/);
  assert.equal(RELEASES_PAGE, 'https://github.com/DikkooXie/job-filter-assistant/releases');
});
test('更新日志按发布时间降序，缺时间戳时按版本号降序', () => {
  // GitHub /releases 按 tag 字符串降序，.9 会排在 .11 前面；发布时间新的应排到最前。
  const githubStringOrder = [
    release({
      tag_name: 'v1.0.3.9', name: 'v1.0.3.9', prerelease: true,
      published_at: '2026-11-03T08:00:00Z', body: '九点',
    }),
    release({
      tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true,
      published_at: '2026-11-04T08:00:00Z', body: '十一',
    }),
    release({ tag_name: 'v1.0.3.12', prerelease: true, draft: true, published_at: '2026-11-05T08:00:00Z', body: '草稿' }),
    release({ tag_name: 'latest', prerelease: false, published_at: '2026-11-06T08:00:00Z', body: '坏版本' }),
  ];
  const sorted = changelogEntries(githubStringOrder, 'preview');
  assert.equal(sorted[0]!.version, '1.0.3.11');
  assert.deepEqual(sorted.map((item) => item.version), ['1.0.3.11', '1.0.3.9']);
  assert.deepEqual(changelogEntries(githubStringOrder, 'stable'), []);

  const missingTime = [
    release({ tag_name: 'v1.0.3.9', name: 'v1.0.3.9', prerelease: true, published_at: '', body: '九' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, body: '十一' }),
  ];
  assert.equal(changelogEntries(missingTime, 'preview')[0]!.version, '1.0.3.11');
  assert.deepEqual(changelogEntries(missingTime, 'preview').map((item) => item.version), ['1.0.3.11', '1.0.3.9']);

  const equalTime = [
    release({ tag_name: 'v1.0.3.9', name: 'v1.0.3.9', prerelease: true, published_at: '2026-11-04T08:00:00Z' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, published_at: '2026-11-04T08:00:00Z' }),
  ];
  assert.equal(changelogEntries(equalTime, 'preview')[0]!.version, '1.0.3.11');

  const invalidTime = [
    release({ tag_name: 'v1.0.3.2', name: 'v1.0.3.2', prerelease: true, published_at: 'not-a-date' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, published_at: 'also-bad' }),
  ];
  assert.equal(changelogEntries(invalidTime, 'preview')[0]!.version, '1.0.3.11');
});
test('更新日志条目去掉预览前缀、issue 号和方案代号，时间带到分钟', () => {
  assert.deepEqual(
    changelogBullets('预览：智能分析第三项按当前画像指纹补跑（#64）'),
    ['智能分析第三项按当前画像指纹补跑'],
  );
  assert.deepEqual(
    changelogBullets('预览：批量分析进度细条与半高队列（#63）；设置左栏检查更新与更新日志（#66）；不喜欢自然语言写入雷点（#65）'),
    ['批量分析进度细条与半高队列', '设置左栏检查更新与更新日志', '不喜欢自然语言写入雷点'],
  );
  assert.deepEqual(
    changelogBullets('预览：列表警示区方案 A（#53）；操作行删除确认文案改为「再次点击确认删除」（#52/#54）'),
    ['列表警示区', '操作行删除确认文案改为「再次点击确认删除」'],
  );
  assert.deepEqual(
    changelogBullets('预览：含真抓 BOSS 岗位库（#43）、侧栏与设置文案拍板（#44）、列表与抽取画像方案 B（#45）。稳定通道不受影响。'),
    ['含真抓 BOSS 岗位库、侧栏与设置文案拍板、列表与抽取画像', '稳定通道不受影响'],
  );
  assert.deepEqual(changelogBullets('预览：预览：重复（#9）'), ['重复']);
  assert.deepEqual(changelogBullets('**预览：**列表（#1）'), ['列表']);
  assert.deepEqual(changelogBullets('- 一项\n- 二项（#2）'), ['一项', '二项']);
  assert.deepEqual(changelogBullets('**更新**机制的 [说明](https://example.com) `代码`'), ['更新机制的 说明 代码']);
  assert.deepEqual(changelogBullets(''), []);
  assert.deepEqual(changelogBullets('预览：'), []);
  const iso = '2026-11-04T09:02:58Z';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.equal(formatChangelogWhen(iso), expected);
  assert.match(formatChangelogWhen(iso), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatChangelogWhen(''), '');
  assert.equal(formatChangelogWhen('nope'), '');
});
test('更新日志按 Release 的三个二级标题分区，旧正文不塞进新增', () => {
  const empty = { added: [], ui: [], fixed: [] };
  assert.deepEqual(changelogSections(''), empty);
  assert.deepEqual(changelogSections('简化更新流程：首次点「立即更新」时直接弹出文件夹选择窗口。'), empty);
  assert.deepEqual(changelogSections('本版暂无整理好的更新说明'), empty);
  assert.deepEqual(changelogSections('## 新增功能\n不该算新增'), empty);
  assert.deepEqual(changelogSections('### 新增\n三级标题不算'), empty);
  assert.deepEqual(changelogSections('##新增\n没有空格不算'), empty);
  assert.deepEqual(
    changelogSections('前言不归类\n## 其他\n也不归类\n## 新增\n\n'),
    empty,
  );
  assert.deepEqual(
    changelogSections('## 新增\n智能分析支持按当前画像补充跑分析（#64）'),
    { added: ['智能分析支持按当前画像补充跑分析'], ui: [], fixed: [] },
  );
  assert.deepEqual(
    changelogSections('## 新增\n第一句。第二句仍是同一条\n- 列表项（#2）\n· 圆点项\n* 星号项'),
    { added: ['第一句。第二句仍是同一条', '列表项', '圆点项', '星号项'], ui: [], fixed: [] },
  );
  assert.deepEqual(
    changelogSections([
      '## UI 优化',
      '列表警示区改为摘要两行，悬停可展开条目',
      '删除确认改为再次点击确认删除',
      '',
      '## 缺陷修复',
      '修复列表删除与「不喜欢」交界处的界面抖动',
    ].join('\n')),
    {
      added: [],
      ui: ['列表警示区改为摘要两行，悬停可展开条目', '删除确认改为再次点击确认删除'],
      fixed: ['修复列表删除与「不喜欢」交界处的界面抖动'],
    },
  );
  assert.deepEqual(
    changelogSections('## 缺陷修复\n先写的修复\n## 新增\n后写的新增\n## UI 优化\n- 方案 A 的间距'),
    { added: ['后写的新增'], ui: ['的间距'], fixed: ['先写的修复'] },
  );
  assert.deepEqual(
    changelogSections('## 新增\n可见\n```\n## UI 优化\n代码块里的标题\n```\n仍算新增'),
    { added: ['可见', '仍算新增'], ui: [], fixed: [] },
  );
  const listed = changelogEntries([
    release({
      tag_name: 'v1.0.3.6', name: 'v1.0.3.6', prerelease: true,
      published_at: '2026-11-04T06:16:10Z',
      body: '## UI 优化\n列表更清晰\n',
    }),
  ], 'preview');
  assert.deepEqual(listed[0]!.sections, { added: [], ui: ['列表更清晰'], fixed: [] });
  assert.deepEqual(listed[0]!.sections!.added, []);
  assert.equal(isCurrentChangelogVersion('1.0.3.9', '1.0.3.9'), true);
  assert.equal(isCurrentChangelogVersion('v1.0.3.9', '1.0.3.9'), true);
  assert.equal(isCurrentChangelogVersion('1.0.3.8', '1.0.3.9'), false);
  assert.equal(isCurrentChangelogVersion('1.0.3.9', ''), false);
});
await testAsync('manifest key 计算出固定扩展 ID', async () => {
  assert.equal(await extensionIdFromKey(selfManifest.key), SELF_ID);
});
await testAsync('安装包 manifest 校验', async () => {
  const ok = { ...selfManifest, version: '99.0.0' };
  assert.equal(await packageManifestError(ok, selfManifest, SELF_ID), '');
  assert.match(await packageManifestError({ ...ok, key: undefined }, selfManifest, SELF_ID), /key/);
  assert.match(await packageManifestError(ok, selfManifest, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), /ID/);
  assert.match(await packageManifestError({ ...ok, version: selfManifest.version }, selfManifest, SELF_ID), /不比当前版本新/);
  assert.match(await packageManifestError({ ...ok, name: '别的扩展' }, selfManifest, SELF_ID), /名称/);
  assert.match(await packageManifestError({ ...ok, manifest_version: 2 }, selfManifest, SELF_ID), /MV3/);
  assert.ok(await packageManifestError(null, selfManifest, SELF_ID));
});
test('isSameInstall 比对名称、版本、key', () => {
  assert.ok(isSameInstall({ ...selfManifest }, selfManifest));
  assert.ok(!isSameInstall({ ...selfManifest, version: '0.0.1' }, selfManifest));
  assert.ok(!isSameInstall({ ...selfManifest, key: 'x' }, selfManifest));
  assert.ok(!isSameInstall(null, selfManifest));
});
test('zip 路径安全检查', () => {
  assert.deepEqual(safeEntryPath('assets/a.js'), ['assets', 'a.js']);
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'C:x', 'dir/', '', 'a//b', '__MACOSX/a', 'a/.DS_Store']) {
    assert.equal(safeEntryPath(bad), null, bad);
  }
});
test('解压守卫拦截过大或过多条目', () => {
  const big = unzipGuard();
  assert.ok(big({ originalSize: 1024 }));
  assert.throws(() => big({ originalSize: 300 * 1024 * 1024 }), /过大/);
  const many = unzipGuard();
  assert.throws(() => { for (let i = 0; i < 3000; i++) many({ originalSize: 1 }); }, /数量/);
  assert.equal(toHex(new Uint8Array([0, 15, 255])), '000fff');
});
test('清理旧构建产物：只删 assets/ 下不在新包里的哈希文件', () => {
  const existing = [
    'assets/options-8FXsuZlm.js',
    'assets/styles-B3AvHOdf.css',
    'assets/options.js',
    'assets/logo-12345678.png',
    'icons/16.png',
    'manifest.json',
  ];
  const next = ['assets/options.js', 'assets/styles.css', 'manifest.json'];
  assert.deepEqual(staleAssets(existing, next), ['assets/options-8FXsuZlm.js', 'assets/styles-B3AvHOdf.css']);
  assert.deepEqual(staleAssets(existing, existing), []);
  assert.deepEqual(staleAssets([], next), []);
});

test('写入顺序：manifest.json 最后，跳过不安全路径', () => {
  const plan = planWrites({ 'manifest.json': 1, 'a.js': 2, '../evil': 3, 'icons/i.png': 4 });
  assert.deepEqual(plan.map((w) => w.path), ['a.js', 'icons/i.png', 'manifest.json']);
  assert.throws(() => planWrites({ 'sub/manifest.json': 1 }));
});

// ---------- 页面角标 ----------
// 在 vm 里用最小桩跑 collector.ts（内容脚本不打包，无法直接 import）。
