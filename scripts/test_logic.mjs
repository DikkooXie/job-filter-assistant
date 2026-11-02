// 纯逻辑单测：用真机逆向样本验证归一化/薪资/画像/筛选/AI 协议构造。
// 运行：node scripts/test_logic.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

import { normalizeResponse, matchPlatformApi, parseSalary } from '../src/common/platforms.js';
import { emptyProfile, scoreProfile, sanitizeProfile, mergeDraft } from '../src/common/profile.js';
import { evaluateJob, applyFilters } from '../src/common/filters.js';
import { sanitizeProvider, validateProvider, providerFromPreset, isProviderUsable } from '../src/common/ai/providers.js';
import { sanitizeMatch, scoreToVerdict, normalizeGreetings, normalizeDims, sanitizeTailor, buildMatchPrompt } from '../src/common/ai/prompts.js';
import { redactText } from '../src/common/ai/privacy.js';
import {
  parseVersion, compareVersions, parseRelease, extensionIdFromKey, packageManifestError, isSameInstall, safeEntryPath, planWrites, unzipGuard, toHex, staleAssets,
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
test('招呼提示保留岗位隐私设置并要求真实表达', () => {
  const messages = buildMatchPrompt(emptyProfile(), { title: '前端', company: '测试公司' }, { includeCompany: false });
  assert.ok(messages[0].content.includes('未知年限不是零'));
  assert.ok(messages[0].content.includes('实习写实习'));
  assert.ok(!messages[1].content.includes('测试公司'));
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
function createQueueHarness(report) {
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

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(40)}\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
