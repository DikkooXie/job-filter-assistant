// 纯逻辑单测：用真机逆向样本验证归一化/薪资/画像/筛选/AI 协议构造。
// 运行：node scripts/test_logic.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { defaultFilters, defaultSettings, STORAGE_KEYS } from '../src/common/constants.js';
import { isDevBuild, toDevManifest } from '../src/common/build.js';
import { loadSettings, mergeSettings, saveSettings } from '../src/common/settingsStore.js';
import { commitTags, filterSettingsPatch, mergeFilterPatch, parseSalaryMinK, removeLastTag } from '../src/react/settings/filterForm.js';
import { normalizeResponse, matchPlatformApi, parseSalary } from '../src/common/platforms.js';
import { emptyProfile, scoreProfile, sanitizeProfile, mergeDraft, getDealbreakers, updateDealbreakers } from '../src/common/profile.js';
import {
  MAX_PROFILE_IMPORT_BYTES, applyProfileDraft, assertFilesWithinLimit, combineMaterialExtracts, parseProfileJson, planJsonFile, planResumeFiles,
} from '../src/common/profileImport.js';
import { evaluateJob, applyFilters, autoScoreUids } from '../src/common/filters.js';
import {
  exclusionReasons, filterVisibleJobs, flowEntryLabel, flowStatusLabel, librarySurface, returnFocusTarget, riskLines,
} from '../src/react/sidepanel/browseModel.js';
import { BOSS_BROWSE_URL, jobsForLibrary } from '../src/react/sidepanel/librarySource.js';
import { sanitizeProvider, validateProvider, providerFromPreset, isProviderUsable, PRESETS, PROTOCOLS } from '../src/common/ai/providers.js';
import {
  formatConnectionResult, formatElapsed, formatModelsResult, initialSelectedId, parseExtraHeaders, providerHost, providerMeta, removeProviderState,
} from '../src/react/settings/aiState.js';
import { sanitizeMatch, scoreToVerdict, normalizeGreetings, normalizeDims, sanitizeTailor, buildMatchPrompt } from '../src/common/ai/prompts.js';
import { redactText } from '../src/common/ai/privacy.js';
import {
  parseVersion, compareVersions, parseRelease, extensionIdFromKey, packageManifestError, isSameInstall, safeEntryPath, planWrites, unzipGuard, toHex, staleAssets,
  RELEASE_API, RELEASES_API, NO_PREVIEW_MESSAGE, AHEAD_OF_STABLE_MESSAGE,
  normalizeUpdateChannel, releaseRequest, selectPreviewRelease, resolvePreviewCheck, assessUpdate,
} from '../src/common/update.js';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓', name);
  } catch (e) {
    fail++;
    console.log('  ✗', name, '\n      →', e.message);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ✓', name);
  } catch (e) {
    fail++;
    console.log('  ✗', name, '\n      →', e.message);
  }
}
function section(t) {
  console.log('\n' + t);
}

// 用随包携带的合成样本（结构仿真机逆向，但无任何真实/个人数据）跑归一化，
// 保证 clone 后 `node scripts/test_logic.mjs` 可直接运行。相对脚本自身解析，与 cwd 无关。
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

section('开发构建标识');
test('开发构建添加标识且不修改原 manifest，重复转换不叠加', () => {
  const original = { name: '助手', short_name: '助手', action: { default_title: '打开助手' }, key: 'example' };
  const dev = toDevManifest(original);
  assert.equal(dev.name, '助手 · dev');
  assert.equal(dev.short_name, '助手 dev');
  assert.equal(dev.action.default_title, '打开助手 · dev');
  assert.equal(dev.key, original.key);
  assert.equal(original.name, '助手');
  assert.equal(isDevBuild(original), false);
  assert.equal(isDevBuild(dev), true);
  assert.deepEqual(toDevManifest(dev), dev);
});

// ---------- URL 匹配 ----------
section('平台 URL 匹配');
test('BOSS joblist 命中', () => {
  const m = matchPlatformApi('https://www.zhipin.com/wapi/zpgeek/search/joblist.json?city=101280100');
  assert.equal(m.platform, 'boss');
});
test('51job search-pc 命中', () => {
  const m = matchPlatformApi('https://we.51job.com/api/job/search-pc?keyword=python');
  assert.equal(m.platform, 'qcwy');
});
test('无关 URL 不命中', () => {
  assert.equal(matchPlatformApi('https://www.baidu.com/s?wd=x'), null);
});

// ---------- 薪资解析 ----------
section('薪资解析（千元/月）');
const salaryCases = [
  ['1.1-1.8万·13薪', [11, 18]],
  ['10-13K·13薪', [10, 13]],
  ['5千-1万', [5, 10]],
  ['8-12k', [8, 12]],
  ['20K', [20, 20]],
  ['面议', [null, null]],
];
for (const [input, expect] of salaryCases) {
  test(`"${input}" -> ${JSON.stringify(expect)}`, () => {
    assert.deepEqual(parseSalary(input), expect);
  });
}

// ---------- BOSS 归一化（合成样本，结构仿真机） ----------
section('BOSS 列表归一化（boss_joblist.sample.json）');
const bossRaw = loadFixture('boss_joblist.sample.json');
const bossEnvelope = { code: 0, message: 'success', zpData: { jobList: bossRaw } };
const bossJobs = normalizeResponse('boss', bossEnvelope);
test('解析出全部 3 条', () => assert.equal(bossJobs.length, 3));
test('首条含关键字段', () => {
  const j = bossJobs[0];
  assert.equal(j.platform, 'boss');
  assert.ok(j.title, '有岗位名');
  assert.ok(j.company, '有公司名');
  assert.ok(j.uid.startsWith('boss:'), 'uid 前缀');
  assert.ok(j.raw.securityId, '保留 securityId 详情凭据');
  assert.ok(j.raw.encryptJobId, '保留 encryptJobId');
});
test('薪资解析到数值', () => {
  const withSalary = bossJobs.filter((j) => j.salaryMinK != null);
  assert.equal(withSalary.length, 3, `全部解析出薪资，实际 ${withSalary.length}`);
  assert.deepEqual([bossJobs[0].salaryMinK, bossJobs[0].salaryMaxK], [25, 40]);
});
test('uid 唯一', () => {
  const set = new Set(bossJobs.map((j) => j.uid));
  assert.equal(set.size, bossJobs.length);
});

// ---------- BOSS 详情接口归一化（当前岗位切换依赖它入库） ----------
section('BOSS 详情归一化（zpData.jobInfo 单条）');
const bossDetailEnvelope = {
  code: 0,
  message: 'Success',
  zpData: {
    jobInfo: {
      encryptId: 'abc123XYZ',
      jobName: '高级前端工程师',
      salaryDesc: '25-40K·14薪',
      locationName: '广州',
      experienceName: '3-5年',
      degreeName: '本科',
      showSkills: ['React', 'TypeScript', 'Node.js'],
      postDescription: '岗位职责：\n1. 负责前端架构\n2. 组件库建设',
    },
    brandComInfo: { brandName: '示例科技', industryName: '互联网', scaleName: '500-999人', stageName: 'C轮' },
    bossInfo: { name: '李经理', title: '技术总监' },
  },
};
const bossDetail = normalizeResponse('boss', bossDetailEnvelope);
test('详情解析出 1 条', () => assert.equal(bossDetail.length, 1));
test('详情字段映射正确', () => {
  const j = bossDetail[0];
  assert.equal(j.uid, 'boss:abc123XYZ');
  assert.equal(j.jobId, 'abc123XYZ');
  assert.equal(j.title, '高级前端工程师');
  assert.deepEqual([j.salaryMinK, j.salaryMaxK], [25, 40], '薪资 25-40K');
  assert.equal(j.city, '广州');
  assert.equal(j.degree, '本科');
  assert.deepEqual(j.skills, ['React', 'TypeScript', 'Node.js'], 'showSkills');
  assert.ok(j.description.includes('岗位职责'), '带 JD 正文');
  assert.equal(j.company, '示例科技');
  assert.equal(j.hrName, '李经理');
});
test('详情空字段被剔除（不覆盖列表已有数据）', () => {
  // 只给 jobInfo 最小字段：其余空字段不应出现在结果里
  const sparse = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { encryptId: 'x1', jobName: '测试岗' } },
  });
  assert.equal(sparse.length, 1);
  const j = sparse[0];
  assert.ok(!('company' in j), 'company 空 -> 应被剔除，避免 {...prev,...raw} 抹掉列表公司名');
  assert.ok(!('description' in j), 'description 空 -> 剔除');
  assert.ok(!('skills' in j), 'skills 空数组 -> 剔除');
  assert.equal(j.uid, 'boss:x1', 'uid 保留');
  assert.equal(j.jobId, 'x1', 'jobId 保留');
});
test('详情无 encryptId 返回空', () => {
  assert.equal(normalizeResponse('boss', { code: 0, zpData: { jobInfo: { jobName: '无ID' } } }).length, 0);
});
test('详情 uid 用 URL 的 encryptJobId（与当前岗位信号一致）', () => {
  // URL query 的 key 与响应体 encryptId 不同时，必须以 URL 为准，否则面板匹配不上
  const j = normalizeResponse(
    'boss',
    { code: 0, zpData: { jobInfo: { encryptId: 'BODY_KEY', jobName: 'X' } } },
    { url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=abc&encryptJobId=URL_KEY' },
  )[0];
  assert.equal(j.uid, 'boss:URL_KEY', 'uid 取自 URL 的 encryptJobId');
  assert.equal(j.jobId, 'URL_KEY');
});
test('详情无 URL 时回退响应体 encryptId', () => {
  const j = normalizeResponse('boss', { code: 0, zpData: { jobInfo: { encryptId: 'BODY_KEY', jobName: 'X' } } })[0];
  assert.equal(j.uid, 'boss:BODY_KEY');
});

// ---------- 51job 归一化（合成样本，结构仿真机） ----------
section('51job 归一化（qcwy_job.sample.json）');
const qcwySample = loadFixture('qcwy_job.sample.json');
const qcwyEnvelope = { status: '1', message: '成功', resultbody: { job: { items: [qcwySample], totalcount: 1 } } };
const qcwyJobs = normalizeResponse('qcwy', qcwyEnvelope);
test('解析出 1 条', () => assert.equal(qcwyJobs.length, 1));
test('字段映射正确', () => {
  const j = qcwyJobs[0];
  assert.equal(j.platform, 'qcwy');
  assert.equal(j.title, 'python开发工程师');
  assert.equal(j.jobId, '888800011');
  assert.ok(j.description.includes('岗位职责'), '带完整 JD 正文');
  assert.equal(j.city, '珠海');
  assert.deepEqual([j.salaryMinK, j.salaryMaxK], [11, 18], 'jobSalaryMin/Max 元->千元');
  assert.ok(j.company.includes('半导体'), '公司名');
  assert.ok(j.companyIndustry, '行业');
});
test('status 非 1 返回空', () => {
  assert.equal(normalizeResponse('qcwy', { status: '0' }).length, 0);
});
test('BOSS code 非 0 返回空', () => {
  assert.equal(normalizeResponse('boss', { code: 37, message: '风控' }).length, 0);
});

// ---------- 画像 ----------
section('个人画像');
test('空画像评分为 0', () => {
  assert.equal(scoreProfile(emptyProfile()).score, 0);
});
test('填充后评分上升', () => {
  const p = emptyProfile();
  p.target.jobTitles = ['前端工程师'];
  p.capabilities.skills = ['React', 'TypeScript'];
  const s = scoreProfile(p);
  assert.ok(s.score >= 30, `实际 ${s.score}`);
  assert.ok(s.completed >= 2);
});
test('sanitize 容忍逗号字符串数组', () => {
  const p = sanitizeProfile({ capabilities: { skills: 'React，Vue、Node' } });
  assert.deepEqual(p.capabilities.skills, ['React', 'Vue', 'Node']);
});
test('sanitize 拒绝非法薪资', () => {
  const p = sanitizeProfile({ target: { salaryMinK: -5, salaryMaxK: 'abc' } });
  assert.equal(p.target.salaryMinK, null);
  assert.equal(p.target.salaryMaxK, null);
});
test('mergeDraft 合并去重', () => {
  const cur = sanitizeProfile({ capabilities: { skills: ['React'] } });
  const draft = sanitizeProfile({ capabilities: { skills: ['react', 'Vue'] }, basics: { education: '本科' } });
  const merged = mergeDraft(cur, draft);
  assert.deepEqual(merged.capabilities.skills, ['React', 'Vue'], '大小写去重');
  assert.equal(merged.basics.education, '本科', '空字段填充');
});

test('未知年限保持未知，明确零年正确计入完整度', () => {
  for (const value of [null, undefined, '', '  ']) {
    const p = sanitizeProfile({ basics: { yearsOfExperience: value } });
    assert.equal(p.basics.yearsOfExperience, null);
    assert.ok(scoreProfile(p).missing.includes('工作年限'));
  }
  const zero = sanitizeProfile({ basics: { yearsOfExperience: 0 } });
  assert.equal(zero.basics.yearsOfExperience, 0);
  assert.ok(!scoreProfile(zero).missing.includes('工作年限'));
  assert.equal(mergeDraft(emptyProfile(), { basics: { yearsOfExperience: 2 } }).basics.yearsOfExperience, 2);
});
test('画像合并保留已有偏好与非空字段', () => {
  const result = mergeDraft({ basics: { education: '本科' }, preference: { notes: '已有说明', dealbreakers: ['出差'] } },
    { basics: { education: '硕士' }, preference: { notes: '新说明', dealbreakers: ['夜班'] } });
  assert.equal(result.basics.education, '本科');
  assert.equal(result.preference.notes, '已有说明');
  assert.deepEqual(result.preference.dealbreakers, ['出差', '夜班']);
});
test('超过 10 MB 的文件拒绝导入，并写明文件名和大小', () => {
  const limit = MAX_PROFILE_IMPORT_BYTES;
  const big = { name: '简历.pdf', size: limit + 1 };
  assert.throws(() => assertFilesWithinLimit([big]), (error) => {
    assert.match(error.message, /简历\.pdf/);
    assert.match(error.message, /10\.0 MB/);
    assert.match(error.message, /超过 10 MB，已拒绝导入/);
    return true;
  });
  const larger = { name: '材料.md', size: Math.round(12.5 * 1024 * 1024) };
  assert.throws(() => assertFilesWithinLimit([{ name: 'ok.txt', size: limit }, larger]), /材料\.md/);
  assert.match(assertFilesWithinLimit([{ name: '刚好.pdf', size: limit }])[0].name, /刚好\.pdf/);
});
test('画像 JSON 只能单独导入，字段不对时指出具体问题', () => {
  const profile = parseProfileJson('{"target":{"jobTitles":["测试工程师"],"salaryMinK":"18"},"basics":{"yearsOfExperience":0}}');
  assert.deepEqual(profile.target.jobTitles, ['测试工程师']);
  assert.equal(profile.basics.yearsOfExperience, 0);
  assert.throws(() => parseProfileJson('{'), /无法解析/);
  assert.throws(() => parseProfileJson('[]'), /根节点必须是对象/);
  assert.throws(() => parseProfileJson('{"foo":1}'), /缺少 target、basics、capabilities/);
  assert.throws(() => parseProfileJson('{"target":"前端"}'), /画像字段校验失败：target 应为对象/);
  assert.throws(() => parseProfileJson('{"target":{"salaryMinK":"很多"}}'), /target\.salaryMinK 不是有效数字/);
  assert.throws(() => parseProfileJson('{"basics":{"yearsOfExperience":-1}}'), /yearsOfExperience 不能为负数/);
  assert.throws(() => planJsonFile([{ name: 'a.json', size: 10 }, { name: 'b.json', size: 10 }]), /画像 JSON 请单独导入/);
  assert.throws(() => planJsonFile([{ name: '简历.pdf', size: 10 }]), /不是画像 JSON/);
  assert.equal(planJsonFile([{ name: '画像.json', size: 20 }]).name, '画像.json');
});
test('简历文件区分单个 PDF/DOCX 与多个文本材料', () => {
  assert.equal(planResumeFiles([{ name: '简历.pdf', size: 100 }]).kind, 'resume');
  assert.equal(planResumeFiles([{ name: 'a.md', size: 1 }, { name: 'b.txt', size: 1 }]).kind, 'materials');
  assert.throws(() => planResumeFiles([{ name: 'a.pdf', size: 1 }, { name: 'b.txt', size: 1 }]), /PDF 或 DOCX 请单独导入/);
  assert.throws(() => planResumeFiles([{ name: '画像.json', size: 1 }]), /画像 JSON 请单独导入/);
  assert.throws(() => planResumeFiles([{ name: '简历.exe', size: 1 }]), /不是支持的简历文件/);
});
test('合并草稿去重、补空，摘要保留原内容并追加', () => {
  const current = sanitizeProfile({
    basics: { education: '本科' },
    capabilities: { skills: ['React'] },
    workSummary: '已有工作',
    preference: { notes: '已有说明', dealbreakers: ['出差'] },
  });
  const draft = sanitizeProfile({
    basics: { education: '硕士', currentTitle: '测试工程师' },
    capabilities: { skills: ['react', 'Vue'] },
    workSummary: '新工作',
    preference: { notes: '新说明', dealbreakers: ['夜班'] },
  });
  const merged = applyProfileDraft(current, draft, false);
  assert.equal(merged.basics.education, '本科');
  assert.equal(merged.basics.currentTitle, '测试工程师');
  assert.deepEqual(merged.capabilities.skills, ['React', 'Vue']);
  assert.deepEqual(merged.preference.dealbreakers, ['出差', '夜班']);
  assert.equal(merged.workSummary, '已有工作\n\n新工作');
  assert.equal(merged.preference.notes, '已有说明\n\n新说明');
  assert.equal(applyProfileDraft(current, draft, true), draft);
  const contained = sanitizeProfile({ workSummary: '已有工作\n\n新工作' });
  assert.equal(applyProfileDraft(contained, sanitizeProfile({ workSummary: '新工作' }), false).workSummary, '已有工作\n\n新工作');
});

await testAsync('多个 md/txt 按 10000 字分段抽取后合并，空文件不调用抽取', async () => {
  const text = `${'甲'.repeat(10000)}乙`;
  const calls = [];
  const draft = await combineMaterialExtracts([
    { name: '经历.md', text },
    { name: '补充.txt', text: '第二份材料' },
  ], async (prompt) => {
    calls.push(prompt);
    if (prompt.includes('第二份材料')) return { capabilities: { skills: ['Vue'] }, workSummary: '第二段经历' };
    if (prompt.endsWith('乙')) return { capabilities: { skills: ['TypeScript'] }, workSummary: '后半经历', projectSummary: '后半项目' };
    return { capabilities: { skills: ['React'] }, workSummary: '前半经历', projectSummary: '前半项目' };
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].slice('材料：经历.md\n'.length).length, 10000);
  assert.ok(calls[1].startsWith('材料：经历.md\n') && calls[1].endsWith('乙'));
  assert.ok(calls[2].startsWith('材料：补充.txt\n'));
  assert.deepEqual(draft.capabilities.skills, ['React', 'TypeScript', 'Vue']);
  assert.equal(draft.workSummary, '前半经历\n后半经历\n第二段经历');
  assert.equal(draft.projectSummary, '前半项目\n后半项目');
  let called = false;
  await assert.rejects(
    combineMaterialExtracts([{ name: '空白.txt', text: '  \n' }], async () => { called = true; return {}; }),
    /空白\.txt/,
  );
  assert.equal(called, false);
});

test('招呼提示保留岗位隐私设置并要求真实表达', () => {
  const messages = buildMatchPrompt(emptyProfile(), { title: '前端', company: '测试公司' }, { includeCompany: false });
  assert.ok(messages[0].content.includes('未知年限不是零'));
  assert.ok(messages[0].content.includes('实习写实习'));
  assert.ok(!messages[1].content.includes('测试公司'));
});

test('匹配提示包含雷点语义规则，且雷点不否决岗位', () => {
  const profile = emptyProfile();
  profile.preference.dealbreakers = ['大小周'];
  const messages = buildMatchPrompt(profile, { title: '前端', description: '每周工作六天' });
  const system = messages[0].content;
  assert.ok(system.includes('雷点'));
  assert.ok(system.includes('preference.dealbreakers'));
  assert.ok(system.includes('不要因为它把 eligible 置为 false'));
  assert.ok(messages[1].content.includes('【雷点字面命中】\n无'));
});

test('规避关键词命中由代码先匹配并写进提示词', () => {
  const profile = emptyProfile();
  profile.preference.avoidKeywords = ['外包', '不存在的词'];
  profile.preference.dealbreakers = ['驻场'];
  const job = { title: '前端工程师', description: '本岗位为外包驻场项目' };
  const messages = buildMatchPrompt(profile, job);
  const user = messages[1].content;
  assert.ok(user.includes('【雷点字面命中】'));
  const hitSection = user.slice(user.indexOf('【雷点字面命中】'), user.indexOf('请按以下 JSON 结构输出'));
  assert.ok(hitSection.includes('外包'));
  assert.ok(hitSection.includes('驻场'));
  assert.ok(!hitSection.includes('不存在的词'));
  assert.ok(messages[0].content.includes('字面命中只是线索'));
});

test('未配置规避关键词时不输出命中区块', () => {
  const messages = buildMatchPrompt(emptyProfile(), { title: '前端', description: '外包项目' });
  assert.ok(!messages[1].content.includes('【雷点字面命中】'));
});

test('历史雷点合并去重，编辑时删除两处并保留其他数据', () => {
  const pref = { avoidKeywords: ['外包', 'Java'], dealbreakers: ['java', '大小周'], notes: '保留' };
  assert.deepEqual(getDealbreakers(pref), ['java', '大小周', '外包']);
  const updated = updateDealbreakers(pref, ['大小周', '外包', '驻场']);
  assert.deepEqual(updated.avoidKeywords, ['外包']);
  assert.deepEqual(updated.dealbreakers, ['大小周', '驻场']);
  assert.equal(updated.notes, '保留');
  assert.deepEqual(getDealbreakers(updated), ['大小周', '驻场', '外包']);
});

test('低分不等于不合格：没有硬门槛时 eligible 保持 true', () => {
  const m = sanitizeMatch({ score: 30, risks: ['命中雷点：大小周'] });
  assert.equal(m.eligible, true);
  assert.deepEqual(m.blockers, []);
});

// ---------- 筛选 ----------
section('本地筛选');
const sampleJob = bossJobs[0];
test('排除关键词命中即弃', () => {
  const ev = evaluateJob({ ...sampleJob, title: '电销专员' }, { keywordsExclude: ['电销'] });
  assert.equal(ev.keep, false);
});
test('包含关键词未命中则弃', () => {
  const ev = evaluateJob(sampleJob, { keywordsInclude: ['不存在的词xyz'] });
  assert.equal(ev.keep, false);
});
test('风险词标注但不剔除', () => {
  const ev = evaluateJob({ ...sampleJob, title: '外包测试', description: '' }, { riskKeywords: ['外包'] });
  assert.ok(ev.risks.includes('外包'));
  assert.equal(ev.keep, true);
});
test('屏蔽公司', () => {
  const ev = evaluateJob({ ...sampleJob, company: 'XX外包公司' }, { excludeCompanies: ['外包'] });
  assert.equal(ev.keep, false);
});
test('applyFilters 关闭时全保留', () => {
  const out = applyFilters(bossJobs, { enabled: false });
  assert.equal(out.length, bossJobs.length);
});
test('applyFilters 关闭时附带命中原因', () => {
  const jobs = [
    { ...sampleJob, uid: 'a', company: 'XX外包公司' },
    { ...sampleJob, uid: 'b', title: '电销专员' },
    { ...sampleJob, uid: 'c', city: '拉萨', district: '' },
    { ...sampleJob, uid: 'd', salaryMinK: 5, salaryMaxK: 8 },
  ];
  const rules = { excludeCompanies: ['外包'], keywordsExclude: ['电销'], cities: [sampleJob.city], salaryMinK: 20 };
  const out = applyFilters(jobs, { ...rules, enabled: false });
  assert.equal(out.length, 4);
  const byUid = Object.fromEntries(out.map((j) => [j.uid, j._filter]));
  assert.ok(byUid.a.reasons.includes('公司被屏蔽：外包'));
  assert.ok(byUid.b.reasons.includes('命中排除词：电销'));
  assert.ok(byUid.c.reasons.includes('城市不匹配'));
  assert.ok(byUid.d.reasons.includes('薪资低于期望下限 20k'));
  assert.ok(out.every((j) => j._filter.keep === false));
  assert.equal(applyFilters(jobs, { ...rules, enabled: true }).length, 0);
});
test('applyFilters 关闭时保留风险词标注', () => {
  const out = applyFilters([{ ...sampleJob, title: '外包测试' }], { enabled: false, riskKeywords: ['外包'] });
  assert.deepEqual(out[0]._filter.risks, ['外包']);
  assert.equal(out[0]._filter.keep, true);
});
test('applyFilters 无设置时不报错', () => {
  const out = applyFilters([sampleJob], undefined);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]._filter.reasons, []);
});
test('autoScoreUids 跟随过滤开关', () => {
  const jobs = [{ ...sampleJob, uid: 'ok' }, { ...sampleJob, uid: 'bad', title: '电销专员' }];
  const rules = { keywordsExclude: ['电销'] };
  assert.deepEqual(autoScoreUids(jobs, { ...rules, enabled: true }), ['ok']);
  assert.deepEqual(autoScoreUids(jobs, { ...rules, enabled: false }), ['ok', 'bad']);
  assert.deepEqual(autoScoreUids(jobs, undefined), ['ok', 'bad']);
});
test('薪资下限过滤', () => {
  const ev = evaluateJob({ ...sampleJob, salaryMinK: 5, salaryMaxK: 8 }, { salaryMinK: 20 });
  assert.equal(ev.keep, false);
});

// ---------- AI 供应商 ----------
section('AI 供应商配置');
test('预设创建 OpenAI', () => {
  const p = providerFromPreset('openai');
  assert.equal(p.protocol, 'openai-chat');
  assert.ok(p.baseUrl.includes('openai.com'));
});
test('anthropic 预设带 version', () => {
  const p = providerFromPreset('anthropic');
  assert.equal(p.protocol, 'anthropic');
  assert.equal(p.anthropicVersion, '2023-06-01');
});
test('校验：缺 model 报错', () => {
  const v = validateProvider({ name: 'x', baseUrl: 'https://api.x.com', model: '' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('模型')));
});
test('校验：http 非 localhost 报错', () => {
  const v = validateProvider({ name: 'x', baseUrl: 'http://api.x.com', model: 'm' });
  assert.equal(v.ok, false);
});
test('校验：localhost http 放行', () => {
  const v = validateProvider({ name: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' });
  assert.equal(v.ok, true);
});
test('本地模型无需 key 即可用', () => {
  assert.equal(isProviderUsable({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', apiKey: '' }), true);
});
test('远程模型缺 key 不可用', () => {
  assert.equal(isProviderUsable({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '' }), false);
});
test('四种协议和全部预设都能生成接口', () => {
  assert.deepEqual(PROTOCOLS, ['openai-chat', 'openai-responses', 'anthropic', 'gemini']);
  assert.ok(PRESETS.length >= 4);
  for (const preset of PRESETS) {
    const provider = providerFromPreset(preset.key);
    assert.equal(provider.protocol, preset.protocol);
    assert.ok(PROTOCOLS.includes(provider.protocol));
    assert.equal(provider.name, preset.name);
    assert.equal(provider.apiKey, '');
    assert.ok(provider.id.startsWith('prov-'));
  }
});

// ---------- AI 接口页状态 ----------
section('AI 接口页状态');
test('删除正在使用的接口时落到剩余第一个', () => {
  const providers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const next = removeProviderState({ providers, activeProviderId: 'b', selectedId: 'b', removedId: 'b' });
  assert.deepEqual(next.providers.map((item) => item.id), ['a', 'c']);
  assert.equal(next.activeProviderId, 'a');
  assert.equal(next.selectedId, 'a');
  assert.deepEqual(providers.map((item) => item.id), ['a', 'b', 'c']);
});
test('删除排在第一且正在使用的接口时启用新的第一个', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }], activeProviderId: 'a', selectedId: 'a', removedId: 'a',
  });
  assert.equal(next.activeProviderId, 'b');
  assert.equal(next.selectedId, 'b');
});
test('删除非使用中的接口时保留使用状态', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], activeProviderId: 'a', selectedId: 'c', removedId: 'b',
  });
  assert.equal(next.activeProviderId, 'a');
  assert.equal(next.selectedId, 'c');
  assert.deepEqual(next.providers.map((item) => item.id), ['a', 'c']);
});
test('删除正在使用的接口时，正在编辑的另一个接口保持选中', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], activeProviderId: 'a', selectedId: 'c', removedId: 'a',
  });
  assert.equal(next.activeProviderId, 'b');
  assert.equal(next.selectedId, 'c');
});
test('删除唯一接口时清空使用状态', () => {
  const next = removeProviderState({
    providers: [{ id: 'a' }], activeProviderId: 'a', selectedId: 'a', removedId: 'a',
  });
  assert.deepEqual(next.providers, []);
  assert.equal(next.activeProviderId, '');
  assert.equal(next.selectedId, '');
});
test('已有接口时优先保持当前编辑，否则选中正在使用的', () => {
  const providers = [{ id: 'a' }, { id: 'b' }];
  assert.equal(initialSelectedId(providers, 'b', 'a'), 'a');
  assert.equal(initialSelectedId(providers, 'b', ''), 'b');
  assert.equal(initialSelectedId(providers, '', 'missing'), 'a');
  assert.equal(initialSelectedId([], 'a', 'a'), '');
});
test('额外请求头只接受 JSON 对象', () => {
  assert.deepEqual(parseExtraHeaders(''), { ok: true, headers: {} });
  assert.deepEqual(parseExtraHeaders('  {"X-Demo":"1"} '), { ok: true, headers: { 'X-Demo': '1' } });
  assert.equal(parseExtraHeaders('{').ok, false);
  assert.equal(parseExtraHeaders('[]').ok, false);
  assert.equal(parseExtraHeaders('null').ok, false);
  assert.equal(parseExtraHeaders('{"X":{"nested":true}}').ok, false);
  assert.match(parseExtraHeaders('{').error, /JSON/);
});
test('连接耗时由调用方传入的毫秒决定', () => {
  assert.equal(formatElapsed(40), '0.04 秒');
  assert.equal(formatElapsed(800), '0.8 秒');
  assert.equal(formatElapsed(1200), '1.2 秒');
  assert.equal(formatElapsed(10500), '11 秒');
  assert.equal(formatElapsed(-1), '');
  const ok = formatConnectionResult({ ok: true, sample: '正常', elapsedMs: 800, duration: 9 });
  assert.equal(ok.text, '连接正常 · 0.8 秒');
  assert.equal(ok.detail, '模型回复：正常');
  const failed = formatConnectionResult({ ok: false, message: '网络请求失败', elapsedMs: 1200 });
  assert.equal(failed.text, '连接失败 · 1.2 秒');
  assert.equal(failed.detail, '网络请求失败');
  assert.equal(formatModelsResult({ count: 2, elapsedMs: 500 }).text, '已拉取 2 个模型 · 0.5 秒');
});
test('列表行展示协议、模型和主机', () => {
  const meta = providerMeta({ protocol: 'openai-chat', model: 'demo-small', baseUrl: 'https://invalid.example/v1' });
  assert.equal(meta.text, 'OpenAI 兼容 · demo-small · invalid.example');
  assert.equal(providerHost(''), '未填写地址');
  assert.equal(providerHost('not a url'), 'not a url');
});
test('AI 接口页保留原字段、自动保存，并且自己计时', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ui = fs.readFileSync(path.join(root, 'src/react/settings/AiTab.jsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/common/ai/client.js'), 'utf8');
  for (const field of ['baseUrl', 'apiKey', 'model', 'anthropicVersion', 'temperature', 'maxTokens', 'requestUrl', 'modelsUrl', 'extraHeaders', 'discoveredModels', 'activeProviderId']) {
    assert.match(ui, new RegExp(field));
  }
  assert.match(ui, /updateProviders/);
  assert.match(ui, /PRESETS\.map/);
  assert.match(ui, /PROTOCOLS\.map/);
  assert.match(ui, /AI_PROVIDER_TEST/);
  assert.match(ui, /AI_PROVIDER_MODELS/);
  assert.match(ui, /performance\.now\(\)/);
  assert.match(ui, /formatConnectionResult/);
  assert.doesNotMatch(ui, /<button\b[^>]*>\s*保存/);
  assert.doesNotMatch(client, /elapsedMs/);
});

// ---------- 匹配结果规整 ----------
section('AI 匹配结果规整');
test('分数越界收敛到 0-100', () => {
  assert.equal(sanitizeMatch({ score: 150 }).score, 100);
  assert.equal(sanitizeMatch({ score: -3 }).score, 0);
});
test('verdict 缺失按分数推断', () => {
  assert.equal(sanitizeMatch({ score: 85 }).verdict, 'strong');
  assert.equal(scoreToVerdict(50), 'fair');
});
test('数组截断到 6 条', () => {
  const m = sanitizeMatch({ score: 70, reasons: Array(10).fill('r') });
  assert.ok(m.reasons.length <= 6);
});
test('三档招呼语：新结构原样保留', () => {
  const m = sanitizeMatch({ score: 80, greetings: { short: '短', standard: '中', detailed: '长' } });
  assert.equal(m.greetings.short, '短');
  assert.equal(m.greetings.standard, '中');
  assert.equal(m.greetings.detailed, '长');
  assert.equal(m.greeting, '中'); // 兼容字段取标准版
});
test('三档招呼语：旧单字段视作标准版并兜底其它档', () => {
  const m = sanitizeMatch({ score: 80, greeting: '旧开场白' });
  assert.equal(m.greetings.standard, '旧开场白');
  assert.equal(m.greetings.short, '旧开场白'); // 缺失档位兜底
  assert.equal(m.greetings.detailed, '旧开场白');
});
test('normalizeGreetings：全空得到三个空串且不抛错', () => {
  const g = normalizeGreetings({});
  assert.equal(g.short, '');
  assert.equal(g.standard, '');
  assert.equal(g.detailed, '');
});
test('normalizeGreetings：仅详细版时用它兜底标准/精简', () => {
  const g = normalizeGreetings({ greetings: { detailed: '详细内容' } });
  assert.equal(g.standard, '详细内容');
  assert.equal(g.short, '详细内容');
});

// ---------- 硬门槛 + 四维分（job-evaluate 方法论） ----------
section('匹配：硬门槛与分项');
test('有 blockers 时 eligible 判为 false', () => {
  const m = sanitizeMatch({ score: 40, blockers: ['要求5年经验，画像仅2年'] });
  assert.equal(m.eligible, false);
  assert.deepEqual(m.blockers, ['要求5年经验，画像仅2年']);
});
test('显式 eligible:false 被保留（即使无 blockers）', () => {
  assert.equal(sanitizeMatch({ score: 50, eligible: false }).eligible, false);
});
test('旧缓存无 eligible 字段默认视为 eligible', () => {
  const m = sanitizeMatch({ score: 70 });
  assert.equal(m.eligible, true);
  assert.deepEqual(m.blockers, []);
});
test('normalizeDims：分项越界收敛到 0-100', () => {
  const d = normalizeDims({ skill: 120, experience: -5, requirement: 60, location: 88 });
  assert.deepEqual(d, { skill: 100, experience: 0, requirement: 60, location: 88 });
});
test('normalizeDims：全空返回 null（旧缓存无分项）', () => {
  assert.equal(normalizeDims({}), null);
  assert.equal(normalizeDims(undefined), null);
});
test('sanitizeMatch 带 dims 时挂上分项', () => {
  const m = sanitizeMatch({ score: 80, dims: { skill: 90 } });
  assert.equal(m.dims.skill, 90);
  assert.equal(m.dims.experience, null);
});

// ---------- 简历定制建议 ----------
section('简历定制建议规整');
test('sanitizeTailor 规整各字段并截断', () => {
  const t = sanitizeTailor({
    matchedSkills: ['React', '', 'TS', 'Vue', 'Node', 'CSS', 'HTML', 'Git', '溢出'],
    missingSkills: ['SSR'],
    keywordsToAlign: ['中后台', '组件化'],
    summaryDraft: '  4年前端经验……  ',
    bulletSuggestions: ['突出组件库'],
    tips: ['准备量化案例'],
    note: '画像信息偏少',
  });
  assert.equal(t.matchedSkills.length, 8, 'matchedSkills 上限8、空串剔除');
  assert.ok(!t.matchedSkills.includes(''));
  assert.deepEqual(t.missingSkills, ['SSR']);
  assert.equal(t.summaryDraft, '4年前端经验……', '首尾空白 trim');
  assert.equal(t.note, '画像信息偏少');
  assert.ok(t.at, '带时间戳');
});
test('sanitizeTailor 容忍空输入', () => {
  const t = sanitizeTailor(null);
  assert.deepEqual(t.matchedSkills, []);
  assert.deepEqual(t.bulletSuggestions, []);
  assert.equal(t.summaryDraft, '');
  assert.equal(t.note, '');
});

// ---------- 脱敏 ----------
section('隐私脱敏');
test('手机号/邮箱/微信被隐藏', () => {
  const out = redactText('联系我 13800138000，邮箱 a@b.com，微信：abc12345');
  assert.ok(!out.includes('13800138000'));
  assert.ok(!out.includes('a@b.com'));
  assert.ok(out.includes('已隐藏'));
});

// ---------- 扩展内更新 ----------
section('扩展内更新');
const selfManifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
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
test('预览列表取第一个带 zip 的 prerelease，没有则暂无预览版', () => {
  const zip = (tag) => ({ name: 'a.zip', browser_download_url: `https://github.com/DikkooXie/job-filter-assistant/releases/download/${tag}/a.zip` });
  const draft = release({ tag_name: 'v1.0.3.9', prerelease: true, draft: true, assets: [zip('v1.0.3.9')] });
  const stable = release({ tag_name: 'v1.0.3', prerelease: false, assets: [zip('v1.0.3')] });
  const noZip = release({ tag_name: 'v1.0.3.1', prerelease: true, assets: [] });
  const first = release({ tag_name: 'v1.0.3.2', prerelease: true, assets: [zip('v1.0.3.2')] });
  const later = release({ tag_name: 'v1.0.3.3', prerelease: true, assets: [zip('v1.0.3.3')] });
  assert.equal(selectPreviewRelease([draft, stable, noZip, first, later]).version, '1.0.3.2');
  const empty = resolvePreviewCheck([stable, draft, noZip], '1.0.3');
  assert.equal(empty.previewUnavailable, true);
  assert.equal(empty.hasUpdate, false);
  assert.equal(empty.aheadOfStable, false);
  assert.equal(empty.message, NO_PREVIEW_MESSAGE);
  assert.equal(resolvePreviewCheck([], '1.0.3').message, '暂无预览版');
  assert.throws(() => selectPreviewRelease({ message: 'nope' }), /格式不正确/);
  const newer = resolvePreviewCheck([first], '1.0.3');
  assert.equal(newer.hasUpdate, true);
  assert.equal(newer.previewUnavailable, false);
  assert.equal(newer.version, '1.0.3.2');
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
// 在 vm 里用最小桩跑 collector.js（内容脚本不打包，无法直接 import）。
section('页面收录角标');
function runCollector(stored) {
  const appended = [];
  const listeners = { message: [], storage: [] };
  const makeEl = () => {
    const el = {
      className: '', innerHTML: '', removed: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      querySelector: () => ({ textContent: '' }),
      remove() { el.removed = true; },
    };
    return el;
  };
  const fakeWindow = { addEventListener: (type, fn) => type === 'message' && listeners.message.push(fn) };
  const ctx = {
    window: fakeWindow,
    location: { href: 'https://example.com/', hostname: 'example.com' },
    URL,
    document: {
      createElement: makeEl,
      body: { appendChild: (el) => { appended.push(el); return el; } },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    MutationObserver: class { observe() {} },
    setTimeout: () => 0, // 不触发兜底抓取与淡出计时
    clearTimeout: () => {},
    chrome: {
      runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } },
      storage: {
        local: { get: async () => (stored === undefined ? {} : { jobHelperSettingsV1: stored }) },
        onChanged: { addListener: (fn) => listeners.storage.push(fn) },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/collector.js'), 'utf8'), ctx);
  const capture = async () => {
    for (const fn of listeners.message) {
      fn({ source: fakeWindow, data: { source: 'job-helper:sniffer', platform: 'boss', url: 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json', payload: { zpData: { jobList: [] } } } });
    }
    await new Promise((r) => setImmediate(r));
  };
  const badges = () => appended.filter((el) => el.className === 'jobhelper-capture-badge' && !el.removed);
  const changeSettings = (newValue) => listeners.storage.forEach((fn) => fn({ jobHelperSettingsV1: { newValue } }, 'local'));
  return { capture, badges, changeSettings };
}
await testAsync('未保存过设置时，收录后显示角标', async () => {
  const c = runCollector(undefined);
  await c.capture();
  assert.equal(c.badges().length, 1);
});
await testAsync('showBadge 为 false 时不创建角标', async () => {
  const c = runCollector({ showBadge: false });
  await c.capture();
  await c.capture();
  assert.equal(c.badges().length, 0);
});
await testAsync('在设置页关闭后，已显示的角标立即移除；重新打开后再次显示', async () => {
  const c = runCollector({ showBadge: true });
  await c.capture();
  assert.equal(c.badges().length, 1);
  c.changeSettings({ showBadge: false });
  assert.equal(c.badges().length, 0);
  await c.capture();
  assert.equal(c.badges().length, 0);
  c.changeSettings({ showBadge: true });
  await c.capture();
  assert.equal(c.badges().length, 1);
});

// ---------- 设置页保存队列 ----------
section('设置页保存队列');
const { createSaveQueue } = await import('../src/react/settings/saveQueue.js');

function createClock() {
  let now = 0;
  let nextId = 1;
  const items = [];
  return {
    schedule(fn, ms) {
      const id = nextId++;
      items.push({ id, at: now + ms, fn });
      return id;
    },
    cancel(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = items.filter((item) => item.at <= target).sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) break;
        const item = due[0];
        items.splice(items.findIndex((entry) => entry.id === item.id), 1);
        now = item.at;
        item.fn();
        await settle();
      }
      now = target;
    },
  };
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function createQueueHarness(report, extra = {}) {
  const clock = createClock();
  const listeners = {};
  const bind = (target) => {
    target.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
    target.removeEventListener = (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((item) => item !== fn);
    };
  };
  const target = {};
  const documentTarget = { visibilityState: 'visible' };
  bind(target);
  bind(documentTarget);
  const queue = createSaveQueue(report, {
    schedule: clock.schedule,
    cancel: clock.cancel,
    target,
    documentTarget,
    ...extra,
  });
  const fire = (type) => (listeners[type] || []).slice().forEach((fn) => fn());
  return { clock, queue, fire, documentTarget, listeners };
}

await testAsync('防抖窗口内只执行最后一次任务', async () => {
  const { clock, queue } = createQueueHarness();
  const snaps = [];
  queue.enqueue('settings', () => { snaps.push(1); }, 200);
  await clock.advance(150);
  queue.enqueue('settings', () => { snaps.push(2); }, 200);
  await clock.advance(199);
  assert.deepEqual(snaps, []);
  await clock.advance(1);
  assert.deepEqual(snaps, [2]);
});

await testAsync('设置、画像、供应商按各自间隔独立防抖', async () => {
  const { clock, queue } = createQueueHarness();
  const order = [];
  queue.enqueue('settings', () => { order.push('settings'); }, 200);
  queue.enqueue('providers', () => { order.push('providers'); }, 500);
  queue.enqueue('profile', () => { order.push('profile'); }, 600);
  await clock.advance(200);
  assert.deepEqual(order, ['settings']);
  await clock.advance(300);
  assert.deepEqual(order, ['settings', 'providers']);
  await clock.advance(100);
  assert.deepEqual(order, ['settings', 'providers', 'profile']);
});

await testAsync('保存失败后按原间隔重新排队，成功后不再重试', async () => {
  const notes = [];
  const { clock, queue } = createQueueHarness((message, isError) => notes.push([message, isError]));
  let calls = 0;
  queue.enqueue('profile', async () => {
    calls += 1;
    if (calls === 1) throw new Error('保存失败');
  }, 600);
  await clock.advance(599);
  assert.equal(calls, 0);
  await clock.advance(1);
  assert.equal(calls, 1);
  assert.deepEqual(notes, [['保存失败', true]]);
  await clock.advance(599);
  assert.equal(calls, 1);
  await clock.advance(1);
  assert.equal(calls, 2);
  assert.deepEqual(notes, [['保存失败', true], [null, false]]);
  await clock.advance(5000);
  assert.equal(calls, 2);
});

await testAsync('失败时若已有更新的编辑，不把旧任务重新排队', async () => {
  const { clock, queue } = createQueueHarness();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ran = [];
  queue.enqueue('profile', () => gate.then(() => {
    ran.push('old');
    throw new Error('旧保存失败');
  }), 100);
  await clock.advance(100);
  queue.enqueue('profile', async () => { ran.push('new'); }, 100);
  release();
  await settle();
  await clock.advance(100);
  assert.deepEqual(ran, ['old', 'new']);
  await clock.advance(5000);
  assert.deepEqual(ran, ['old', 'new']);
});

await testAsync('flush 立即执行并等待结果，失败会拒绝当前这次', async () => {
  const { clock, queue } = createQueueHarness();
  let calls = 0;
  queue.enqueue('settings', async () => {
    calls += 1;
    if (calls === 1) throw new Error('写盘失败');
  }, 5000);
  await assert.rejects(queue.flush('settings'), /写盘失败/);
  assert.equal(calls, 1);
  await clock.advance(4999);
  assert.equal(calls, 1);
  await clock.advance(1);
  assert.equal(calls, 2);
});

await testAsync('flush 等正在进行的保存结束后再执行新任务', async () => {
  const { clock, queue } = createQueueHarness();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  queue.enqueue('providers', () => { order.push('a'); return gate; }, 10);
  await clock.advance(10);
  queue.enqueue('providers', () => { order.push('b'); }, 5000);
  let flushed = false;
  const done = queue.flush('providers').then(() => { flushed = true; });
  await settle();
  assert.equal(flushed, false);
  assert.deepEqual(order, ['a']);
  release();
  await done;
  assert.equal(flushed, true);
  assert.deepEqual(order, ['a', 'b']);
});

await testAsync('pagehide 与 beforeunload 立刻发出未保存内容，且不重复发送', async () => {
  const { queue, fire } = createQueueHarness();
  let calls = 0;
  queue.enqueue('settings', () => { calls += 1; }, 5000);
  assert.equal(calls, 0);
  fire('pagehide');
  assert.equal(calls, 1);
  fire('beforeunload');
  assert.equal(calls, 1);
});

await testAsync('页面隐藏时立刻保存，重新可见不会再发一次', async () => {
  const { queue, fire, documentTarget } = createQueueHarness();
  let calls = 0;
  queue.enqueue('providers', () => { calls += 1; }, 5000);
  documentTarget.visibilityState = 'hidden';
  fire('visibilitychange');
  assert.equal(calls, 1);
  documentTarget.visibilityState = 'visible';
  fire('visibilitychange');
  assert.equal(calls, 1);
});

await testAsync('关闭页面时不等待上一次保存，立刻发出更新的任务', async () => {
  const { clock, queue, fire } = createQueueHarness();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  queue.enqueue('profile', () => { order.push('a'); return gate; }, 10);
  await clock.advance(10);
  queue.enqueue('profile', () => { order.push('b'); }, 5000);
  fire('beforeunload');
  assert.deepEqual(order, ['a', 'b']);
  release();
  await settle();
});

await testAsync('组件卸载时写出未完成保存，之后不再接收新任务', async () => {
  const { clock, queue, listeners } = createQueueHarness();
  let calls = 0;
  queue.enqueue('profile', () => { calls += 1; }, 5000);
  queue.dispose();
  assert.equal(calls, 1);
  assert.equal(listeners.pagehide.length, 0);
  queue.enqueue('profile', () => { calls += 1; }, 10);
  await clock.advance(10);
  assert.equal(calls, 1);
  queue.dispose();
});

await testAsync('编辑后为保存中，成功后为已保存并记下时间', async () => {
  const savedAt = 1_700_000_123_000;
  const seen = [];
  const { clock, queue } = createQueueHarness(undefined, { now: () => savedAt });
  queue.subscribe((snap) => seen.push(snap.phase));
  queue.enqueue('settings', () => {}, 200);
  assert.equal(queue.snapshot().phase, 'saving');
  assert.equal(seen.at(-1), 'saving');
  await clock.advance(199);
  assert.equal(queue.snapshot().phase, 'saving');
  await clock.advance(1);
  assert.equal(queue.snapshot().phase, 'saved');
  assert.equal(queue.snapshot().savedAt, savedAt);
  assert.equal(queue.snapshot().error, null);
});

await testAsync('保存失败时保持可重试，手动重试成功后变为已保存', async () => {
  const { clock, queue } = createQueueHarness(undefined, { now: () => 42 });
  let calls = 0;
  queue.enqueue('profile', async () => {
    calls += 1;
    if (calls === 1) throw new Error('保存失败');
  }, 200);
  await clock.advance(200);
  assert.equal(calls, 1);
  assert.equal(queue.snapshot().phase, 'error');
  assert.match(queue.snapshot().error, /保存失败/);
  await clock.advance(199);
  assert.equal(calls, 1);
  assert.equal(queue.snapshot().phase, 'error');
  await queue.retry();
  assert.equal(calls, 2);
  assert.equal(queue.snapshot().phase, 'saved');
  assert.equal(queue.snapshot().savedAt, 42);
});

await testAsync('更新的编辑进行中时，不把状态停在上一次失败', async () => {
  const { clock, queue } = createQueueHarness();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  queue.enqueue('settings', () => gate.then(() => { throw new Error('旧保存失败'); }), 10);
  await clock.advance(10);
  queue.enqueue('settings', async () => {}, 100);
  assert.equal(queue.snapshot().phase, 'saving');
  release();
  await settle();
  assert.equal(queue.snapshot().phase, 'saving');
  await clock.advance(100);
  assert.equal(queue.snapshot().phase, 'saved');
});

test('设置页仍然使用 200 / 600 / 500 毫秒防抖', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/react/options.jsx'), 'utf8');
  assert.match(src, /enqueue\('settings',[\s\S]*?,\s*200\)/);
  assert.match(src, /enqueue\('profile',[\s\S]*?,\s*600\)/);
  assert.match(src, /enqueue\('providers',[\s\S]*?,\s*500\)/);
  assert.doesNotMatch(src, /import\(/);
  const queueSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/react/settings/saveQueue.js'), 'utf8');
  assert.match(queueSrc, /pagehide/);
  assert.match(queueSrc, /beforeunload/);
  assert.doesNotMatch(queueSrc, /import\(/);
});

const { pageFromHash, isUpdatedHash, nextNavIndex, SETTINGS_PAGES, optionsUrlHash, sectionTargetId } = await import('../src/react/settings/pageHash.js');
test('设置页 hash 保持四个页面，#updated 落到通用与隐私', () => {
  assert.deepEqual(SETTINGS_PAGES.map((page) => page.id), ['profile', 'ai', 'filters', 'general']);
  assert.equal(SETTINGS_PAGES.find((page) => page.id === 'ai').label, '模型接口');
  assert.equal(pageFromHash(''), 'profile');
  assert.equal(pageFromHash('#profile'), 'profile');
  assert.equal(pageFromHash('#ai'), 'ai');
  assert.equal(pageFromHash('#ai-list'), 'ai');
  assert.equal(pageFromHash('#filters'), 'filters');
  assert.equal(pageFromHash('#general'), 'general');
  assert.equal(pageFromHash('#updated'), 'general');
  assert.equal(pageFromHash('#nope'), 'profile');
  assert.equal(sectionTargetId('#ai'), 'ai-list-title');
  assert.equal(sectionTargetId('#ai-list'), 'ai-list-title');
  assert.equal(sectionTargetId('#profile'), '');
  assert.equal(optionsUrlHash('ai', 'options.html#profile'), '#ai');
  assert.equal(optionsUrlHash('ai', 'options.html#ai'), '#ai-list');
  assert.equal(optionsUrlHash('ai', 'options.html#ai-list'), '#ai');
  assert.equal(optionsUrlHash('profile', ''), '#profile');
  assert.equal(optionsUrlHash(undefined, ''), '');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tab = fs.readFileSync(path.join(root, 'src/react/settings/ProfileTab.jsx'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src/react/settings/SettingsShell.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/react/settings/shell.css'), 'utf8');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(root, 'extension-pages/options.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/react/settings/shell.css'), 'utf8');
  const globals = fs.readFileSync(path.join(root, 'src/react/globals.css'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/react/options.jsx'), 'utf8');
  assert.match(html, /<body class="settings-root">/);
  assert.match(css, /\.settings-root\s*\{/);
  assert.match(css, /--s-page:\s*#f1f2f0/);
  assert.match(css, /--s-page:\s*#161d22/);
  assert.doesNotMatch(css, /:root\s*\{[^}]*--s-page/);
  assert.doesNotMatch(globals, /--s-page/);
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tab = fs.readFileSync(path.join(root, 'src/react/settings/FiltersTab.jsx'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/react/options.jsx'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/common/settingsStore.js'), 'utf8');
  assert.match(tab, /filterSettingsPatch/);
  assert.match(tab, /包含任一/);
  assert.match(tab, /公司与城市/);
  assert.match(tab, /薪资与要求/);
  assert.match(tab, /is-risk/);
  assert.match(tab, /岗位最高薪资低于这个数就不显示/);
  assert.match(tab, /只在岗位上标注提醒，筛选关闭时也生效/);
  assert.match(tab, /value="filters"/);
  assert.doesNotMatch(tab, /salaryMaxK/);
  assert.match(options, /filters:\s*\{\s*\.\.\.old\.filters,\s*\.\.\.patch\.filters\s*\}/);
  assert.match(store, /filters:\s*\{\s*\.\.\.cur\.filters,\s*\.\.\.\(patch && patch\.filters\)\s*\}/);
});

function memoryChrome() {
  const data = {};
  return {
    storage: {
      local: {
        get(key) {
          if (typeof key === 'string') return Promise.resolve(key in data ? { [key]: data[key] } : {});
          return Promise.resolve({ ...data });
        },
        set(items) {
          Object.assign(data, items);
          return Promise.resolve();
        },
      },
    },
  };
}

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
    if (previous === undefined) delete globalThis.chrome;
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
    const junk = await saveSettings({ updateChannel: 'nightly' });
    assert.equal(junk.updateChannel, 'stable');
    assert.equal(junk.showBadge, false);
    assert.equal((await loadSettings()).updateChannel, 'stable');
  } finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
});

const { summarizeJobs } = await import('../src/react/settings/jobStats.js');
test('岗位库数量只统计列表和收藏', () => {
  assert.deepEqual(summarizeJobs(null), { total: 0, starred: 0 });
  assert.deepEqual(summarizeJobs([{ star: true }, { star: false }, {}, null]), { total: 4, starred: 1 });
});

test('通用与隐私页保留原设置字段，并用岗位列表统计数量', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const page = fs.readFileSync(path.join(root, 'src/react/settings/GeneralTab.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/react/settings/general.css'), 'utf8');
  for (const key of ['autoCapture', 'autoScore', 'showBadge', 'dedupe', 'maxJobs', 'redactPII', 'sendCompanyName', 'confirmBeforeSend']) {
    assert.match(page, new RegExp(key));
  }
  assert.match(page, /JOB_LIST_REQUEST/);
  assert.match(page, /跟随当前网站/);
  assert.match(page, /只用 BOSS 直聘/);
  assert.match(page, /只用前程无忧/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /type="radio"/);
  assert.match(page, /gen-update-slot/);
  assert.match(page, /UpdatePanel/);
  assert.match(page, /updateChannel/);
  const panel = fs.readFileSync(path.join(root, 'src/react/UpdatePanel.jsx'), 'utf8');
  const updater = fs.readFileSync(path.join(root, 'src/ui/update.js'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts/release.mjs'), 'utf8');
  assert.match(panel, /更新通道/);
  assert.match(panel, /\['stable', '稳定'\]/);
  assert.match(panel, /\['preview', '预览'\]/);
  assert.match(panel, /fetchLatestRelease\(channel\)/);
  assert.match(panel, /aheadOfStable/);
  assert.match(panel, /正式版发布页/);
  assert.match(panel, /打开扩展管理页/);
  assert.match(updater, /resolvePreviewCheck/);
  assert.match(updater, /parseRelease\(await fetchGithub\(request\.url\)\)/);
  assert.match(script, /prerelease \? \['--prerelease'\] : \[\]/);
  assert.match(script, /四段版本号/);
  assert.doesNotMatch(page, /JOB_COUNT|JOB_STATS|SHOW_BADGE/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /width:\s*36px/);
  assert.match(css, /height:\s*21px/);
  assert.doesNotMatch(css, /import\(/);
});

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
  const jobs = [
    { uid: '1', title: '前端开发工程师', company: '青禾科技', city: '深圳', skills: ['Vue'], match: { score: 92, verdict: 'strong', summary: '吻合' }, lastSeenAt: '2026-11-01' },
    { uid: '2', title: '后端开发', company: '松果云', city: '杭州', skills: ['Node'], match: null, lastSeenAt: '2026-11-02' },
  ];
  assert.equal(filterVisibleJobs(jobs, { search: '不存在的词', platform: 'all', verdict: 'all', sort: 'recent' }).length, 0);
  assert.equal(librarySurface({ loading: false, loadError: '读取失败', jobCount: jobs.length }), 'error');
  const risky = { _filter: { keep: true, risks: ['驻场'], reasons: [] }, match: { risks: ['要求独立交付，沟通时确认是否接受应届生'] } };
  assert.deepEqual(riskLines(risky), ['含「驻场」，沟通时确认相关安排', '要求独立交付，沟通时确认是否接受应届生']);
  assert.deepEqual(exclusionReasons({ _filter: { keep: false, reasons: ['命中排除词：外包'] } }), ['命中排除词：外包']);
  assert.deepEqual(exclusionReasons({ _filter: { keep: true, reasons: ['经验档位不在偏好内'] } }), []);
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sidepanel = fs.readFileSync(path.join(root, 'src/react/sidepanel.jsx'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/react/sidepanel/views.jsx'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'extension-pages/sidepanel.jsx'), 'utf8');
  const previewEntry = fs.readFileSync(path.join(root, 'extension-pages/sidepanel-browse-preview.jsx'), 'utf8');
  const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
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

test('列表方案 B 用卡片间距，分析区不再画顶部分割线', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const browse = fs.readFileSync(path.join(root, 'src/react/sidepanel/browse.css'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/react/sidepanel/views.jsx'), 'utf8');
  assert.match(browse, /\.continuous-list\s*\{[^}]*gap:\s*10px/);
  assert.match(browse, /\.row-assessment\s*\{[^}]*background:\s*var\(--jp-inset\)/);
  assert.match(browse, /\.row-assessment\s*\{[^}]*border:\s*0/);
  assert.doesNotMatch(browse, /\.row-assessment\s*\{[^}]*border-top/);
  assert.doesNotMatch(browse, /\.job-row\s*\{[^}]*border-bottom/);
  assert.match(views, /assessment-copy/);
  assert.match(views, /className=\{`flow-link/);
});

test('抽取画像方案 B 把底栏放进同一个圆角框', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const profile = fs.readFileSync(path.join(root, 'src/react/settings/profile.css'), 'utf8');
  const tab = fs.readFileSync(path.join(root, 'src/react/settings/ProfileTab.jsx'), 'utf8');
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

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(40)}\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
