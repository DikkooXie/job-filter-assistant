// 侧栏：岗位库、列表、详情与批量分析

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { emptyProfile } from '../../src/common/profile.js';
import { pickActiveProvider, profileFingerprint, withProfileFp } from '../../src/common/profileFingerprint.js';
import {
  analysisEmptyMessage, analysisGrade, analysisSummary, analysisTargets, analysisUsesForce, exclusionReasons, filterVisibleJobs, flowEntryLabel, flowStatusLabel, FRESH_CAPSULE_MS, FRESH_MARK_VISIBLE_MS, librarySurface, noteCapturedJobs, returnFocusTarget, riskLines, shouldReturnToListAfterDelete, warningZone,
} from '../../src/pages/sidepanel/browseModel.js';
import { BOSS_BROWSE_URL, jobsForLibrary } from '../../src/pages/sidepanel/librarySource.js';
import {
  QUEUE_PREVIEW, SUCCESS_HOLD_MS, batchCounts, cancelRemaining, cardCopy, drawerModel, emptyBatch, enqueueBatch, estimateMinutes, finishPhase, retryFailed, settle as settleItem, stripModel, takeNext, visibleSections,
} from '../../src/pages/sidepanel/batchQueue.js';
import { test, section, ROOT } from './harness.js';
import type { AIProvider, FilterResult, Job, Match, Profile } from '../../src/common/types.js';
import type { Batch } from '../../src/pages/sidepanel/batchQueue.js';

// Fixtures intentionally omit fields that are unrelated to the behavior under test.
type JobFixture = Omit<Partial<Job>, 'match' | '_filter'> & {
  match?: Partial<Match> | null;
  _filter?: Partial<FilterResult>;
};
function jobFixture(job: JobFixture): Job {
  return job as unknown as Job;
}
function jobFixtures(jobs: JobFixture[]): Job[] {
  return jobs as unknown as Job[];
}
function providerFixtures(providers: Partial<AIProvider>[]): AIProvider[] {
  return providers as unknown as AIProvider[];
}

section('侧栏岗位库');
test('岗位列表把读取失败、空库和加载分开', () => {
  assert.equal(librarySurface({ loading: true, loadError: '失败', jobCount: 0 }), 'loading');
  assert.equal(librarySurface({ loading: false, loadError: '本地数据暂时无法读取', jobCount: 0 }), 'error');
  assert.equal(librarySurface({ loading: false, loadError: '', jobCount: 0 }), 'empty');
  assert.equal(librarySurface({ loading: false, loadError: null, jobCount: 4 }), 'ready');
});

test('返回列表时焦点落在刚看过的岗位，岗位没了就回到仍在的第一条', () => {
  assert.deepEqual(returnFocusTarget(['a', 'b', 'c'], 'b'), { kind: 'job', uid: 'b' });
  assert.deepEqual(returnFocusTarget(['a', 'b'], 'missing'), { kind: 'job', uid: 'a' });
  assert.deepEqual(returnFocusTarget([], 'missing'), { kind: 'search' });
});

test('详情删除成功后回到列表，列表不再包含该岗位', () => {
  const jobs = [{ uid: 'a', title: '甲' }, { uid: 'b', title: '乙' }];
  const next = jobs.filter((job) => job.uid !== 'a');
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'a', deletedUid: 'a', jobs: next,
  }), true);
  assert.deepEqual(next.map((job) => job.uid), ['b']);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'a', deletedUid: 'a', jobs,
  }), false);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'list', selectedUid: null, deletedUid: 'b', jobs: jobs.filter((job) => job.uid !== 'b'),
  }), false);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'b', deletedUid: 'a', jobs: next,
  }), false);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'a', deletedUid: 'a', screenNow: 'list', selectedUidNow: 'a', jobs: next,
  }), false);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'a', deletedUid: 'a', screenNow: 'detail', selectedUidNow: 'b', jobs: next,
  }), false);
  assert.equal(shouldReturnToListAfterDelete({
    screen: 'detail', selectedUid: 'a', deletedUid: 'a', screenNow: 'detail', selectedUidNow: null, jobs: next,
  }), true);
});

test('流程文案只读取已有进度，不发明新状态', () => {
  assert.equal(flowStatusLabel(undefined), '待打招呼');
  assert.equal(flowStatusLabel('prepared'), '招呼语已准备');
  assert.equal(flowStatusLabel('opened'), '待确认发送');
  assert.equal(flowStatusLabel('sent'), '已发送（手动确认）');
  assert.equal(flowEntryLabel(undefined), '打招呼');
  assert.equal(flowEntryLabel('prepared'), '继续流程');
  assert.equal(flowEntryLabel('opened'), '确认发送');
  assert.equal(flowEntryLabel('sent'), '查看流程');
});

test('搜索无结果不改变失败态；风险和排除原因分开', () => {
  const jobs = jobFixtures([
    { uid: '1', title: '前端开发工程师', company: '青禾科技', city: '深圳', skills: ['Vue'], match: { score: 92, verdict: 'strong', summary: '吻合' }, lastSeenAt: '2026-11-01' },
    { uid: '2', title: '后端开发', company: '松果云', city: '杭州', skills: ['Node'], match: null, lastSeenAt: '2026-11-02' },
  ]);
  assert.equal(filterVisibleJobs(jobs, { search: '不存在的词', platform: 'all', verdict: 'all', sort: 'recent' }).length, 0);
  assert.equal(librarySurface({ loading: false, loadError: '读取失败', jobCount: jobs.length }), 'error');
  const risky = jobFixture({ _filter: { keep: true, risks: ['驻场'], reasons: [] }, match: { risks: ['要求独立交付，沟通时确认是否接受应届生'] } });
  assert.deepEqual(riskLines(risky), ['含「驻场」，沟通时确认相关安排', '要求独立交付，沟通时确认是否接受应届生']);
  assert.deepEqual(exclusionReasons(jobFixture({ _filter: { keep: false, reasons: ['命中排除词：外包'] } })), ['命中排除词：外包']);
  assert.deepEqual(exclusionReasons(jobFixture({ _filter: { keep: true, reasons: ['经验档位不在偏好内'] } })), []);
});

test('列表警示区：过滤命中只露红 chip，普通警示才计数，没有条目就不出现', () => {
  assert.equal(warningZone(jobFixture({})), null);
  assert.equal(warningZone(jobFixture({ match: { summary: '只有摘要', risks: [] }, _filter: { keep: true, risks: [], reasons: ['经验档位不在偏好内'] } })), null);
  const warnOnly = jobFixture({ _filter: { keep: true, risks: ['销售', '驻场'], reasons: [] }, match: { risks: ['学历要求硕士，高于当前画像'] } });
  assert.deepEqual(warningZone(warnOnly), {
    chip: 'warn',
    label: '含 3 项警示',
    items: [
      { kind: 'warn', text: '含「销售」，沟通时确认相关安排' },
      { kind: 'warn', text: '含「驻场」，沟通时确认相关安排' },
      { kind: 'warn', text: '学历要求硕士，高于当前画像' },
    ],
  });
  const both = jobFixture({
    _filter: { keep: false, risks: ['驻场'], reasons: ['命中排除词：驻场'] },
    match: { risks: ['学历要求硕士，高于当前画像'] },
  });
  const zone = warningZone(both)!;
  assert.equal(zone.chip, 'filter');
  assert.equal(zone.label, '命中过滤条件');
  assert.deepEqual(zone.items.map((item) => item.kind), ['filter', 'warn', 'warn']);
  assert.equal(zone.items[0]!.text, '命中排除词：驻场');
  assert.equal(warningZone(jobFixture({ _filter: { keep: false, risks: [], reasons: ['城市不匹配'] } }))!.label, '命中过滤条件');
});

test('列表卡片把警示区放进分析框，摘要两行省略，操作行结构仍在', () => {
  const root = ROOT;
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const rowStart = views.indexOf('export function JobRow');
  const rowEnd = views.indexOf('export function ListFooter');
  const row = views.slice(rowStart, rowEnd);
  const zone = views.slice(views.indexOf('function AnalysisWarnings'), rowStart);
  const analysis = row.indexOf('className={`analysis');
  const call = row.indexOf('<AnalysisWarnings job={job} />');
  const actions = row.indexOf('className="row-actions"');
  assert.ok(analysis >= 0 && call > analysis && actions > call);
  assert.match(zone, /warn-chips/);
  assert.match(zone, /warn-list/);
  assert.match(zone, /warn-item/);
  assert.doesNotMatch(row, /className="risk"|className="exclusion"/);
  assert.match(row, /className="act-icon del"/);
  assert.match(row, /className="act-icon dislike"/);
  assert.match(row, /className=\{`act-greet/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /--jp-summary:\s*#c9d1d9/);
  assert.match(css, /\.job-row:hover \.warn-list/);
  assert.match(css, /\.analysis:hover \.warn-list/);
  assert.match(css, /\.job-row:hover \.row-actions/);
  const actionCss = css.slice(css.indexOf('.row-actions {'), css.indexOf('.risk, .exclusion'));
  assert.match(actionCss, /grid-template-rows: 0fr/);
  assert.doesNotMatch(actionCss, /warn-chip|warn-list|line-clamp/);
});

test('岗位库只采用已收录列表，空结果不补演示岗位', () => {
  assert.equal(BOSS_BROWSE_URL, 'https://www.zhipin.com/web/geek/jobs');
  assert.throws(() => jobsForLibrary(null), /岗位库数据无效/);
  assert.throws(() => jobsForLibrary({ jobs: [] }), /岗位库数据无效/);
  assert.deepEqual(jobsForLibrary([]), []);
  assert.deepEqual(jobsForLibrary([null, { title: '没有标识' }]), []);
  const captured = [{ uid: 'boss:encrypt-1', platform: 'boss', title: '前端开发', company: '真实公司', lastSeenAt: '2026-11-04T00:00:00.000Z' }];
  assert.deepEqual(jobsForLibrary(captured), captured);
  const visible = filterVisibleJobs(jobsForLibrary(captured), { search: '前端', platform: 'boss', verdict: 'all', sort: 'recent' });
  assert.deepEqual(visible.map((job) => job.uid), ['boss:encrypt-1']);
  assert.deepEqual(filterVisibleJobs(jobsForLibrary([]), { search: '', platform: 'all', verdict: 'all', sort: 'recent' }), []);
  assert.equal(librarySurface({ loading: false, loadError: '', jobCount: jobsForLibrary([]).length }), 'empty');
});

test('正式侧栏读取岗位库，不引用预览演示数据', () => {
  const root = ROOT;
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'extension-pages/sidepanel.tsx'), 'utf8');
  const previewEntry = fs.readFileSync(path.join(root, 'extension-pages/sidepanel-browse-preview.tsx'), 'utf8');
  const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(sidepanel, /JOB_LIST_REQUEST/);
  assert.match(sidepanel, /jobsForLibrary/);
  assert.match(sidepanel, /onBrowseBoss=\{openBossBrowse\}/);
  assert.match(views, /去 BOSS 直聘浏览/);
  assert.match(views, /看到的岗位会自动收录到这里/);
  assert.doesNotMatch(sidepanel, /browse-preview-chrome|青禾科技|boss:s1|example\.invalid/);
  assert.doesNotMatch(entry, /browse-preview-chrome/);
  assert.match(previewEntry, /browse-preview-chrome/);
  assert.doesNotMatch(vite, /sidepanel-browse-preview/);
});

test('新收录只记会话基线之后出现的岗位 id', () => {
  const first = noteCapturedJobs({ ready: false, seen: [], fresh: [] }, [{ uid: 'a' }, { uid: 'b' }, { uid: 'b' }]);
  assert.equal(first.ready, true);
  assert.deepEqual(first.arrived, []);
  assert.deepEqual([...first.fresh], []);
  assert.deepEqual([...first.seen], ['a', 'b']);
  const next = noteCapturedJobs(first, [{ uid: 'b' }, { uid: 'a' }, { uid: 'c' }]);
  assert.deepEqual(next.arrived, ['c']);
  assert.deepEqual([...next.fresh], ['c']);
  const again = noteCapturedJobs(next, [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }]);
  assert.deepEqual(again.arrived, []);
  assert.deepEqual([...again.fresh], ['c']);
  const removed = noteCapturedJobs(again, [{ uid: 'a' }]);
  assert.deepEqual([...removed.fresh], []);
  const fromEmpty = noteCapturedJobs({ ready: true, seen: new Set(), fresh: new Set() }, jobFixtures([{ uid: 'n' }, { title: '无标识' }]));
  assert.deepEqual(fromEmpty.arrived, ['n']);
  assert.equal(FRESH_CAPSULE_MS, 8000);
  assert.equal(FRESH_MARK_VISIBLE_MS, 2000);
});

test('智能分析只把未分析岗位交给默认项，强制项覆盖已选', () => {
  const jd = '岗位职责：已有正文';
  const jobs = jobFixtures([
    { uid: 'a', description: jd, match: { score: 90 } },
    { uid: 'b', match: null },
    { uid: 'c' },
    { uid: 'empty', description: '', match: { score: 88, verdict: 'strong' } },
    { title: '没有标识' },
  ]);
  assert.deepEqual(analysisTargets(jobs, 'unscored').map((job) => job.uid), ['b', 'c', 'empty']);
  assert.deepEqual(analysisTargets(jobs, 'force').map((job) => job.uid), ['a', 'b', 'c', 'empty']);
  assert.deepEqual(analysisTargets(jobs, 'fingerprint', 'fp-now').map((job) => job.uid), ['a', 'b', 'c', 'empty']);
  assert.deepEqual(analysisTargets(null, 'force'), []);
  assert.equal(analysisUsesForce('unscored'), false);
  assert.equal(analysisUsesForce('force'), true);
  assert.equal(analysisUsesForce('fingerprint'), true);
  assert.equal(analysisEmptyMessage('unscored', 2), '所选岗位都已有分析结果');
  assert.equal(analysisEmptyMessage('fingerprint', 2), '所选岗位都已在当前画像下分析过');
  assert.equal(analysisEmptyMessage('fingerprint', 0), '未选择岗位');
  assert.equal(analysisEmptyMessage('force', 0), '未选择岗位');
});

test('画像指纹变化后，旧匹配结果进入当前画像下未分析', () => {
  const profile = emptyProfile();
  const provider = { id: 'p1', model: 'demo-model' };
  const fp = profileFingerprint(profile, provider);
  assert.equal(fp, legacyProfileFingerprint(profile, provider));
  assert.equal(profileFingerprint(profile, provider), fp);
  assert.equal(profileFingerprint({ ...profile, updatedAt: '1999-01-01T00:00:00.000Z', schemaVersion: 9 }, provider), fp);
  const renamed = profileFingerprint(profile, { ...provider, model: 'other-model' });
  const moved = profileFingerprint({
    ...profile,
    target: { ...profile.target, cities: ['上海'] },
  }, provider);
  const noted = profileFingerprint({
    ...profile,
    preference: { ...profile.preference, notes: '可以接受混合办公' },
  }, provider);
  assert.notEqual(renamed, fp);
  assert.notEqual(moved, fp);
  assert.notEqual(noted, fp);
  const renamedBasics = profileFingerprint({
    ...profile,
    basics: { ...profile.basics, name: '不应外发的名字' },
  }, provider);
  assert.notEqual(renamedBasics, fp);
  assert.equal(renamedBasics, legacyProfileFingerprint({
    ...profile,
    basics: { ...profile.basics, name: '不应外发的名字' },
  }, provider));

  const current = withProfileFp<Match>({ score: 80, summary: '当前画像' }, fp);
  assert.equal(current.profileFp, fp);
  assert.equal(withProfileFp({ score: 1 }, fp).score, 1);
  const untouched: Match = { score: 3 };
  withProfileFp(untouched, fp);
  assert.equal(untouched.profileFp, undefined);

  const jd = '岗位职责：已有正文';
  const jobs = jobFixtures([
    { uid: 'fresh', description: jd, match: null },
    { uid: 'legacy', description: jd, match: { score: 70 } },
    { uid: 'blank', description: jd, match: { score: 50, profileFp: '' } },
    { uid: 'current', description: jd, match: current },
    { uid: 'stale', description: jd, match: withProfileFp({ score: 40 }, moved) },
    { title: '没有标识', description: jd, match: { profileFp: 'nope' } },
  ]);
  assert.deepEqual(analysisTargets(jobs, 'fingerprint', fp).map((job) => job.uid), ['fresh', 'legacy', 'blank', 'stale']);
  assert.deepEqual(analysisTargets(jobFixtures([{ uid: 'current', description: jd, match: current }]), 'fingerprint', fp), []);
  assert.deepEqual(analysisTargets(jobs, 'fingerprint', moved).map((job) => job.uid), ['fresh', 'legacy', 'blank', 'current']);
  assert.equal(pickActiveProvider(providerFixtures([{ id: 'a', model: 'm1' }, { id: 'b', model: 'm2' }]), 'b')!.model, 'm2');
  assert.equal(pickActiveProvider(providerFixtures([{ id: 'a', model: 'm1' }]), 'missing')!.id, 'a');
  assert.equal(pickActiveProvider([], 'a'), null);
  assert.equal(profileFingerprint(profile, pickActiveProvider(providerFixtures([{ id: 'a', model: 'demo-model' }]), '')), fp);
});

function legacyProfileFingerprint(profile: Profile, provider: Pick<AIProvider, 'model'>) {
  const serialized = JSON.stringify({
    t: profile.target,
    c: profile.capabilities,
    b: profile.basics,
    w: profile.workSummary,
    pj: profile.projectSummary,
    h: profile.highlights,
    pr: profile.preference,
    m: provider.model,
  });
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) hash = (hash * 31 + serialized.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

test('侧栏底栏改为工作台入口和智能分析', () => {
  const root = ROOT;
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  assert.match(views, /进入工作台/);
  assert.match(views, /智能分析/);
  assert.match(views, /只分析尚未分析的/);
  assert.match(views, /全部重新分析/);
  assert.match(views, /只分析当前画像下未分析的/);
  assert.match(views, /跳过已在当前画像下分析过的岗位；画像变化后的旧结果会重新分析/);
  assert.match(views, /tag-recommend/);
  assert.doesNotMatch(views, /本轮不可选|tag:\s*'后续'|disabled:\s*true/);
  assert.match(views, /后续同类可不提示/);
  assert.match(views, /找到 \$\{freshCount\} 个新岗位/);
  assert.match(views, /job-new/);
  assert.match(sidepanel, /OPEN_OPTIONS/);
  assert.match(sidepanel, /analysisUsesForce\(mode\)/);
  assert.match(sidepanel, /analysisTargets\(checked, mode, fingerprint\)/);
  assert.match(sidepanel, /analysisEmptyMessage\(mode, checked\.length\)/);
  const background = fs.readFileSync(path.join(root, 'src/background/background.ts'), 'utf8');
  assert.match(background, /from '\.\.\/common\/profileFingerprint\.js'/);
  assert.match(background, /withProfileFp\(cache\[cacheKey\], fp\)/);
  assert.match(background, /withProfileFp\(sanitizeMatch\(raw\), fp\)/);
  assert.doesNotMatch(background, /function profileFingerprint/);
  assert.match(sidepanel, /JOB_DELETE/);
  assert.doesNotMatch(views, /准备未处理岗位|处理下一个|当前可见|批量分析/);
  assert.doesNotMatch(views, />导出已选</);
  assert.doesNotMatch(views, /导出 \{total\} 项/);
  assert.doesNotMatch(sidepanel, /准备未处理岗位|处理下一个|onExportVisible|onClearLibrary|recordPrepared/);
});

test('列表方案 B 用卡片间距，分析区不再画顶部分割线', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  assert.match(browse, /\.continuous-list\s*\{[^}]*gap:\s*10px/);
  assert.match(browse, /\.analysis\s*\{[^}]*background:\s*var\(--jp-inset\)/);
  assert.match(browse, /\.analysis\s*\{[^}]*border:\s*0/);
  assert.doesNotMatch(browse, /\.analysis\s*\{[^}]*border-top/);
  assert.doesNotMatch(browse, /\.job-row\s*\{[^}]*border-bottom/);
  assert.match(views, /className=\{`analysis/);
  assert.doesNotMatch(views, /flow-link/);
});

test('列表分级按分数分五档，未分析没有格子', () => {
  assert.equal(analysisGrade(null), null);
  assert.equal(analysisGrade({} as unknown as Match), null);
  assert.equal(analysisGrade({ verdict: 'good' } as unknown as Match), null);
  assert.equal(analysisGrade({ score: '无' } as unknown as Match), null);
  assert.deepEqual(analysisGrade({ score: -4 }), { score: 0, filled: 1, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 20 }), { score: 20, filled: 1, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 21 }), { score: 21, filled: 2, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 40 }), { score: 40, filled: 2, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 60 }), { score: 60, filled: 3, tone: 'mid', label: '一般' });
  assert.deepEqual(analysisGrade({ score: 62 }), { score: 62, filled: 4, tone: 'mid', label: '沟通确认' });
  assert.deepEqual(analysisGrade({ score: 80 }), { score: 80, filled: 4, tone: 'mid', label: '沟通确认' });
  assert.deepEqual(analysisGrade({ score: 80.6 }), { score: 81, filled: 5, tone: 'high', label: '匹配' });
  assert.deepEqual(analysisGrade({ score: 86 }), { score: 86, filled: 5, tone: 'high', label: '匹配' });
  assert.deepEqual(analysisGrade({ score: '62' } as unknown as Match), { score: 62, filled: 4, tone: 'mid', label: '沟通确认' });
});

test('岗位摘要不造假分，有分析时才给警示计数', () => {
  assert.deepEqual(analysisSummary(null), { grade: null, summary: '', warnLabel: '' });
  assert.deepEqual(analysisSummary(jobFixture({ match: null, _filter: { risks: ['驻场'] } })), { grade: null, summary: '', warnLabel: '' });
  const graded = analysisSummary(jobFixture({
    description: '岗位职责：已有正文',
    match: { score: 42, summary: '有工具经验，城市不足。', risks: ['城市不在目标范围'] },
    _filter: { risks: ['驻场'] },
  }));
  assert.equal(graded.grade!.label, '一般');
  assert.equal(graded.grade!.filled, 3);
  assert.equal(graded.summary, '有工具经验，城市不足。');
  assert.equal(graded.warnLabel, '含 2 项警示');
  assert.equal(analysisSummary(jobFixture({ match: { score: 90, summary: '契合', risks: [] } })).warnLabel, '');
});

test('详情分析 Tab 回吃匹配块，岗位不再挂警示墙', () => {
  const root = ROOT;
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  assert.match(views, /\['match', '分析'\]/);
  assert.doesNotMatch(views, /\['match', '匹配'\]/);
  const infoStart = views.indexOf("sub === 'info'");
  const matchStart = views.indexOf("sub === 'match'");
  const info = views.slice(infoStart, matchStart);
  assert.match(info, /JobSummaryCard/);
  assert.match(views, /查看完整分析/);
  assert.doesNotMatch(info, /可以接受/);
  assert.doesNotMatch(info, /riskLines\(job\)\.map/);
  const analysis = views.slice(matchStart, views.indexOf("sub === 'company'"));
  assert.match(analysis, /AnalysisBody/);
  assert.match(views, /契合点/);
  assert.match(views, /差距 \/ 需补齐/);
  assert.match(views, /风险提示/);
  assert.match(views, /可以接受/);
  assert.match(views, /重新分析/);
  assert.match(views, /尚未分析/);
  assert.match(views, /打开原岗位/);
  const link = browse.match(/\.job-panel \.tune-link \{[^}]*\}/)?.[0] || '';
  assert.match(link, /background:\s*transparent/);
  assert.match(link, /color:\s*var\(--jp-accent\)/);
  assert.match(link, /max-width:\s*0/);
  assert.match(browse, /--jp-lift:\s*rgba\(255,\s*255,\s*255,\s*0\.04\)/);
  assert.match(browse, /\.detail-warn-row:hover,\s*\.detail-warn-row:focus-within\s*\{\s*background:\s*var\(--jp-lift\)/);
  assert.doesNotMatch(browse, /\.detail-warn-row:hover[^{]*\{[^}]*background:\s*(?:#(?:0[0-9a-f]{2,}|1c6b5e|2dd4bf)|var\(--jp-accent\))/);
});

test('列表项方案 E 把打招呼放在分析块外面，未分析只有文案', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const analysisStart = views.indexOf('className={`analysis');
  const actionsStart = views.indexOf('className="row-actions"', analysisStart);
  const analysis = views.slice(analysisStart, actionsStart);
  assert.ok(analysisStart > 0 && actionsStart > analysisStart);
  assert.match(analysis, /尚未分析/);
  assert.match(analysis, /score-num/);
  assert.match(analysis, /segs/);
  assert.doesNotMatch(analysis, /打招呼|flowEntryLabel|—/);
  assert.ok(analysis.indexOf('尚未分析') > analysis.indexOf('grade ?'));
  assert.match(views, /data-row-action="delete"/);
  assert.match(views, /data-row-action="dislike"/);
  assert.match(views, /data-row-action="greet"/);
  assert.match(views, /flowEntryLabel\(progressStatus\)/);
  assert.ok(views.indexOf('flowEntryLabel(progressStatus)') > actionsStart);
  assert.match(browse, /skewX\(-18deg\)/);
  assert.match(browse, /grid-template-rows:\s*0fr/);
  assert.match(browse, /180ms/);
  assert.match(browse, /200ms/);
  assert.match(browse, /#2dd4bf/);
  assert.match(browse, /Space Grotesk/);
  assert.match(browse, /tabular-nums/);
  assert.match(browse, /\.act-greet\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(sidepanel, /onDelete=\{\(\) => deleteJob\(/);
  assert.match(sidepanel, /onDislike=\{\(\) => dislikeJob\(/);
  assert.match(sidepanel, /JOB_DELETE/);
  assert.match(sidepanel, /确定删除\$\{noun\}/);
  assert.match(sidepanel, /onDelete=\{\(\) => job && deleteJob\(/);
  const footerStart = views.indexOf('export function ListFooter');
  const sheetStart = views.indexOf('export function AnalyzeSheet', footerStart);
  const footer = views.slice(footerStart, sheetStart);
  assert.ok(sheetStart > footerStart);
  assert.match(footer, /进入工作台/);
  assert.match(footer, /智能分析/);
  assert.doesNotMatch(footer, /准备未处理岗位|处理下一个/);
});

test('操作行悬停伸长不把宽度从固定值过渡到 auto', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const icon = browse.match(/\.job-panel \.act-icon \{[^}]*\}/)?.[0] || '';
  const hover = browse.match(/\.job-panel \.act-icon:hover,\s*\n\.job-panel \.act-icon:focus-visible \{[^}]*\}/)?.[0] || '';
  assert.match(icon, /min-width:\s*28px/);
  assert.match(icon, /max-width:\s*28px/);
  assert.match(icon, /flex:\s*0 0 auto/);
  const transition = icon.match(/transition:[^;]*;/)?.[0] || '';
  assert.doesNotMatch(transition, /(^|[,\s])width\s/);
  assert.doesNotMatch(transition, /flex-basis/);
  assert.match(hover, /max-width:\s*9em/);
  assert.match(hover, /padding:\s*0 10px/);
  assert.doesNotMatch(hover, /width:\s*auto/);
  assert.doesNotMatch(hover, /flex:\s*0 0 auto/);
  assert.doesNotMatch(hover, /flex-basis/);
});

test('智能分析抽屉按 4pt 终锁留白', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const sheet = browse.match(/\.analyze-sheet \{[^}]*\}/)?.[0] || '';
  assert.match(sheet, /padding:\s*12px 16px calc\(16px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.match(browse, /\.analyze-sheet \.sheet-handle \{[^}]*margin:\s*0 auto 12px/);
  assert.match(browse, /\.job-panel \.analyze-sub \{[^}]*margin-top:\s*8px/);
  assert.match(browse, /\.job-panel \.analyze-sub \{[^}]*margin-bottom:\s*16px/);
  assert.match(browse, /\.analyze-options \{[^}]*gap:\s*8px/);
  assert.match(browse, /\.analyze-actions \{[^}]*margin-top:\s*12px/);
  assert.match(browse, /\.analyze-actions \{[^}]*gap:\s*8px/);
  assert.match(browse, /\.sheet-content \{[^}]*padding:\s*8px 16px 22px/);
});

test('详情删除成功才回到列表，批量删除不改去向', () => {
  const root = ROOT;
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const deleteFn = sidepanel.slice(sidepanel.indexOf('async function deleteJob'), sidepanel.indexOf('function dislikeJob'));
  const deleteChecked = sidepanel.slice(sidepanel.indexOf('const deleteChecked'), sidepanel.indexOf('const startAnalysis'));
  const detailDelete = sidepanel.match(/onDelete=\{\(\) => job && deleteJob\([^}]*\)\}/)?.[0] || '';
  const listDelete = sidepanel.match(/onDelete=\{\(\) => deleteJob\(item[^}]*\)\}/)?.[0] || '';
  assert.match(deleteFn, /shouldReturnToListAfterDelete/);
  assert.match(deleteFn, /backToList\(\)/);
  assert.match(detailDelete, /backToList/);
  assert.doesNotMatch(listDelete, /backToList/);
  assert.match(deleteChecked, /askConfirm/);
  assert.match(deleteChecked, /JOB_DELETE/);
  assert.doesNotMatch(deleteChecked, /backToList|shouldReturnToListAfterDelete/);
});

test('详情操作行复用列表伸长确认，删除不再弹窗', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const barStart = views.indexOf('function DetailActionBar');
  const barEnd = views.indexOf('export function ListFooter');
  const bar = views.slice(barStart, barEnd);
  assert.ok(barStart > views.indexOf('function DeleteRowButton'));
  assert.ok(barEnd > barStart);
  assert.match(bar, /className=\{`actions-row/);
  assert.match(bar, /<DeleteRowButton/);
  assert.match(bar, /<DislikeRowButton/);
  assert.match(bar, /className=\{`act-icon fav/);
  assert.match(bar, /打开原岗位/);
  assert.match(bar, /arm\('delete'\)/);
  assert.match(bar, /<span className="lbl"/);
  assert.doesNotMatch(bar, /confirm\(|window\.confirm|role="dialog"|detail-act/);
  assert.match(views, /<DetailActionBar/);
  assert.doesNotMatch(views.slice(views.indexOf('export function JobDetail')), /detail-act|window\.confirm|confirm\(`确定删除/);
  assert.match(sidepanel, /onDelete=\{\(\) => job && deleteJob\(/);
  assert.doesNotMatch(sidepanel, /removeSelected|确定删除岗位「/);
  const collapse = browse.slice(browse.indexOf('.actions-row.is-confirm-delete .act-icon.dislike'), browse.indexOf('.risk, .exclusion'));
  assert.match(collapse, /\.act-icon\.fav/);
  assert.match(collapse, /\.detail-open/);
  assert.match(collapse, /pointer-events:\s*none/);
  assert.match(browse, /\.detail-sticky \.act-icon \{[^}]*max-width:\s*36px/);
  assert.match(browse, /\.job-panel \.act-icon:hover/);
});

test('删除确认态文案是再次点击确认删除', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  assert.match(views, /confirming === 'delete' \? '再次点击确认删除' : '删除'/);
  assert.match(views, /aria-label=\{confirming === 'delete' \? `再次点击确认删除 \$\{name\}`/);
  assert.doesNotMatch(views, /\? `确认删除 \$\{name\}`/);
  const confirmLbl = browse.match(/\.actions-row\.is-confirm-delete \.act-icon\.del \.lbl \{[^}]*\}/)?.[0] || '';
  assert.match(confirmLbl, /max-width:\s*200px/);
  assert.match(confirmLbl, /font-weight:\s*650/);
  assert.doesNotMatch(browse, /is-confirm-dislike/);
  assert.doesNotMatch(views, /arm\('dislike'\)/);
});

test('不喜欢直接打开自然语言底抽屉，写入雷点且不自动重跑', () => {
  const root = ROOT;
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const row = views.slice(views.indexOf('export function JobRow'), views.indexOf('export function ListFooter'));
  const sheet = views.slice(views.indexOf('export function DislikeSheet'), views.indexOf('function LibraryCount'));
  const save = sidepanel.slice(sidepanel.indexOf('async function saveDislike'));
  assert.match(row, /data-row-action="dislike"/);
  assert.match(row, /onClick=\{onDislike\}/);
  assert.match(row, /aria-label=\{`不喜欢 \$\{name\}`\}/);
  assert.doesNotMatch(row, /arm\('dislike'\)|确认不喜欢/);
  assert.match(sheet, /不喜欢的地方/);
  assert.match(sheet, /画像不全易误判。用一句话告诉我要避开什么，写入画像。/);
  assert.match(sheet, /避开/);
  assert.match(sheet, /写入画像/);
  assert.match(browse, /\.job-panel \.dislike-sheet \.dislike-context \{[^}]*margin-top:\s*12px/);
  assert.match(browse, /\.job-panel \.dislike-sheet textarea \{[^}]*margin-top:\s*14px/);
  assert.match(sheet, /placeholder="例如：太偏销售、不要驻场…"/);
  assert.match(sheet, /针对 · <strong>/);
  assert.match(sheet, />取消</);
  assert.match(sheet, />确认写入</);
  assert.doesNotMatch(sheet, /checkbox|type="checkbox"|权重|\+权重|雷点列表|重新分析/);
  assert.match(sidepanel, /<DislikeSheet/);
  assert.match(sidepanel, /onDislike=\{\(\) => dislikeJob\(/);
  assert.match(sidepanel, /onDislike=\{\(\) => job && dislikeJob\(/);
  assert.match(save, /appendDealbreaker/);
  assert.match(save, /PROFILE_SAVE/);
  assert.match(save, /已写入画像/);
  assert.doesNotMatch(save, /AI_MATCH|startAnalysis|重新分析|analyze\(/);
  const primary = browse.match(/\.job-panel \.dislike-sheet \.jp-btn-primary \{[^}]*\}/)?.[0] || '';
  assert.match(primary, /background:\s*#2dd4bf/);
  assert.match(primary, /color:\s*#0f1419/);
  assert.match(browse, /\.scrim\.dislike-scrim \{[^}]*rgba\(0,\s*0,\s*0,\s*\.55\)/);
  assert.match(browse, /\.sheet\.dislike-sheet \{[^}]*border-radius:\s*16px 16px 0 0/);
});

test('抽取画像方案 B 把底栏放进同一个圆角框', () => {
  const root = ROOT;
  const profile = fs.readFileSync(path.join(root, 'src/pages/options/profile.css'), 'utf8');
  const tab = fs.readFileSync(path.join(root, 'src/pages/options/ProfileTab.tsx'), 'utf8');
  assert.match(profile, /\.paste-box\s*\{[^}]*border-radius:\s*14px/);
  assert.match(profile, /\.paste-box \.area-input\s*\{[^}]*padding:\s*14px 14px 16px/);
  assert.match(profile, /\.paste-bar\s*\{/);
  assert.match(profile, /\.paste-submit\s*\{[^}]*background:\s*var\(--s-accent\)/);
  const pasteStart = tab.indexOf('className="paste-box"');
  const pasteEnd = tab.indexOf('dropzone', pasteStart);
  const paste = tab.slice(pasteStart, pasteEnd);
  assert.ok(pasteStart > 0 && pasteEnd > pasteStart);
  assert.ok(paste.includes('paste-bar'));
  assert.ok(paste.includes('{paste.length} 字'));
  assert.ok(paste.includes('清空'));
  assert.ok(paste.includes('抽取画像'));
  assert.ok(paste.indexOf('textarea') < paste.indexOf('paste-bar'));
  assert.ok(paste.indexOf('paste-bar') < paste.indexOf('抽取画像'));
});

test('批量进度细条不占主钮，队列只露前几条并区分自动', () => {
  const jobs = Array.from({ length: 80 }, (_, index) => ({ uid: `j${index + 1}`, title: `岗位${index + 1}` }));
  let batch = enqueueBatch(emptyBatch(), jobs, { source: 'manual' });
  assert.equal(batch.phase, 'running');
  assert.equal(batchCounts(batch).total, 80);
  assert.equal(enqueueBatch(batch, jobs.slice(0, 5), { source: 'manual' }), batch);
  for (let n = 1; n <= 11; n += 1) batch = settleItem(batch, `j${n}`, { ok: true });
  batch = settleItem(batch, 'j12', { ok: false, error: '超时' });
  batch = { ...batch, items: batch.items.map((item) => item.uid === 'j13' ? { ...item, status: 'running' } : item) };
  assert.equal(takeNext(batch)!.uid, 'j14');
  const strip = stripModel(batch);
  assert.equal(strip.visible, true);
  assert.equal(strip.tone, 'running');
  assert.equal(strip.auto, false);
  assert.equal(strip.label, '13/80 · 分析中');
  const drawer = drawerModel(batch);
  assert.equal(drawer.summary, '已完成 11 · 失败 1 · 排队 67');
  assert.equal(drawer.queuedPreview.length, QUEUE_PREVIEW);
  assert.equal(drawer.queuedHidden, 63);
  assert.ok(QUEUE_PREVIEW >= 3 && QUEUE_PREVIEW <= 5);
  assert.equal(estimateMinutes(67), 18);
  assert.equal(drawer.estimate, '约 18 分');
  assert.match(cardCopy(batch, 'j13')!.label, /正在匹配画像与 JD · 第 13\/80/);
  assert.equal(cardCopy(batch, 'j14')!.label, '排队中');
  assert.equal(cardCopy(batch, 'j12')!.hint, '可从队列重试');
  assert.equal(cardCopy(batch, 'j1'), null);
  const cancelled = cancelRemaining(batch);
  assert.equal(cancelled.items.some((item) => item.status === 'queued'), false);
  assert.equal(cancelled.items.some((item) => item.uid === 'j13' && item.status === 'running'), true);
  assert.equal(cancelled.items.some((item) => item.uid === 'j12' && item.status === 'failed'), true);
  const retried = retryFailed(finishPhase(settleItem(cancelled, 'j13', { ok: true })), 'j12');
  assert.equal(retried.phase, 'running');
  assert.equal(retried.items.at(-1)!.uid, 'j12');
  assert.equal(retried.items.at(-1)!.status, 'queued');
  const auto = enqueueBatch(emptyBatch(), [{ uid: 'a1', title: '品牌设计师' }], { source: 'auto' });
  const autoRunning: Batch = { ...auto, items: auto.items.map((item) => ({ ...item, status: 'running' })) };
  assert.equal(stripModel(autoRunning).auto, true);
  assert.equal(stripModel(autoRunning).label, '1/1 · 分析中');
  assert.match(cardCopy(autoRunning, 'a1')!.label, /^自动分析 · 正在匹配画像与 JD/);
  assert.equal(cardCopy({ ...auto, items: auto.items.map((item) => ({ ...item, status: 'queued' })) }, 'a1')!.label, '自动 · 排队中');
  const failedOnly = finishPhase(settleItem(autoRunning, 'a1', { ok: false, error: '超时' }));
  assert.equal(failedOnly.phase, 'failed');
  assert.equal(stripModel(failedOnly).label, '1 失败 · 0 完成');
  assert.equal(stripModel(failedOnly).tone, 'failed');
  const done = finishPhase(settleItem(autoRunning, 'a1', { ok: true }));
  assert.equal(done.phase, 'success');
  assert.equal(stripModel(done).label, '1 完成');
  assert.equal(visibleSections(batch, 'failed').running.length, 0);
  assert.equal(visibleSections(batch, 'failed').queuedHidden, 0);
  assert.equal(SUCCESS_HOLD_MS, 1600);

  const root = ROOT;
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const browse = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src/background/background.ts'), 'utf8');
  const queue = fs.readFileSync(path.join(root, 'src/pages/sidepanel/batchQueue.ts'), 'utf8');
  const footerStart = views.indexOf('export function ListFooter');
  const sheetStart = views.indexOf('export function AnalyzeSheet', footerStart);
  const footer = views.slice(footerStart, sheetStart);
  assert.match(footer, /智能分析/);
  assert.match(footer, /进入工作台/);
  assert.doesNotMatch(footer, /disabled=\{busy\}|分析中|队列|重试失败/);
  assert.match(views, /data-batch-strip/);
  assert.match(views, /data-queue-drawer="half"/);
  assert.match(views, /取消剩余/);
  assert.match(views, /重试失败/);
  assert.match(views, />自动</);
  assert.match(views, /还有 \{view\.queuedHidden\} 条/);
  assert.match(views, /queueCard\?\.hint/);
  assert.match(queue, /可从队列重试/);
  assert.match(queue, /正在匹配画像与 JD/);
  assert.match(queue, /自动分析 · /);
  assert.doesNotMatch(views, /批量分析/);
  assert.match(sidepanel, /批量结束 · \$\{done\} 完成/);
  assert.match(sidepanel, /enqueueBatch\(s\.batch, targets, \{ source: 'manual'/);
  assert.match(sidepanel, /acceptAuto\(autoQueue\)/);
  assert.doesNotMatch(sidepanel, /batchBusy/);
  assert.match(browse, /\.batch-strip\s*\{[^}]*background:\s*#151a21/);
  assert.match(browse, /\.batch-strip\s*\{[^}]*color:\s*#2dd4bf/);
  assert.match(browse, /\.batch-strip\.is-failed\s*\{[^}]*color:\s*#f0b429/);
  assert.match(browse, /\.queue-drawer\s*\{[^}]*height:\s*52%/);
  assert.match(browse, /\.queue-drawer\s*\{[^}]*max-height:\s*52%/);
  assert.match(browse, /\.queue-scroll\s*\{[^}]*overflow:\s*auto/);
  assert.match(browse, /\.queue-head\s*\{[^}]*padding:\s*0 14px;/);
  assert.doesNotMatch(browse.match(/\.queue-head\s*\{[^}]*\}/)?.[0] || '', /padding-bottom|8px/);
  assert.match(browse, /\.queue-bar\s*\{[^}]*margin-top:\s*12px/);
  assert.match(browse, /\.job-panel \.queue-summary\s*\{[^}]*margin-top:\s*12px/);
  assert.match(browse, /\.queue-chips\s*\{[^}]*margin-top:\s*16px/);
  assert.match(browse, /\.queue-chips\s*\{[^}]*margin-bottom:\s*12px/);
  assert.match(browse, /#1a222c/);
  assert.match(browse, /#0f1419/);
  assert.doesNotMatch(browse, /background:\s*#(?:0f0|00|16a34a|22c55e)[^;]*;\s*color:\s*#f0b429/);
  assert.match(background, /autoQueue: uids/);
  assert.match(background, /sidePanelIsOpen/);
  assert.match(background, /contextTypes: \['SIDE_PANEL'\]/);
});
