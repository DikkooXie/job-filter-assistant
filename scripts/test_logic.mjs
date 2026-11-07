// 纯逻辑单测：用真机逆向样本验证归一化/薪资/画像/筛选/AI 协议构造。
// 运行：node scripts/test_logic.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

import { defaultFilters, defaultSettings, MSG, STORAGE_KEYS } from '../src/common/constants.js';
import { isDevBuild, toDevManifest } from '../src/common/build.js';
import { loadSettings, mergeSettings, saveSettings } from '../src/common/settingsStore.ts';
import { commitTags, filterSettingsPatch, mergeFilterPatch, parseSalaryMinK, removeLastTag } from '../src/pages/options/filterForm.js';
import { normalizeResponse, matchPlatformApi, parseSalary, jobKeyFromPageUrl, preferDetailJobKey, detailUidDecision, acceptedHintJobId, captureKeyNotes } from '../src/common/platforms.js';
import {
  ENSURE_DESC_GAP_MS, ENSURE_DESC_TIMEOUT_MS, createEnsureQueue, ensureGapWait, filterCapturedJobs,
  hasJobDescription, jobNeedsDescription, runEnsureDescription, shouldReuseMatchCache,
  decideOpenOriginal, acceptDetailScrape, patchExistingDescription, jobKeyFromUid, cleanDetailText, DETAIL_TEXT_MIN,
  scoreGate, missingDescriptionMatch, missingDescriptionError, runIsolatedBatch,
} from '../src/common/ensureDescription.js';
import {
  appendCaptureEntry, appendCaptureLog, captureApiKind, captureLogJson, classifyBossDrop, emptyCaptureLog, ensureLogEntry, loadCaptureLog, sanitizeCaptureEntry,
} from '../src/common/captureLog.js';
import { loadJobs, mergeJobs, setJobMatch } from '../src/common/jobsStore.ts';
import { appendDealbreaker, appendPreferenceNote, emptyProfile, scoreProfile, sanitizeProfile, mergeDraft, getDealbreakers, updateDealbreakers } from '../src/common/profile.js';
import { pickActiveProvider, profileFingerprint, withProfileFp } from '../src/common/profileFingerprint.js';
import {
  MAX_PROFILE_IMPORT_BYTES, applyProfileDraft, assertFilesWithinLimit, combineMaterialExtracts, parseProfileJson, planJsonFile, planResumeFiles,
} from '../src/common/profileImport.js';
import { evaluateJob, applyFilters, autoScoreUids } from '../src/common/filters.js';
import {
  analysisEmptyMessage, analysisGrade, analysisSummary, analysisTargets, analysisUsesForce, descriptionGap, exclusionReasons, filterVisibleJobs, flowEntryLabel, flowStatusLabel, FRESH_CAPSULE_MS, FRESH_MARK_VISIBLE_MS, isCompleteAnalysis, jobDescriptionText, librarySurface, noteCapturedJobs, returnFocusTarget, riskLines, shouldReturnToListAfterDelete, warningZone,
} from '../src/pages/sidepanel/browseModel.js';
import { BOSS_BROWSE_URL, jobsForLibrary } from '../src/pages/sidepanel/librarySource.js';
import {
  canExpandNodes, confirmPending, confirmedNodes, defaultBaseline, groupChatDays, ignorePending, isGreetGateOpen, nextChip,
  railSteps, sanitizeComm, suggestionFromChip, suggestionFromDemand, syncLabel,
} from '../src/pages/sidepanel/commTab.js';
import { createConfirmQueue, splitConfirmCopy } from '../src/pages/sidepanel/confirmQueue.js';
import {
  QUEUE_PREVIEW, SUCCESS_HOLD_MS, batchCounts, cancelRemaining, cardCopy, drawerModel, emptyBatch, enqueueBatch, estimateMinutes, finishPhase, retryFailed, settle as settleItem, stripModel, takeNext, visibleSections,
} from '../src/pages/sidepanel/batchQueue.js';
import { validateProvider, providerFromPreset, isProviderUsable, PRESETS, PROTOCOLS } from '../src/common/ai/providers.js';
import {
  formatConnectionResult, formatElapsed, formatModelsResult, initialSelectedId, parseExtraHeaders, providerHost, providerMeta, removeProviderState,
} from '../src/pages/options/aiState.js';
import { sanitizeMatch, scoreToVerdict, normalizeGreetings, normalizeDims, sanitizeTailor, buildMatchPrompt, buildSuggestReplyPrompt, sanitizeSuggestReply, replyEchoesInstruction } from '../src/common/ai/prompts.js';
import { redactText } from '../src/common/ai/privacy.js';
import {
  parseVersion, compareVersions, parseRelease, extensionIdFromKey, packageManifestError, isSameInstall, safeEntryPath, planWrites, unzipGuard, toHex, staleAssets,
  RELEASE_API, RELEASES_API, NO_PREVIEW_MESSAGE, AHEAD_OF_STABLE_MESSAGE,
  normalizeUpdateChannel, releaseRequest, selectPreviewRelease, resolvePreviewCheck, assessUpdate,
  changelogTitle, changelogSummary, changelogBullets, changelogSections, formatChangelogWhen, isCurrentChangelogVersion, changelogEntries, RELEASES_PAGE,
} from '../src/common/update.js';

// 内容脚本是 TypeScript 写的 IIFE，不能 import。测试里先转成 JS 再放进 vm 跑。
function runtimeScript(rel) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), rel);
  return transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts' }).code;
}

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
test('无关 URL 不命中', () => {
  assert.equal(matchPlatformApi('https://www.baidu.com/s?wd=x'), null);
});
test('BOSS 详情/卡片 URL 按详情命中，推荐列表仍是列表', () => {
  const detailUrls = [
    ['https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=s&encryptJobId=a', 'detail'],
    ['https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/detail.json?securityId=s', 'detail'],
    ['https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=s&lid=l', 'detail'],
    ['https://www.zhipin.com/wapi/zpgeek/geek/job/detail.json?encryptJobId=a', 'detail'],
    ['https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1', 'list'],
    ['https://www.zhipin.com/wapi/zpgeek/search/joblist.json?page=1', 'list'],
  ];
  for (const [url, kind] of detailUrls) {
    const hit = matchPlatformApi(url);
    assert.equal(hit && hit.platform, 'boss', url);
    assert.equal(hit && hit.kind, kind, url);
  }
  assert.equal(matchPlatformApi('https://www.zhipin.com/wapi/zpgeek/friend/add.json'), null);
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
  assert.equal(j.description, '', '列表不写 JD');
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
test('打开原岗位时，页面路径上的 id 盖过响应体里的纯数字 id', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { jobId: '12345', jobName: '前端', postDescription: '岗位职责：页面里的描述' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC',
    pageUrl: 'https://www.zhipin.com/job_detail/ENCRYPT_PAGE.html',
  })[0];
  assert.equal(j.uid, 'boss:ENCRYPT_PAGE');
  assert.equal(j.jobId, 'ENCRYPT_PAGE');
  assert.ok(j.description.includes('页面里的描述'));
});
test('详情页上另一条非数字 id 仍信响应体，查询参数仍优先于页面', () => {
  const other = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', jobName: '相关岗位', postDescription: '岗位职责：相关' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC',
    pageUrl: 'https://www.zhipin.com/job_detail/PAGE_KEY.html',
  })[0];
  assert.equal(other.uid, 'boss:OTHER_ENCRYPT');
  const query = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { encryptId: 'BODY_KEY', jobName: 'X' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=URL_KEY',
    pageUrl: 'https://www.zhipin.com/job_detail/PAGE_KEY.html',
  })[0];
  assert.equal(query.uid, 'boss:URL_KEY');
  assert.equal(jobKeyFromPageUrl('https://www.zhipin.com/job_detail/PAGE_KEY.html'), 'PAGE_KEY');
  assert.equal(preferDetailJobKey('', 'PAGE_KEY', '99'), 'PAGE_KEY');
  assert.equal(preferDetailJobKey('URL_KEY', 'PAGE_KEY', '99'), 'URL_KEY');
  assert.equal(preferDetailJobKey('', '', '12345', 'ENCRYPT_CLICK'), 'ENCRYPT_CLICK');
  assert.equal(preferDetailJobKey('', 'PAGE_KEY', '12345', 'ENCRYPT_CLICK'), 'PAGE_KEY');
  assert.equal(preferDetailJobKey('', '', 'OTHER_ENCRYPT', 'ENCRYPT_CLICK'), 'OTHER_ENCRYPT');
  assert.equal(preferDetailJobKey('', '', '12345', 'https://evil.example/job'), '12345');
  const mismatch = detailUidDecision({ bodyKey: 'OTHER_ENCRYPT', hintKey: 'ENCRYPT_CLICK' });
  assert.equal(mismatch.rejected, true);
  assert.equal(mismatch.reason, 'uid-mismatch');
  assert.equal(mismatch.jobId, 'OTHER_ENCRYPT');
  assert.notEqual(mismatch.jobId, 'ENCRYPT_CLICK');
  const hinted = detailUidDecision({ bodyKey: '12345', hintKey: 'ENCRYPT_CLICK' });
  assert.equal(hinted.hintApplied, true);
  assert.equal(hinted.rejected, false);
  assert.equal(hinted.jobId, 'ENCRYPT_CLICK');
  assert.equal(acceptedHintJobId('ENCRYPT_CLICK', 'ENCRYPT_CLICK'), '');
  assert.equal(acceptedHintJobId('ENCRYPT_CLICK', ''), 'ENCRYPT_CLICK');
});
test('列表抽屉只有数字 id 时，点卡 hint 把 JD 写回原 uid', () => {
  const pageUrl = 'https://www.zhipin.com/web/geek/job?city=101280600';
  const url = 'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC';
  const payload = {
    code: 0,
    zpData: { jobCard: { jobId: '12345', jobName: '前端', postDescription: '岗位职责：抽屉里的描述足够长' } },
  };
  const missed = normalizeResponse('boss', payload, { url, pageUrl })[0];
  assert.equal(missed.uid, 'boss:12345');
  const aligned = normalizeResponse('boss', payload, { url, pageUrl, hintJobId: 'ENCRYPT_CLICK' })[0];
  assert.equal(aligned.uid, 'boss:ENCRYPT_CLICK');
  assert.ok(aligned.description.includes('抽屉里的描述'));
  const notes = captureKeyNotes('boss', payload, { url, pageUrl, hintJobId: 'ENCRYPT_CLICK' });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'uid-hint');
  assert.equal(notes[0].uid, 'boss:ENCRYPT_CLICK');
  assert.equal(notes[0].bodyKey, '12345');
  assert.equal(JSON.stringify(notes).includes('抽屉'), false);
  const refused = normalizeResponse('boss', payload, { url, pageUrl, hintJobId: acceptedHintJobId('ENCRYPT_CLICK', 'ENCRYPT_CLICK') })[0];
  assert.equal(refused.uid, 'boss:12345');
  const other = {
    code: 0,
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', postDescription: '岗位职责：别的岗位正文' } },
  };
  const otherNotes = captureKeyNotes('boss', other, { hintJobId: 'ENCRYPT_CLICK' });
  assert.equal(otherNotes[0].reason, 'uid-mismatch');
  assert.equal(otherNotes[0].uid, 'boss:OTHER_ENCRYPT');
  assert.equal(JSON.stringify(otherNotes).includes('别的岗位'), false);
  const kept = normalizeResponse('boss', other, { hintJobId: 'ENCRYPT_CLICK' })[0];
  assert.equal(kept.uid, 'boss:OTHER_ENCRYPT');
});

// ---------- BOSS 列表抽屉 job/card ----------
section('BOSS 卡片归一化（boss_job_card.sample.json）');
const bossCardEnvelope = loadFixture('boss_job_card.sample.json');
const bossCardJobs = normalizeResponse('boss', bossCardEnvelope, {
  url: 'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC_SAMPLE_CARD&lid=LID_CARD_1',
});
test('卡片解析出 1 条且写入 JD', () => {
  assert.equal(bossCardJobs.length, 1);
  const j = bossCardJobs[0];
  assert.equal(j.uid, 'boss:SAMPLE_BOSS_CARD_1');
  assert.equal(j.jobId, 'SAMPLE_BOSS_CARD_1');
  assert.equal(j.title, '前端工程师');
  assert.equal(j.company, '示例卡片科技');
  assert.equal(j.city, '杭州');
  assert.equal(j.district, '西湖区·西溪');
  assert.deepEqual([j.salaryMinK, j.salaryMaxK], [20, 35]);
  assert.deepEqual(j.skills, ['React', 'TypeScript']);
  assert.equal(j.hrName, '示例经理');
  assert.ok(j.description.includes('岗位职责'), '卡片 postDescription 写入 description');
  assert.ok(j.description.includes('前端开发'));
  assert.equal(j.raw.securityId, 'SEC_SAMPLE_CARD');
  assert.equal(j.raw.lid, 'LID_CARD_1');
});
test('卡片 jobDesc 同样映射为 description', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobCard: { encryptJobId: 'CARD_DESC', jobName: '测试岗', jobDesc: '岗位职责：维护示例系统' } },
  })[0];
  assert.ok(j.description.includes('维护示例系统'));
});
test('卡片空 JD 被剔除，避免回盖已有描述', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobCard: { encryptJobId: 'CARD_EMPTY', jobName: '测试岗', postDescription: '  ' } },
  })[0];
  assert.equal(j.uid, 'boss:CARD_EMPTY');
  assert.ok(!('description' in j));
});
test('卡片 uid 优先用 URL 的 encryptJobId', () => {
  const j = normalizeResponse('boss', bossCardEnvelope, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/card.json?encryptJobId=URL_CARD',
  })[0];
  assert.equal(j.uid, 'boss:URL_CARD');
});
test('jobDetail 正文包映射为 description', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobDetail: { encryptJobId: 'DETAIL_PACK', jobName: '详情岗', content: '岗位职责：编写示例接口' } },
  })[0];
  assert.equal(j.uid, 'boss:DETAIL_PACK');
  assert.ok(j.description.includes('编写示例接口'));
});
test('列表与卡片同一 uid 时保留卡片 JD', () => {
  const jobs = normalizeResponse('boss', {
    code: 0,
    zpData: {
      jobList: [{ encryptJobId: 'SAMPLE_BOSS_CARD_1', jobName: '列表名', brandName: '列表公司', salaryDesc: '10-20K' }],
      jobCard: bossCardEnvelope.zpData.jobCard,
    },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].uid, 'boss:SAMPLE_BOSS_CARD_1');
  assert.ok(jobs[0].description.includes('岗位职责'));
  assert.equal(jobs[0].company, '示例卡片科技');
});
await testAsync('mergeJobs 用卡片 JD 补全列表岗位，之后的空 JD 不回盖', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = memoryChrome();
  try {
    const listed = normalizeResponse('boss', {
      code: 0,
      zpData: { jobList: [{ ...bossRaw[0], encryptJobId: 'SAMPLE_BOSS_CARD_1', jobName: '列表名' }] },
    });
    assert.equal(listed[0].description, '');
    const first = await mergeJobs(listed);
    assert.equal(first.added, 1);
    const opened = await mergeJobs(normalizeResponse('boss', bossCardEnvelope));
    assert.equal(opened.updated, 1);
    const filled = opened.jobs.find((job) => job.uid === 'boss:SAMPLE_BOSS_CARD_1');
    assert.ok(filled.description.includes('岗位职责'));
    assert.equal(filled.savedAt, first.jobs[0].savedAt);
    const again = await mergeJobs(normalizeResponse('boss', {
      code: 0,
      zpData: { jobCard: { encryptJobId: 'SAMPLE_BOSS_CARD_1', jobName: '列表名', postDescription: '' } },
    }));
    const kept = again.jobs.find((job) => job.uid === 'boss:SAMPLE_BOSS_CARD_1');
    assert.ok(kept.description.includes('岗位职责'));
  } finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
});

// ---------- MAIN world 嗅探 URL ----------
section('BOSS 嗅探 URL');
function installSniffer(options = {}) {
  const posts = [];
  const listeners = [];
  const location = {
    href: 'https://www.zhipin.com/web/geek/recommend',
    origin: 'https://www.zhipin.com',
  };
  const fakeWindow = {
    location,
    postMessage(data, origin) { posts.push({ data, origin }); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    fetch: typeof options.fetch === 'function'
      ? options.fetch
      : async () => ({ clone: () => ({ json: async () => ({ code: 0, zpData: {} }) }) }),
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function open() {};
  XMLHttpRequest.prototype.send = function send() {};
  const ctx = { window: fakeWindow, location, URL, XMLHttpRequest };
  vm.runInNewContext(
    runtimeScript('../src/content/sniffer.ts'),
    ctx,
  );
  return {
    posts,
    fetch: fakeWindow.fetch,
    replay() {
      for (const fn of listeners) {
        fn({ source: fakeWindow, data: { source: 'job-helper:sniffer', type: 'replay-request' } });
      }
    },
  };
}
async function sniffedUrls(urls) {
  const { posts, fetch } = installSniffer();
  for (const url of urls) {
    await fetch(url);
    await Promise.resolve();
    await Promise.resolve();
  }
  return posts.map((item) => item.data.url);
}
await testAsync('嗅探命中推荐详情、卡片和原有列表，不命中无关接口', async () => {
  const urls = await sniffedUrls([
    'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/detail.json?securityId=s',
    'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=s&lid=l',
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=a',
    'https://www.zhipin.com/wapi/zpgeek/geek/job/detail.json?encryptJobId=a',
    'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1',
    'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?page=1',
    'https://www.zhipin.com/wapi/zpgeek/friend/add.json',
    'https://www.zhipin.com/wapi/zpCommon/data/city.json',
  ]);
  assert.deepEqual(urls, [
    'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/detail.json?securityId=s',
    'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=s&lid=l',
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=a',
    'https://www.zhipin.com/wapi/zpgeek/geek/job/detail.json?encryptJobId=a',
    'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1',
    'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?page=1',
  ]);
});
await testAsync('collector 挂上之前嗅到的详情可以重放，且不会把队列越放越大', async () => {
  const sniffed = installSniffer();
  await sniffed.fetch('https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=a');
  await Promise.resolve();
  await Promise.resolve();
  const before = sniffed.posts.length;
  sniffed.replay();
  sniffed.replay();
  const replayed = sniffed.posts.slice(before).map((item) => item.data.url);
  assert.deepEqual(replayed, [
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=a',
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=a',
  ]);
});
await testAsync('非 JSON 只上报 drop，不带响应正文，也不进入重放', async () => {
  const sniffed = installSniffer({
    fetch: async () => ({ clone: () => ({ json: async () => { throw new Error('not json'); } }) }),
  });
  await sniffed.fetch('https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SECRET');
  await Promise.resolve();
  await Promise.resolve();
  const drops = sniffed.posts.filter((item) => item.data.type === 'sniff-drop');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].data.reason, 'non-json');
  assert.equal(drops[0].data.payload, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(drops[0].data, 'payload'), false);
  sniffed.replay();
  assert.equal(sniffed.posts.filter((item) => item.data.type === 'sniff-drop').length, 1);
  const entry = sanitizeCaptureEntry({
    kind: 'sniff-drop',
    reason: 'non-json',
    api: captureApiKind(drops[0].data.url),
    url: drops[0].data.url,
  });
  assert.equal(entry.api, 'card');
  assert.equal(entry.url, undefined);
  assert.equal(JSON.stringify(entry).includes('SECRET'), false);
});

section('BOSS 详情请求被当成当前岗位');
function installCollector(hostname, href) {
  const sent = [];
  const listeners = [];
  const timers = [];
  const links = new Map();
  const chromeListeners = [];
  const location = { href: href || `https://${hostname}/web/geek/recommend`, hostname, origin: `https://${hostname}` };
  const fakeWindow = {
    location,
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
    postMessage: (data) => sent.push({ type: 'window', data }),
  };
  const ctx = {
    window: fakeWindow,
    location,
    URL,
    document: {
      createElement: () => ({ className: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector: () => ({ textContent: '' }), remove() {} }),
      body: { appendChild() {} },
      documentElement: {},
      head: { appendChild() {} },
      getElementById: () => null,
      querySelector: (sel) => links.get(sel) || null,
      querySelectorAll: (sel) => (links.has(sel) ? [links.get(sel)] : []),
    },
    MutationObserver: class { observe() {} },
    Date,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    chrome: {
      runtime: {
        sendMessage: (msg) => { sent.push(msg); return Promise.resolve(); },
        onMessage: { addListener(fn) { chromeListeners.push(fn); } },
      },
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(
    runtimeScript('../src/content/collector.ts'),
    ctx,
  );
  return {
    sent,
    emit(url, payload, extra) {
      for (const fn of listeners) {
        fn({ source: fakeWindow, data: { source: 'job-helper:sniffer', platform: 'boss', url, payload, ...extra } });
      }
    },
    links,
    chromeListeners,
    runLastTimer() {
      const fn = timers.pop();
      if (fn) fn();
    },
  };
}
test('推荐详情和卡片上报当前岗位，推荐列表不上报', () => {
  const boss = installCollector('www.zhipin.com');
  boss.emit('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/detail.json?securityId=s', {
    zpData: { jobInfo: { encryptId: 'REC_JOB' } },
  });
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=s&lid=l', {
    zpData: { jobCard: { encryptJobId: 'CARD_JOB', postDescription: '岗位职责：示例' } },
  });
  boss.emit('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1', {
    zpData: { jobList: [] },
  });
  const current = boss.sent.filter((msg) => msg.type === 'CURRENT_JOB').map((msg) => msg.jobKey);
  const captured = boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').map((msg) => msg.url);
  assert.deepEqual(current, ['REC_JOB', 'CARD_JOB']);
  assert.equal(captured.length, 3);
  assert.ok(captured[2].includes('recommend/job/list'));
  assert.equal(boss.sent.find((msg) => msg.type === 'JOBS_CAPTURED').pageUrl, 'https://www.zhipin.com/web/geek/recommend');
  assert.equal(boss.sent.find((msg) => msg.type === 'window').data.type, 'replay-request');
  boss.emit('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?page=1', {
    zpData: { jobList: [] },
  }, { replay: true });
  assert.equal(boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').length, 3);
});
test('详情页把页面上的岗位 id 交给当前岗位，并点开对应列表卡', () => {
  const boss = installCollector('www.zhipin.com', 'https://www.zhipin.com/job_detail/PAGE_KEY.html');
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC', {
    zpData: { jobInfo: { jobId: '12345', postDescription: '岗位职责：页面里的描述' } },
  });
  const current = boss.sent.filter((msg) => msg.type === 'CURRENT_JOB').map((msg) => msg.jobKey);
  assert.deepEqual(current, ['PAGE_KEY']);
  assert.equal(boss.sent.find((msg) => msg.type === 'JOBS_CAPTURED').pageUrl, 'https://www.zhipin.com/job_detail/PAGE_KEY.html');
  const link = {
    clicked: false,
    click() { link.clicked = true; },
    getBoundingClientRect: () => ({ width: 180, height: 48 }),
  };
  boss.links.set('a[href*="job_detail/PAGE_KEY"]', link);
  let response = null;
  const handled = boss.chromeListeners[0]({ type: 'FETCH_JOB_CARD', jobId: 'PAGE_KEY' }, {}, (value) => { response = value; });
  assert.equal(handled, true);
  assert.deepEqual(response, { ok: true, clicked: true });
  assert.equal(link.clicked, false);
  boss.runLastTimer();
  assert.equal(link.clicked, true);
});
test('点卡 hint 遇到另一条非数字 id 时拒绝并留给下一条', () => {
  const boss = installCollector('www.zhipin.com', 'https://www.zhipin.com/web/geek/job?city=101280600');
  const link = {
    clicked: false,
    click() { link.clicked = true; },
    getBoundingClientRect: () => ({ width: 180, height: 48 }),
  };
  boss.links.set('a[href*="job_detail/ENCRYPT_CLICK"]', link);
  boss.chromeListeners[0]({ type: 'FETCH_JOB_CARD', jobId: 'ENCRYPT_CLICK' }, {}, () => {});
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC', {
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', postDescription: '岗位职责：别的岗位正文不应绑到点卡' } },
  });
  const first = boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').at(-1);
  assert.equal(first.hintJobId, undefined);
  assert.equal(first.hintRejected, 'ENCRYPT_CLICK');
  assert.equal(JSON.stringify(first).includes('别的岗位正文'), true);
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC', {
    zpData: { jobCard: { jobId: '12345', postDescription: '岗位职责：抽屉正文足够长' } },
  });
  const second = boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').at(-1);
  assert.equal(second.hintJobId, 'ENCRYPT_CLICK');
  assert.equal(second.hintRejected, undefined);
});
test('非 JSON drop 转发时不带正文', () => {
  const boss = installCollector('www.zhipin.com');
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SECRET', {
    postDescription: '秘密正文',
  }, { type: 'sniff-drop', reason: 'non-json' });
  const msg = boss.sent.find((item) => item.sniffDrop === 'non-json');
  assert.ok(msg);
  assert.equal(msg.payload, undefined);
  assert.equal(JSON.stringify(msg).includes('秘密正文'), false);
  assert.equal(classifyBossDrop('boss', { code: 37, message: '失败', zpData: { jobInfo: { postDescription: '不应落盘的正文' } } }).code, '37');
  assert.equal(classifyBossDrop('boss', { code: 0, zpData: {} }), null);
  assert.equal(normalizeResponse('boss', { code: 37, zpData: { jobList: [] } }).length, 0);
  const logged = sanitizeCaptureEntry({
    kind: 'sniff-drop',
    reason: 'code',
    code: '37',
    api: captureApiKind('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SECRET'),
    description: '不应落盘的正文',
  });
  assert.equal(logged.reason, 'code');
  assert.equal(logged.code, '37');
  assert.equal(logged.api, 'detail');
  assert.equal(logged.description, undefined);
  assert.equal(JSON.stringify(logged).includes('SECRET'), false);
  assert.equal(JSON.stringify(logged).includes('不应落盘'), false);
});

// ---------- 未知平台 / 失败信封 ----------
section('归一化失败信封');
test('未注册平台返回空', () => {
  assert.equal(normalizeResponse('unknown', { status: '1' }).length, 0);
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

test('可以接受的说明追加进画像备注，不改字段、不重复', () => {
  assert.equal(appendPreferenceNote('', '  可以接受异地  '), '可以接受异地');
  assert.equal(appendPreferenceNote('已有说明', '可以接受异地'), '已有说明\n可以接受异地');
  assert.equal(appendPreferenceNote('已有说明\n可以接受异地', '可以接受异地'), '已有说明\n可以接受异地');
  assert.equal(appendPreferenceNote('已有说明', '   '), '已有说明');
  const saved = sanitizeProfile({ preference: { notes: appendPreferenceNote('保留', '可以接受：城市不在目标范围'), dealbreakers: ['出差'] } });
  assert.equal(saved.preference.notes, '保留\n可以接受：城市不在目标范围');
  assert.deepEqual(saved.preference.dealbreakers, ['出差']);
});

test('匹配提示要求尊重画像里已经接受的事项', () => {
  const profile = emptyProfile();
  profile.preference.notes = '可以接受：城市不在目标范围';
  const system = buildMatchPrompt(profile, { title: '前端' })[0].content;
  assert.ok(system.includes('preference.notes'));
  assert.ok(system.includes('可以接受'));
  assert.ok(system.includes('不要写入 risks'));
});

test('不喜欢的整句写入雷点，不进可以接受的备注，也不按顿号拆开', () => {
  const pref = { avoidKeywords: ['外包'], dealbreakers: ['大小周'], notes: '可以接受异地' };
  const next = appendDealbreaker(pref, '  太偏销售、不要驻场  ');
  assert.deepEqual(next.avoidKeywords, ['外包']);
  assert.deepEqual(next.dealbreakers, ['大小周', '太偏销售、不要驻场']);
  assert.equal(next.notes, '可以接受异地');
  assert.deepEqual(getDealbreakers(next), ['大小周', '太偏销售、不要驻场', '外包']);
  const again = appendDealbreaker(next, '太偏销售、不要驻场');
  assert.deepEqual(again.dealbreakers, ['大小周', '太偏销售、不要驻场']);
  assert.equal(appendDealbreaker(pref, '   ').notes, '可以接受异地');
  assert.deepEqual(appendDealbreaker(pref, '  ').dealbreakers, ['大小周']);
  const saved = sanitizeProfile({ preference: appendDealbreaker(pref, '太偏销售、不要驻场') });
  assert.deepEqual(saved.preference.dealbreakers, ['大小周', '太偏销售、不要驻场']);
  assert.equal(saved.preference.notes, '可以接受异地');
  const profile = emptyProfile();
  profile.preference = appendDealbreaker(profile.preference, '太偏销售、不要驻场');
  const user = buildMatchPrompt(profile, { title: '销售驻场', description: '需要驻场销售' })[1].content;
  assert.ok(user.includes('太偏销售、不要驻场'));
  assert.ok(!user.includes('不喜欢：'));
  assert.equal(profile.preference.notes, '');
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
  const ui = fs.readFileSync(path.join(root, 'src/pages/options/AiTab.tsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/common/ai/client.ts'), 'utf8');
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
test('预览列表按版本号取最高的带 zip prerelease，没有则暂无预览版', () => {
  const zip = (tag) => ({ name: 'a.zip', browser_download_url: `https://github.com/DikkooXie/job-filter-assistant/releases/download/${tag}/a.zip` });
  const pre = (tag, over = {}) => release({ tag_name: tag, prerelease: true, assets: [zip(tag)], ...over });
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
  assert.equal(selectPreviewRelease([draft, stable, noZip, ...githubOrder]).version, '1.0.3.10');
  assert.equal(selectPreviewRelease([githubOrder[3], githubOrder[0]]).version, '1.0.3.10');
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
  assert.equal(stable[0].version, '1.0.3');
  assert.equal(stable[0].title, '固定文件名');
  assert.equal(stable[0].summary, '更新机制的 说明 代码');
  assert.equal(stable[0].prerelease, false);
  assert.equal(stable[0].pageUrl, list[1].html_url);
  const preview = changelogEntries(list, 'nope');
  assert.deepEqual(preview.map((item) => item.version), ['1.0.3']);
  const withPreview = changelogEntries(list, 'preview');
  assert.deepEqual(withPreview.map((item) => item.version), ['1.0.3.7', '1.0.3']);
  assert.equal(withPreview[0].title, '');
  assert.equal(withPreview[0].summary, '预览：列表抽屉');
  assert.deepEqual(withPreview[0].bullets, ['列表抽屉']);
  assert.deepEqual(withPreview[0].sections, { added: [], ui: [], fixed: [] });
  assert.equal(withPreview[0].prerelease, true);
  assert.equal(withPreview[0].publishedAt, '2026-11-04T07:26:09Z');
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
  assert.equal(sorted[0].version, '1.0.3.11');
  assert.deepEqual(sorted.map((item) => item.version), ['1.0.3.11', '1.0.3.9']);
  assert.deepEqual(changelogEntries(githubStringOrder, 'stable'), []);

  const missingTime = [
    release({ tag_name: 'v1.0.3.9', name: 'v1.0.3.9', prerelease: true, published_at: '', body: '九' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, body: '十一' }),
  ];
  assert.equal(changelogEntries(missingTime, 'preview')[0].version, '1.0.3.11');
  assert.deepEqual(changelogEntries(missingTime, 'preview').map((item) => item.version), ['1.0.3.11', '1.0.3.9']);

  const equalTime = [
    release({ tag_name: 'v1.0.3.9', name: 'v1.0.3.9', prerelease: true, published_at: '2026-11-04T08:00:00Z' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, published_at: '2026-11-04T08:00:00Z' }),
  ];
  assert.equal(changelogEntries(equalTime, 'preview')[0].version, '1.0.3.11');

  const invalidTime = [
    release({ tag_name: 'v1.0.3.2', name: 'v1.0.3.2', prerelease: true, published_at: 'not-a-date' }),
    release({ tag_name: 'v1.0.3.11', name: 'v1.0.3.11', prerelease: true, published_at: 'also-bad' }),
  ];
  assert.equal(changelogEntries(invalidTime, 'preview')[0].version, '1.0.3.11');
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
  const pad = (value) => String(value).padStart(2, '0');
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
  assert.deepEqual(listed[0].sections, { added: [], ui: ['列表更清晰'], fixed: [] });
  assert.deepEqual(listed[0].sections.added, []);
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
  const fakeWindow = {
    addEventListener: (type, fn) => type === 'message' && listeners.message.push(fn),
    postMessage() {},
  };
  const ctx = {
    window: fakeWindow,
    location: { href: 'https://example.com/', hostname: 'example.com', origin: 'https://example.com' },
    URL,
    document: {
      createElement: makeEl,
      body: { appendChild: (el) => { appended.push(el); return el; } },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    MutationObserver: class { observe() {} },
    Date,
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
  vm.runInNewContext(runtimeScript('../src/content/collector.ts'), ctx);
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
const { createSaveQueue } = await import('../src/pages/options/saveQueue.ts');

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
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/options/OptionsApp.tsx'), 'utf8');
  assert.match(src, /enqueue\('settings',[\s\S]*?,\s*200\)/);
  assert.match(src, /enqueue\('profile',[\s\S]*?,\s*600\)/);
  assert.match(src, /enqueue\('providers',[\s\S]*?,\s*500\)/);
  assert.doesNotMatch(src, /import\(/);
  const queueSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/options/saveQueue.ts'), 'utf8');
  assert.match(queueSrc, /pagehide/);
  assert.match(queueSrc, /beforeunload/);
  assert.doesNotMatch(queueSrc, /import\(/);
});

const { pageFromHash, isUpdatedHash, isChangelogHash, changelogReturnTarget, nextNavIndex, SETTINGS_PAGES, optionsUrlHash, sectionTargetId } = await import('../src/pages/options/pageHash.js');
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
  assert.equal(pageFromHash('#changelog'), 'profile');
  assert.equal(pageFromHash('#nope'), 'profile');
  assert.equal(isChangelogHash('#changelog'), true);
  assert.equal(isChangelogHash('#updated'), false);
  assert.equal(isChangelogHash('#general'), false);
  assert.equal(SETTINGS_PAGES.some((page) => page.id === 'changelog'), false);
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(root, 'extension-pages/options.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/options/shell.css'), 'utf8');
  const globals = fs.readFileSync(path.join(root, 'src/pages/globals.css'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/pages/options/OptionsApp.tsx'), 'utf8');
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
  const tab = fs.readFileSync(path.join(root, 'src/pages/options/FiltersTab.tsx'), 'utf8');
  const options = fs.readFileSync(path.join(root, 'src/pages/options/OptionsApp.tsx'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/common/settingsStore.ts'), 'utf8');
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

const { summarizeJobs } = await import('../src/pages/options/jobStats.js');
test('岗位库数量只统计列表和收藏', () => {
  assert.deepEqual(summarizeJobs(null), { total: 0, starred: 0 });
  assert.deepEqual(summarizeJobs([{ star: true }, { star: false }, {}, null]), { total: 4, starred: 1 });
});

test('通用与隐私页保留原设置字段，并用岗位列表统计数量', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const page = fs.readFileSync(path.join(root, 'src/pages/options/GeneralTab.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/options/general.css'), 'utf8');
  for (const key of ['autoCapture', 'autoScore', 'showBadge', 'dedupe', 'maxJobs', 'redactPII', 'sendCompanyName', 'confirmBeforeSend']) {
    assert.match(page, new RegExp(key));
  }
  assert.match(page, /JOB_LIST_REQUEST/);
  assert.match(page, /跟随当前网站/);
  assert.match(page, /只用 BOSS 直聘/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /type="radio"/);
  assert.match(page, /gen-update-slot/);
  assert.match(page, /UpdatePanel/);
  assert.match(page, /updateChannel/);
  const panel = fs.readFileSync(path.join(root, 'src/pages/options/UpdatePanel.tsx'), 'utf8');
  const updater = fs.readFileSync(path.join(root, 'src/extension/update.ts'), 'utf8');
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

test('列表警示区：过滤命中只露红 chip，普通警示才计数，没有条目就不出现', () => {
  assert.equal(warningZone({}), null);
  assert.equal(warningZone({ match: { summary: '只有摘要', risks: [] }, _filter: { keep: true, risks: [], reasons: ['经验档位不在偏好内'] } }), null);
  const warnOnly = { _filter: { keep: true, risks: ['销售', '驻场'], reasons: [] }, match: { risks: ['学历要求硕士，高于当前画像'] } };
  assert.deepEqual(warningZone(warnOnly), {
    chip: 'warn',
    label: '含 3 项警示',
    items: [
      { kind: 'warn', text: '含「销售」，沟通时确认相关安排' },
      { kind: 'warn', text: '含「驻场」，沟通时确认相关安排' },
      { kind: 'warn', text: '学历要求硕士，高于当前画像' },
    ],
  });
  const both = {
    _filter: { keep: false, risks: ['驻场'], reasons: ['命中排除词：驻场'] },
    match: { risks: ['学历要求硕士，高于当前画像'] },
  };
  const zone = warningZone(both);
  assert.equal(zone.chip, 'filter');
  assert.equal(zone.label, '命中过滤条件');
  assert.deepEqual(zone.items.map((item) => item.kind), ['filter', 'warn', 'warn']);
  assert.equal(zone.items[0].text, '命中排除词：驻场');
  assert.equal(warningZone({ _filter: { keep: false, risks: [], reasons: ['城市不匹配'] } }).label, '命中过滤条件');
});

test('列表卡片把警示区放进分析框，摘要两行省略，操作行结构仍在', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
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
  const fromEmpty = noteCapturedJobs({ ready: true, seen: new Set(), fresh: new Set() }, [{ uid: 'n' }, { title: '无标识' }]);
  assert.deepEqual(fromEmpty.arrived, ['n']);
  assert.equal(FRESH_CAPSULE_MS, 8000);
  assert.equal(FRESH_MARK_VISIBLE_MS, 2000);
});

test('智能分析只把未分析岗位交给默认项，强制项覆盖已选', () => {
  const jd = '岗位职责：已有正文';
  const jobs = [
    { uid: 'a', description: jd, match: { score: 90 } },
    { uid: 'b', match: null },
    { uid: 'c' },
    { uid: 'empty', description: '', match: { score: 88, verdict: 'strong' } },
    { title: '没有标识' },
  ];
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

  const current = withProfileFp({ score: 80, summary: '当前画像' }, fp);
  assert.equal(current.profileFp, fp);
  assert.equal(withProfileFp({ score: 1 }, fp).score, 1);
  const untouched = { score: 3 };
  withProfileFp(untouched, fp);
  assert.equal(untouched.profileFp, undefined);

  const jd = '岗位职责：已有正文';
  const jobs = [
    { uid: 'fresh', description: jd, match: null },
    { uid: 'legacy', description: jd, match: { score: 70 } },
    { uid: 'blank', description: jd, match: { score: 50, profileFp: '' } },
    { uid: 'current', description: jd, match: current },
    { uid: 'stale', description: jd, match: withProfileFp({ score: 40 }, moved) },
    { title: '没有标识', description: jd, match: { profileFp: 'nope' } },
  ];
  assert.deepEqual(analysisTargets(jobs, 'fingerprint', fp).map((job) => job.uid), ['fresh', 'legacy', 'blank', 'stale']);
  assert.deepEqual(analysisTargets([{ uid: 'current', description: jd, match: current }], 'fingerprint', fp), []);
  assert.deepEqual(analysisTargets(jobs, 'fingerprint', moved).map((job) => job.uid), ['fresh', 'legacy', 'blank', 'current']);
  assert.equal(pickActiveProvider([{ id: 'a', model: 'm1' }, { id: 'b', model: 'm2' }], 'b').model, 'm2');
  assert.equal(pickActiveProvider([{ id: 'a', model: 'm1' }], 'missing').id, 'a');
  assert.equal(pickActiveProvider([], 'a'), null);
  assert.equal(profileFingerprint(profile, pickActiveProvider([{ id: 'a', model: 'demo-model' }], '')), fp);
});

function legacyProfileFingerprint(profile, provider) {
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  assert.equal(analysisGrade({}), null);
  assert.equal(analysisGrade({ verdict: 'good' }), null);
  assert.equal(analysisGrade({ score: '无' }), null);
  assert.deepEqual(analysisGrade({ score: -4 }), { score: 0, filled: 1, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 20 }), { score: 20, filled: 1, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 21 }), { score: 21, filled: 2, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 40 }), { score: 40, filled: 2, tone: 'low', label: '偏低' });
  assert.deepEqual(analysisGrade({ score: 60 }), { score: 60, filled: 3, tone: 'mid', label: '一般' });
  assert.deepEqual(analysisGrade({ score: 62 }), { score: 62, filled: 4, tone: 'mid', label: '沟通确认' });
  assert.deepEqual(analysisGrade({ score: 80 }), { score: 80, filled: 4, tone: 'mid', label: '沟通确认' });
  assert.deepEqual(analysisGrade({ score: 80.6 }), { score: 81, filled: 5, tone: 'high', label: '匹配' });
  assert.deepEqual(analysisGrade({ score: 86 }), { score: 86, filled: 5, tone: 'high', label: '匹配' });
  assert.deepEqual(analysisGrade({ score: '62' }), { score: 62, filled: 4, tone: 'mid', label: '沟通确认' });
});

test('岗位摘要不造假分，有分析时才给警示计数', () => {
  assert.deepEqual(analysisSummary(null), { grade: null, summary: '', warnLabel: '' });
  assert.deepEqual(analysisSummary({ match: null, _filter: { risks: ['驻场'] } }), { grade: null, summary: '', warnLabel: '' });
  const graded = analysisSummary({
    description: '岗位职责：已有正文',
    match: { score: 42, summary: '有工具经验，城市不足。', risks: ['城市不在目标范围'] },
    _filter: { risks: ['驻场'] },
  });
  assert.equal(graded.grade.label, '一般');
  assert.equal(graded.grade.filled, 3);
  assert.equal(graded.summary, '有工具经验，城市不足。');
  assert.equal(graded.warnLabel, '含 2 项警示');
  assert.equal(analysisSummary({ match: { score: 90, summary: '契合', risks: [] } }).warnLabel, '');
});

test('详情分析 Tab 回吃匹配块，岗位不再挂警示墙', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  assert.equal(takeNext(batch).uid, 'j14');
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
  assert.match(cardCopy(batch, 'j13').label, /正在匹配画像与 JD · 第 13\/80/);
  assert.equal(cardCopy(batch, 'j14').label, '排队中');
  assert.equal(cardCopy(batch, 'j12').hint, '可从队列重试');
  assert.equal(cardCopy(batch, 'j1'), null);
  const cancelled = cancelRemaining(batch);
  assert.equal(cancelled.items.some((item) => item.status === 'queued'), false);
  assert.equal(cancelled.items.some((item) => item.uid === 'j13' && item.status === 'running'), true);
  assert.equal(cancelled.items.some((item) => item.uid === 'j12' && item.status === 'failed'), true);
  const retried = retryFailed(finishPhase(settleItem(cancelled, 'j13', { ok: true })), 'j12');
  assert.equal(retried.phase, 'running');
  assert.equal(retried.items.at(-1).uid, 'j12');
  assert.equal(retried.items.at(-1).status, 'queued');
  const auto = enqueueBatch(emptyBatch(), [{ uid: 'a1', title: '品牌设计师' }], { source: 'auto' });
  const autoRunning = { ...auto, items: auto.items.map((item) => ({ ...item, status: 'running' })) };
  assert.equal(stripModel(autoRunning).auto, true);
  assert.equal(stripModel(autoRunning).label, '1/1 · 分析中');
  assert.match(cardCopy(autoRunning, 'a1').label, /^自动分析 · 正在匹配画像与 JD/);
  assert.equal(cardCopy({ ...auto, items: auto.items.map((item) => ({ ...item, status: 'queued' })) }, 'a1').label, '自动 · 排队中');
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

  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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

section('空 JD 分析前补抓');
test('已有描述或没有定位信息的岗位不补抓，间隔不小于现有限速', () => {
  assert.equal(jobNeedsDescription({ uid: 'boss:0', platform: 'boss', description: '岗位职责：已有', url: 'https://www.zhipin.com/job_detail/0.html' }), false);
  assert.equal(jobNeedsDescription({ uid: 'boss:1', platform: 'boss', description: '  ', jobId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html' }), true);
  assert.equal(jobNeedsDescription({ uid: 'boss:2', description: '' }), false);
  assert.equal(hasJobDescription({ description: '  正文 ' }), true);
  assert.ok(ENSURE_DESC_GAP_MS >= 500);
  assert.ok(ENSURE_DESC_TIMEOUT_MS >= 3000 && ENSURE_DESC_TIMEOUT_MS <= 10000);
  assert.equal(ensureGapWait(0, 5000), 0);
  assert.equal(ensureGapWait(1000, 1200), 300);
  assert.equal(ensureGapWait(1000, 1800), 0);
  const known = filterCapturedJobs(
    [{ uid: 'boss:1', description: '岗位职责：新' }, { uid: 'boss:2', description: '另一条' }],
    [{ uid: 'boss:1', description: '' }],
    false,
  );
  assert.deepEqual(known.map((job) => job.uid), ['boss:1']);
  assert.equal(filterCapturedJobs([{ uid: 'boss:2' }], [], true).length, 1);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: false, hasDescription: true }), false);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: true, hasDescription: true }), true);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: false, hasDescription: false }), false);
  assert.equal(shouldReuseMatchCache({ force: true, cached: { score: 1 }, hadDescription: true, hasDescription: true }), false);
});
await testAsync('补抓优先点卡片，点不到才短开；失败或超时仍把原岗位交回去', async () => {
  const empty = { uid: 'boss:abc', platform: 'boss', jobId: 'abc', description: '', url: 'https://www.zhipin.com/job_detail/abc.html' };
  const calls = [];
  const clicked = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async (ms) => { calls.push(`sleep:${ms}`); },
    clickCard: async () => { calls.push('click'); return true; },
    openUrl: async () => { calls.push('open'); return 7; },
    closeTab: async (id) => { calls.push(`close:${id}`); },
    waitForDescription: async () => ({ ...empty, description: '岗位职责：点卡得到' }),
  }, { lastAt: 0 });
  assert.equal(clicked.action, 'click');
  assert.ok(clicked.job.description.includes('点卡得到'));
  assert.deepEqual(calls, ['click']);

  const opened = [];
  const state = { lastAt: 1000 };
  const timed = await runEnsureDescription(empty, {
    now: () => 1200,
    sleep: async (ms) => { opened.push(`sleep:${ms}`); },
    clickCard: async () => false,
    openUrl: async () => { opened.push('open'); return 9; },
    closeTab: async (id) => { opened.push(`close:${id}`); },
    waitForDescription: async () => empty,
  }, state);
  assert.equal(timed.action, 'timeout');
  assert.equal(timed.job.description, '');
  assert.deepEqual(opened, ['sleep:300', 'open', 'close:9']);
  assert.equal(state.lastAt, 1200);

  const failed = await runEnsureDescription(empty, {
    now: () => 5000,
    sleep: async () => {},
    clickCard: async () => { throw new Error('没有列表'); },
    openUrl: async () => null,
    closeTab: async () => { throw new Error('不应关闭'); },
    waitForDescription: async () => { throw new Error('不应等待'); },
  }, { lastAt: 0 });
  assert.equal(failed.action, 'failed');
  assert.equal(failed.job, empty);

  const scrapeCalls = [];
  let stored = '';
  const scraped = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async () => {},
    clickCard: async () => false,
    openUrl: async () => ({ tabId: 4, close: false }),
    closeTab: async () => { scrapeCalls.push('close'); },
    waitForDescription: async () => (stored ? { ...empty, description: stored } : empty),
    scrapeDetail: async (tabId) => {
      scrapeCalls.push(`scrape:${tabId}`);
      stored = '岗位职责：详情页可见正文足够长';
      return stored;
    },
  }, { lastAt: 0 });
  assert.equal(scraped.action, 'open');
  assert.ok(scraped.job.description.includes('详情页可见正文'));
  assert.deepEqual(scrapeCalls, ['scrape:4']);

  const bare = [];
  const logs = [];
  const unscraped = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async () => {},
    clickCard: async () => { bare.push('click'); return true; },
    openUrl: async () => { bare.push('open'); return null; },
    closeTab: async () => { bare.push('close'); },
    waitForDescription: async () => empty,
    log: async (result) => { logs.push(ensureLogEntry(empty.uid, result)); },
  }, { lastAt: 0 });
  assert.equal(unscraped.action, 'timeout');
  assert.equal(unscraped.scrape, 'skipped');
  assert.equal(unscraped.reason, 'no-scrape');
  assert.deepEqual(bare, ['click', 'open']);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, 'ensure');
  assert.equal(logs[0].scrape, 'skipped');
  assert.equal(logs[0].reason, 'no-scrape');
  assert.equal(logs[0].description, undefined);

  const dom = [];
  const fromClick = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async () => {},
    clickCard: async () => ({ clicked: true, tabId: 3 }),
    openUrl: async () => { dom.push('open'); return 9; },
    closeTab: async (id) => { dom.push(`close:${id}`); },
    waitForDescription: async () => empty,
    scrapeDetail: async (tabId) => {
      dom.push(`scrape:${tabId}`);
      return '岗位职责：点卡后补刮到的正文足够长';
    },
  }, { lastAt: 0 });
  assert.equal(fromClick.action, 'click');
  assert.equal(fromClick.scrape, 'accepted');
  assert.ok(fromClick.job.description.includes('点卡后补刮'));
  assert.deepEqual(dom, ['scrape:3']);

  const crossed = [];
  const afterReject = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async () => {},
    clickCard: async () => ({ clicked: true, tabId: 3 }),
    openUrl: async () => { crossed.push('open'); return { tabId: 8, close: true }; },
    closeTab: async (id) => { crossed.push(`close:${id}`); },
    waitForDescription: async () => empty,
    scrapeDetail: async (tabId) => {
      crossed.push(`scrape:${tabId}`);
      if (tabId === 3) return { text: '', reason: 'page-key-missing' };
      return '岗位职责：短开详情页后补到的正文足够长';
    },
  }, { lastAt: 0 });
  assert.equal(afterReject.action, 'open');
  assert.equal(afterReject.scrape, 'accepted');
  assert.ok(afterReject.job.description.includes('短开详情页'));
  assert.deepEqual(crossed, ['scrape:3', 'open', 'scrape:8', 'close:8']);
});
await testAsync('多次补抓串行，不会同时点开两张卡', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const queued = createEnsureQueue(async (job) => {
    order.push(`start:${job.uid}`);
    if (job.uid === 'a') await gate;
    order.push(`end:${job.uid}`);
    return job;
  });
  const first = queued({ uid: 'a' });
  const second = queued({ uid: 'b' });
  await Promise.resolve();
  assert.deepEqual(order, ['start:a']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b']);
});
test('打分入口在出分前补抓，批量仍串行限速，侧栏订阅岗位库', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const background = fs.readFileSync(path.join(root, 'src/background/background.ts'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const scoreStart = background.indexOf('async function scoreOne');
  const promptAt = background.indexOf('buildMatchPrompt(profile, job', scoreStart);
  const ensureAt = background.indexOf('queueEnsure(job)', scoreStart);
  const gateAt = background.indexOf('scoreGate(job)', scoreStart);
  assert.ok(scoreStart > 0 && ensureAt > scoreStart && gateAt > ensureAt && gateAt < promptAt);
  assert.match(background, /shouldReuseMatchCache\(/);
  assert.match(background, /missingDescriptionError\(/);
  assert.match(background, /scrapeDetail: scrapeEnsuredDetail/);
  assert.match(background, /close: false/);
  assert.match(background, /acceptedHintJobId\(msg\.hintJobId, msg\.hintRejected\)/);
  assert.match(background, /format === 'capture-log'/);
  assert.match(background, /isolateCall\(/);
  const captureStart = background.indexOf('async function onJobsCaptured');
  const captureEnd = background.indexOf('async function sidePanelIsOpen');
  const captureBody = background.slice(captureStart, captureEnd);
  const autoAt = captureBody.indexOf('settings.autoScore');
  assert.ok(autoAt > 0);
  assert.doesNotMatch(captureBody.slice(0, autoAt), /queueEnsure|runEnsureDescription|openJobPage|clickJobCard/);
  const batchStart = background.indexOf('async function scoreBatch');
  const batchEnd = background.indexOf('async function exportJobs');
  const batchBody = background.slice(batchStart, batchEnd);
  assert.match(batchBody, /await sleep\(400\)/);
  assert.doesNotMatch(batchBody, /throw /);
  assert.doesNotMatch(background.slice(scoreStart, promptAt), /补抓失败仍用现有岗位打分|超时仍打分/);
  const collector = fs.readFileSync(path.join(root, 'src/content/collector.ts'), 'utf8');
  assert.match(collector, /hintJobId/);
  assert.match(collector, /pendingClick = \{ jobId, at: Date\.now\(\) \}/);
  assert.match(background, /pageUrl: msg\.pageUrl/);
  assert.match(background, /filterCapturedJobs\(/);
  assert.match(background, /await sleep\(400\)/);
  assert.match(background, /MSG\.FETCH_JOB_CARD/);
  assert.match(background, /active: false/);
  assert.doesNotMatch(background, /wapi\/zpgeek/);
  assert.match(sidepanel, /changes\[STORAGE_KEYS\.jobs\]/);
  assert.match(sidepanel, /await sleep\(500\)/);
});

test('空 JD 不能标成已分析：库内有描述就显示，没有描述则降级', () => {
  const empty = { uid: 'boss:1', description: '', match: { score: 86, verdict: 'strong', summary: '只看了标题' } };
  const filled = { uid: 'boss:1', description: '岗位职责：负责数据采集与清洗，并输出可检索的岗位说明。', match: { score: 86, verdict: 'strong', summary: 'JD 吻合' } };
  assert.equal(scoreGate(empty), 'degraded');
  assert.equal(scoreGate({ description: '   ' }), 'degraded');
  assert.equal(scoreGate(filled), 'score');
  const degraded = missingDescriptionMatch('2026-11-05T00:00:00.000Z');
  assert.equal(degraded.score, null);
  assert.equal(degraded.incomplete, 'missing-description');
  assert.equal(analysisGrade(degraded), null);
  assert.ok(analysisGrade(empty.match), '旧的 fail-open 分数本身仍能算出档');
  assert.equal(isCompleteAnalysis(empty), false);
  assert.equal(isCompleteAnalysis(filled), true);
  assert.equal(descriptionGap(empty).label, '缺描述');
  assert.equal(descriptionGap(filled), null);
  assert.equal(descriptionGap({ description: '', match: null }), null);
  assert.equal(analysisSummary(empty).grade, null);
  assert.equal(analysisSummary(filled).grade.label, '匹配');
  assert.match(jobDescriptionText(filled), /^岗位职责：负责数据采集/);
  assert.match(jobDescriptionText(empty), /没有读到岗位描述/);
  assert.match(jobDescriptionText({ description: '', match: null }), /暂无岗位描述/);
  const listed = filterVisibleJobs([empty, filled], { verdict: 'strong', platform: 'all', sort: 'recent' });
  assert.deepEqual(listed.map((job) => job.uid), ['boss:1']);
  assert.equal(listed[0].description, filled.description);
  const unscored = filterVisibleJobs([empty, filled], { verdict: 'unscored', platform: 'all', sort: 'score' });
  assert.equal(unscored.length, 1);
  assert.equal(unscored[0].description, '');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  assert.match(views, /jobDescriptionText\(job\)/);
  assert.match(views, /descriptionGap\(job\)/);
  assert.doesNotMatch(views, /job\.description \|\| '暂无岗位描述/);
});

await testAsync('岗位库写入串行，后写入的描述不会被打分覆盖掉', async () => {
  const previous = globalThis.chrome;
  const chrome = memoryChrome();
  globalThis.chrome = chrome;
  const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
  let arm = false;
  let reads = 0;
  let release = () => {};
  const paused = new Promise((resolve) => { release = resolve; });
  chrome.storage.local.get = (key) => {
    const result = originalGet(key);
    if (!arm) return result;
    reads += 1;
    if (reads === 1) return result.then((data) => paused.then(() => data));
    return result;
  };
  let scoring;
  let filling;
  try {
    await mergeJobs([{ uid: 'boss:lock', title: '前端', description: '', url: 'https://www.zhipin.com/job_detail/lock.html' }]);
    arm = true;
    scoring = setJobMatch('boss:lock', { score: 80, verdict: 'good', summary: '旧分' });
    await Promise.resolve();
    filling = mergeJobs([{ uid: 'boss:lock', description: '岗位职责：锁里补上的正文' }]);
    await Promise.resolve();
    assert.equal(reads, 1);
    release();
    await Promise.all([scoring, filling]);
    const saved = await loadJobs();
    const job = saved.find((item) => item.uid === 'boss:lock');
    assert.equal(job.match.score, 80);
    assert.ok(job.description.includes('锁里补上'));
  } finally {
    release();
    await Promise.all([scoring, filling].filter(Boolean)).catch(() => {});
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
});

section('打开原岗位：空描述等待并超时刮详情');
test('已有描述只打开，空描述才等待；刮到的正文只补已有 uid', () => {
  const url = 'https://www.zhipin.com/job_detail/abc.html';
  assert.equal(decideOpenOriginal({ uid: 'boss:abc', url, description: '已经收录的岗位描述正文' }), 'open');
  assert.equal(decideOpenOriginal({ uid: 'boss:abc', url, description: '   ' }), 'wait');
  assert.equal(decideOpenOriginal({ uid: 'boss:abc', url: '', description: '' }), 'skip');
  assert.equal(decideOpenOriginal({ uid: 'boss:abc', url: 'javascript:alert(1)', description: '' }), 'open');
  assert.equal(jobKeyFromUid('boss:abc'), 'abc');
  assert.equal(jobKeyFromUid('boss:998877'), '998877');
  assert.equal(DETAIL_TEXT_MIN, 20);
  assert.equal(cleanDetailText('立即沟通'), '');
  const scraped = acceptDetailScrape({
    expectedKey: 'abc',
    pageKey: 'abc',
    description: '职位描述\n岗位职责：负责数据采集与清洗，并输出可检索的岗位说明。',
  });
  assert.match(scraped, /^岗位职责：负责数据采集/);
  assert.equal(acceptDetailScrape({ expectedKey: 'abc', pageKey: 'other', description: scraped }), '');
  assert.equal(acceptDetailScrape({ expectedKey: 'abc', pageKey: '', description: scraped }), '');
  const stored = [
    { uid: 'boss:abc', title: '前端', description: '', star: true, match: { score: 80 } },
    { uid: 'boss:other', description: '' },
  ];
  const patched = patchExistingDescription(stored, 'boss:abc', scraped);
  assert.equal(patched.patched, true);
  assert.equal(patched.jobs.length, stored.length);
  assert.match(patched.jobs[0].description, /^岗位职责：负责数据采集/);
  assert.equal(patched.jobs[0].star, true);
  assert.equal(patched.jobs[0].match.score, 80);
  assert.equal(patched.jobs[0].title, '前端');
  assert.equal(patched.jobs[1].description, '');
  assert.equal(stored[0].description, '');
  const missing = patchExistingDescription(stored, 'boss:new', scraped);
  assert.equal(missing.patched, false);
  assert.equal(missing.jobs.length, 2);
  assert.equal(missing.jobs.some((job) => job.uid === 'boss:new'), false);
  const kept = patchExistingDescription(
    [{ uid: 'boss:abc', description: '接口返回的完整 JD 正文足够长' }],
    'boss:abc',
    scraped,
  );
  assert.equal(kept.patched, false);
  assert.match(kept.jobs[0].description, /接口返回/);
  assert.equal(patchExistingDescription([{ uid: 'boss:1', description: '' }], 'boss:1', '  ').patched, false);
});
test('打开原岗位的接线：空描述走等待，超时才刮；已有描述仍只开标签', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const background = fs.readFileSync(path.join(root, 'src/background/background.ts'), 'utf8');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const collector = fs.readFileSync(path.join(root, 'src/content/collector.ts'), 'utf8');
  const openStart = background.indexOf('async function openOriginalJob');
  const openEnd = background.indexOf('async function activateOriginalJobTab');
  const openBody = background.slice(openStart, openEnd);
  const activateStart = openEnd;
  const activateEnd = background.indexOf('async function requestDetailScrape');
  const activateBody = background.slice(activateStart, activateEnd);
  const domStart = collector.indexOf('function domFallback');
  const domEnd = collector.indexOf('function txt', domStart);
  assert.match(sidepanel, /decideOpenOriginal\(job\)/);
  assert.match(sidepanel, /MSG\.OPEN_ORIGINAL_JOB/);
  assert.match(sidepanel, /chrome\.tabs\.create\(\{ url: job\.url \}\)/);
  assert.match(background, /case MSG\.OPEN_ORIGINAL_JOB:/);
  assert.match(openBody, /waitForJobDescription\(uid\)/);
  assert.match(openBody, /requestDetailScrape\(/);
  assert.match(openBody, /writeDetailDescription\(/);
  assert.doesNotMatch(openBody, /tabs\.remove|closeTab/);
  assert.match(activateBody, /active: true/);
  assert.match(background, /active: false/);
  assert.match(background, /patchJobDescription\(/);
  const jobsStore = fs.readFileSync(path.join(root, 'src/common/jobsStore.ts'), 'utf8');
  assert.match(jobsStore, /patchExistingDescription\(/);
  assert.match(background, /MSG\.SCRAPE_JOB_DETAIL/);
  assert.doesNotMatch(background, /wapi\/zpgeek/);
  assert.match(collector, /SCRAPE_JOB_DETAIL/);
  assert.match(collector, /function scrapeVisibleJobDetail/);
  assert.doesNotMatch(collector.slice(domStart, domEnd), /scrapeVisibleJobDetail/);
  assert.doesNotMatch(collector, /fetch\(|XMLHttpRequest/);
});
function detailNode(text, size = { width: 480, height: 160 }) {
  return {
    textContent: text,
    innerText: text,
    getBoundingClientRect: () => ({ top: 40, left: 0, ...size }),
  };
}
function runDetailPage(href, blocks) {
  const listeners = [];
  const ctx = {
    window: { addEventListener() {}, postMessage() {} },
    location: { href, hostname: new URL(href).hostname, origin: new URL(href).origin },
    URL,
    document: {
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
      head: { appendChild() {} },
      contains: () => false,
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', className: '', classList: { add() {}, remove() {}, toggle() {} } }),
      querySelector: (sel) => (blocks[sel] || [])[0] || null,
      querySelectorAll: (sel) => blocks[sel] || [],
    },
    MutationObserver: class { observe() {} },
    Date,
    setTimeout: () => 0,
    clearTimeout: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(
    runtimeScript('../src/content/collector.ts'),
    ctx,
  );
  const ask = (msg) => {
    let response = null;
    for (const fn of listeners) fn(msg, {}, (data) => { response = data; });
    return response;
  };
  return ask;
}
test('详情页按可见正文刮 JD，标识不一致或过短则不采用', () => {
  const jd = '岗位职责：负责数据采集与清洗，并输出可检索的岗位说明。';
  const boss = runDetailPage('https://www.zhipin.com/job_detail/abc.html', {
    '.job-sec-text': [detailNode(jd)],
  });
  const hit = boss({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'abc' });
  assert.equal(hit.ok, true);
  assert.equal(hit.jobKey, 'abc');
  assert.equal(hit.description, jd);
  const mismatch = boss({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'other' });
  assert.equal(mismatch.mismatch, true);
  assert.equal(mismatch.description, '');
  const hidden = runDetailPage('https://www.zhipin.com/job_detail/abc.html', {
    '.job-sec-text': [detailNode('岗位职责：这段在视口外，不应被当成详情正文。', { width: 10, height: 4 })],
    'h1, h2, h3, h4, .job-sec-title, .t1, .title': [{
      ...detailNode('职位描述', { width: 80, height: 24 }),
      nextElementSibling: detailNode(jd),
    }],
  });
  const fallback = hidden({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'abc' });
  assert.equal(fallback.description, jd);
  const merged = patchExistingDescription(
    [{ uid: 'boss:abc', description: '', title: '数据岗' }],
    'boss:abc',
    hit.description,
  );
  assert.equal(merged.patched, true);
  assert.equal(merged.jobs[0].description, jd);
  assert.equal(merged.jobs[0].title, '数据岗');
  const drawer = runDetailPage('https://www.zhipin.com/web/geek/job?city=101280600', {
    '.job-sec-text': [detailNode(jd)],
  });
  const blocked = drawer({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'ENCRYPT_CLICK' });
  assert.equal(blocked.mismatch, true);
  assert.equal(blocked.reason, 'page-key-missing');
  assert.equal(blocked.description, '');
  assert.equal(JSON.stringify(blocked).includes('数据采集'), false);
  assert.equal(acceptDetailScrape({ expectedKey: 'ENCRYPT_CLICK', pageKey: '', description: jd }), '');
});

await testAsync('补抓日志落盘并可导出，正文和令牌不进条目', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = memoryChrome();
  try {
    const secret = '岗位职责：这是不该出现在日志里的正文';
    const stored = await appendCaptureLog({
      kind: 'ensure',
      uid: 'boss:abc',
      action: 'timeout',
      scrape: 'skipped',
      reason: 'no-scrape',
      description: secret,
      securityId: 'SEC_SHOULD_NOT_STORE',
      url: 'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC_SHOULD_NOT_STORE',
    });
    assert.equal(stored.entries.length, 1);
    assert.equal(stored.entries[0].reason, 'no-scrape');
    assert.equal(stored.entries[0].description, undefined);
    assert.equal(JSON.stringify(stored).includes('不该出现'), false);
    assert.equal(JSON.stringify(stored).includes('SEC_SHOULD_NOT_STORE'), false);
    await appendCaptureLog({ kind: 'sniff-drop', reason: 'code', code: '37', api: 'detail' });
    await appendCaptureLog({ kind: 'uid-mismatch', reason: 'uid-mismatch', hint: 'ENCRYPT_CLICK', bodyKey: 'OTHER_ENCRYPT' });
    const loaded = await loadCaptureLog();
    assert.equal(loaded.entries.length, 3);
    assert.equal(loaded.entries[1].code, '37');
    assert.equal(loaded.entries[2].hint, 'ENCRYPT_CLICK');
    const exported = captureLogJson(loaded);
    assert.match(exported, /no-scrape/);
    assert.match(exported, /uid-mismatch/);
    assert.equal(exported.includes(secret), false);
    const capped = appendCaptureEntry(emptyCaptureLog(), { kind: 'ensure', reason: 'timeout' }, 1);
    const again = appendCaptureEntry(capped, { kind: 'scrape', reason: 'page-key-missing' }, 1);
    assert.equal(again.entries.length, 1);
    assert.equal(again.entries[0].reason, 'page-key-missing');
  } finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
});

await testAsync('批量里单个缺描述失败不会挡住下一条', async () => {
  const sleeps = [];
  const results = await runIsolatedBatch(['boss:1', 'boss:2'], async (uid) => {
    if (uid === 'boss:1') throw missingDescriptionError('2026-11-05T00:00:00.000Z');
    return { score: 81 };
  }, { sleep: async (ms) => { sleeps.push(ms); }, gap: 400 });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].incomplete, 'missing-description');
  assert.match(results[0].error, /没有岗位描述/);
  assert.equal(results[1].ok, true);
  assert.equal(results[1].value.score, 81);
  assert.deepEqual(sleeps, [400]);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sidepanel = fs.readFileSync(path.join(root, 'src/pages/sidepanel/SidepanelApp.tsx'), 'utf8');
  const pumpStart = sidepanel.indexOf('const pump = async');
  const pumpEnd = sidepanel.indexOf('const acceptAuto', pumpStart);
  const pump = sidepanel.slice(pumpStart, pumpEnd);
  assert.match(pump, /catch \(error\)/);
  assert.doesNotMatch(pump, /throw /);
  const general = fs.readFileSync(path.join(root, 'src/pages/options/GeneralTab.tsx'), 'utf8');
  assert.match(general, /exportData\('capture-log'\)/);
});

test('沟通 Tab：未招呼门禁、节点数和待确认不造假步骤', () => {
  assert.equal(isGreetGateOpen({ progressStatus: undefined, record: null }), false);
  assert.equal(isGreetGateOpen({ progressStatus: 'prepared', record: null }), false);
  assert.equal(isGreetGateOpen({ progressStatus: 'opened', record: null }), false);
  assert.equal(isGreetGateOpen({ progressStatus: 'sent', record: null }), true);
  const greetOnly = confirmedNodes({ progressStatus: 'opened', record: null });
  assert.equal(greetOnly.length, 1);
  assert.equal(greetOnly[0].label, '打招呼');
  assert.equal(canExpandNodes(greetOnly), false);
  assert.deepEqual(railSteps(greetOnly, true), []);

  const history = sanitizeComm({
    nodes: [
      { id: 'greet', label: '打招呼', state: 'done', sub: '11/02', detail: '已发' },
      { id: 'chat', label: '初聊', state: 'current', detail: '已回复' },
    ],
    pending: { id: 'onsite', label: '一面', sub: '周五', hint: '摘自对话' },
  });
  assert.equal(isGreetGateOpen({ progressStatus: 'opened', record: history }), true);
  assert.equal(canExpandNodes(history.nodes), true);
  assert.equal(history.pending.label, '一面');
  assert.equal(railSteps(history.nodes, false).length, 0);
  const openRail = railSteps(history.nodes, true);
  assert.equal(openRail.filter((step) => !step.ghost).length, 2);
  assert.equal(openRail.at(-1).ghost, true);
  assert.equal(openRail.at(-1).mark, '待生长');

  const confirmed = confirmPending(history, 'sent');
  assert.equal(confirmed.pending, null);
  assert.equal(confirmed.nodes.at(-1).label, '一面');
  assert.equal(confirmed.nodes.at(-1).state, 'current');
  assert.equal(confirmed.nodes.at(-1).detail, '已确认');
  assert.ok(confirmed.nodes.slice(0, -1).every((node) => node.state === 'done'));
  assert.equal(ignorePending(history).pending, null);
  assert.equal(ignorePending(history).nodes.length, 2);
});

test('沟通 Tab：建议标签单选改写，再点回基线；发送只吃自填说明', () => {
  const stage = { label: '一面', sub: '周五' };
  const baseline = defaultBaseline(stage);
  assert.equal(baseline, '好的，周五下午都可以。一面是视频还是现场？');
  assert.equal(nextChip(null, 'outsourcing'), 'outsourcing');
  assert.equal(nextChip('outsourcing', 'outsourcing'), null);
  assert.equal(nextChip('outsourcing', 'scope'), 'scope');
  const selected = suggestionFromChip(baseline, 'outsourcing', stage);
  assert.equal(selected.text, '好的，周五下午都可以。一面是视频还是现场？另外想确认下：岗位是正式编制还是外包？');
  assert.equal(selected.emphasis, '岗位是正式编制还是外包？');
  assert.equal(suggestionFromChip(baseline, null, stage).text, baseline);
  const swapped = suggestionFromChip(baseline, 'scope', stage);
  assert.match(swapped.text, /日常主要负责哪些模块、前后端协作怎么分/);
  assert.doesNotMatch(swapped.text, /外包/);
  const chat = suggestionFromChip('好的，谢谢回复。', 'overtime', { label: '初聊', sub: '' });
  assert.equal(chat.text, '好的，谢谢回复。想了解下咱们团队平时加班大概怎样？周末需要到岗吗？');
  assert.equal(suggestionFromDemand('   ', stage), null);
  const typed = suggestionFromDemand('也想问问团队规模', stage);
  assert.equal(typed.source, 'demand');
  assert.equal(typed.chipId, null);
  assert.equal(typed.text, '好的，周五下午都可以。也想问问团队规模。');
  assert.doesNotMatch(typed.text, /外包|加班|工作内容/);
  const now = new Date(2026, 10, 4, 16, 0, 0);
  const at = new Date(2026, 10, 4, 14, 22, 0);
  const synced = syncLabel({ at: at.toISOString(), count: 12 }, now);
  assert.equal(synced, '已同步 · 今日 14:22 · 12 条');
  assert.equal(syncLabel(null), '');
});

test('沟通 Tab 按 LOCK-v2：气泡在滚动区，建议条贴底，底色共用详情令牌', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  const comm = fs.readFileSync(path.join(root, 'src/pages/sidepanel/CommTab.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/pages/sidepanel/browse.css'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src/background/background.ts'), 'utf8');
  assert.match(views, /\['flow', '沟通'\]/);
  assert.doesNotMatch(views, /\['flow', '流程'\]/);
  assert.doesNotMatch(comm, /回 HR|该问|摘录|精简版|标准版|详细版|标记已发送/);
  assert.match(comm, /说说怎么改这条建议/);
  assert.doesNotMatch(comm, /输入沟通需求|单节点 · 不可展|单一稿|无分档|模型建议|答\/问均可|建议回复|芯片|胶囊/);
  assert.match(comm, /<span>招呼语<\/span>/);
  assert.doesNotMatch(comm, /<em>/);
  assert.match(comm, /aria-label="复制建议"/);
  assert.match(comm, /aria-label="按说明改写建议"/);
  assert.match(comm, /aria-label="建议标签"/);
  assert.match(comm, /打开沟通/);
  assert.match(comm, /isGreetGateOpen/);
  assert.match(comm, /canExpandNodes/);
  assert.match(comm, /onSuggest/);
  assert.doesNotMatch(comm, /suggestionFromChip|suggestionFromDemand/);
  assert.doesNotMatch(comm, /pill-plus/);
  assert.doesNotMatch(comm, />\s*\+\s*</);
  const scrollAt = comm.indexOf('className="comm-scroll"');
  const stickyAt = comm.indexOf('className="sticky-comm"');
  assert.ok(scrollAt >= 0 && stickyAt > scrollAt);
  assert.doesNotMatch(comm.slice(scrollAt, stickyAt), /className="suggest|className=\{`suggest/);
  assert.match(comm.slice(stickyAt), /className=\{`suggest/);
  assert.match(comm.slice(scrollAt, stickyAt), /ChatThread/);
  assert.match(comm, /className="comm-chat"/);
  const commCss = css.slice(css.indexOf('/* 沟通 Tab'));
  assert.doesNotMatch(commCss, /#0f1419|#151a21|#1a222c/);
  assert.match(commCss, /\.comm-body \{[^}]*background:\s*var\(--jp-surface\)/);
  assert.match(commCss, /\.comm-drawer \{[^}]*background:\s*var\(--jp-surface-2\)/);
  assert.match(commCss, /\.suggest \{[^}]*background:\s*var\(--jp-field\)/);
  assert.match(commCss, /\.sticky-comm \{[^}]*background:\s*var\(--jp-surface\)/);
  const focus = commCss.match(/\.job-panel \.comm-pill:focus-within \{[^}]*\}/)?.[0] || '';
  assert.match(focus, /outline:\s*none/);
  assert.match(focus, /box-shadow:\s*none/);
  assert.match(focus, /border-color:\s*rgba\(45,\s*212,\s*191,\s*0?\.38\)/);
  assert.match(commCss, /\.job-panel \.comm-pill input \{[^}]*outline:\s*none/);
  assert.match(commCss, /\.job-panel \.comm-pill input \{[^}]*caret-color:\s*#2dd4bf/);
  assert.doesNotMatch(commCss, /outline:\s*2px|box-shadow:\s*0 0 0 2px/);
  assert.match(css, /\.job-panel \.sg-copy \{[^}]*border:\s*0/);
  assert.equal(MSG.AI_SUGGEST_REPLY, 'AI_SUGGEST_REPLY');
  assert.match(background, /case MSG\.AI_SUGGEST_REPLY/);
  assert.match(background, /buildSuggestReplyPrompt/);
  assert.match(background, /sanitizeSuggestReply/);
  assert.match(background, /replyEchoesInstruction/);
  assert.doesNotMatch(background, /suggestionFromChip|suggestionFromDemand/);
});

test('沟通记录保留已识别对话，并按天分组', () => {
  const morning = new Date(2026, 10, 5, 9, 0, 0).toISOString();
  const later = new Date(2026, 10, 5, 9, 5, 0).toISOString();
  const older = new Date(2026, 10, 4, 18, 0, 0).toISOString();
  const clean = sanitizeComm({
    messages: [
      { role: 'hr', text: '  你好 ', at: morning },
      { role: 'me', text: '在的', at: later },
      { role: 'hr', text: '' },
      { content: '昨天的安排', at: older, role: 'them' },
    ],
  });
  assert.equal(clean.messages.length, 3);
  assert.equal(clean.messages[0].role, 'hr');
  assert.equal(clean.messages[0].text, '你好');
  assert.equal(clean.messages[1].role, 'me');
  assert.equal(clean.messages[2].role, 'hr');
  const groups = groupChatDays(clean.messages, new Date(2026, 10, 5, 18, 0, 0));
  assert.equal(groups[0].label, '今天');
  assert.equal(groups[0].messages.length, 2);
  assert.equal(groups[1].label, '昨天');
  assert.equal(sanitizeComm({}).messages.length, 0);
});

test('建议改写提示词把说明当指令，不把原文当成功回复', () => {
  const messages = buildSuggestReplyPrompt({
    profile: emptyProfile(),
    job: { title: '前端', company: '甲公司', description: '负责页面' },
    stage: { label: '初聊', sub: '' },
    current: '好的，收到。',
    instruction: '想确定一下是不是外包',
    messages: [{ role: 'hr', text: '方便聊聊吗' }, { role: 'me', text: '方便的' }],
    includeCompany: false,
  });
  assert.match(messages[0].content, /改写指令/);
  assert.match(messages[0].content, /禁止原样输出/);
  assert.match(messages[1].content, /【改写指令】/);
  assert.match(messages[1].content, /想确定一下是不是外包/);
  assert.match(messages[1].content, /好的，收到/);
  assert.match(messages[1].content, /方便聊聊吗/);
  assert.match(messages[1].content, /公司名已隐藏/);
  const clean = sanitizeSuggestReply({ text: '  您好，想确认岗位是正式编制还是外包？  ' });
  assert.match(clean.text, /正式编制还是外包/);
  assert.equal(sanitizeSuggestReply({}).text, '');
  assert.equal(sanitizeSuggestReply('想确定一下是不是外包').text, '');
  assert.equal(replyEchoesInstruction('想确定一下是不是外包。', '想确定一下是不是外包'), true);
  assert.equal(replyEchoesInstruction('您好，想确认这个岗位是正式编制还是外包？', '想确定一下是不是外包'), false);
});

section('确认弹层与贴底反馈');
test('确认队列取消不成功，确认才 resolve true，下一条排队', async () => {
  const queue = createConfirmQueue();
  let shown = null;
  queue.attach((next) => { shown = next; });
  const first = queue.ask('确定删除岗位「前端」？此操作无法撤销。', { destructive: true });
  const second = queue.ask('确认你已向 甲公司 发送消息？此操作只记录状态。');
  assert.equal(shown.message, '确定删除岗位「前端」？此操作无法撤销。');
  assert.equal(shown.destructive, true);
  queue.settle(false);
  assert.equal(await first, false);
  assert.equal(shown.destructive, false);
  queue.settle(true);
  assert.equal(await second, true);
  queue.settle(true);
  assert.equal(queue.current(), null);
  const opened = splitConfirmCopy('确认打开 甲公司 的岗位并尝试进入沟通？\n内容将复制，请核对会话后手动发送。\n\n您好');
  assert.equal(opened.title, '确认打开 甲公司 的岗位并尝试进入沟通？');
  assert.match(opened.body, /^内容将复制，请核对会话后手动发送。\n\n您好$/);
  assert.equal(splitConfirmCopy('确定删除已选的 2 个岗位？此操作无法撤销。').body, '');
});
test('业务代码不再调用 alert/confirm/prompt，招呼语标题无旁注，反馈走 Sonner', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = path.join(root, 'src');
  const nativeCall = /(?<![A-Za-z0-9_$])(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/g;
  const callsIn = (text) => text.match(new RegExp(nativeCall.source, 'g')) || [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(srcDir);
  const offenders = [];
  for (const file of files) {
    const hits = callsIn(fs.readFileSync(file, 'utf8'));
    if (hits.length) offenders.push(`${path.relative(root, file)}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
  const vite = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
  assert.doesNotMatch(vite, /src\/ui\/sidepanel\.js/);
  const sidepanel = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'SidepanelApp.tsx'), 'utf8');
  const comm = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'CommTab.tsx'), 'utf8');
  const browse = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'browse.css'), 'utf8');
  const common = fs.readFileSync(path.join(srcDir, 'extension', 'messages.ts'), 'utf8');
  assert.match(sidepanel, /askConfirm\(/);
  assert.match(sidepanel, /from '@\/components\/ui\/sonner'/);
  assert.match(sidepanel, /<Toaster \/>/);
  assert.doesNotMatch(sidepanel, /NoticeToast|\.jp-toast/);
  const markStart = sidepanel.indexOf('onMarkSent');
  const markEnd = sidepanel.indexOf('onOpenOriginal', markStart);
  const markBody = sidepanel.slice(markStart, markEnd);
  const confirmAt = markBody.indexOf('askConfirm');
  const progressAt = markBody.indexOf("setProgress(job.uid, 'sent')");
  assert.ok(confirmAt >= 0 && progressAt > confirmAt);
  assert.match(markBody.slice(confirmAt, progressAt), /if \(!accepted\) return/);
  assert.doesNotMatch(markBody, /OPEN_JOB_CHAT|SEND_GREETING|clipboard/);
  assert.doesNotMatch(comm, /单一稿|无分档|<em>/);
  const greet = comm.slice(comm.indexOf('function GreetWork'), comm.indexOf('export function CommTab'));
  const toolsAt = greet.indexOf('className="comm-tools"');
  const sentAt = greet.indexOf('className="comm-sent"');
  assert.ok(toolsAt >= 0 && sentAt > toolsAt);
  assert.match(greet, />我已发出招呼</);
  assert.doesNotMatch(greet, /等 HR|完成招呼后解锁|comm-wait/);
  assert.doesNotMatch(browse, /\.comm-wait/);
  const sentRule = browse.slice(browse.indexOf('.job-panel .comm-sent {'), browse.indexOf('.job-panel .comm-sent:hover'));
  assert.match(sentRule, /width:\s*100%/);
  assert.match(sentRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.match(sentRule, /background:\s*transparent/);
  assert.match(sentRule, /color:\s*var\(--jp-summary\)/);
  assert.doesNotMatch(sentRule, /var\(--jp-accent\)/);
  const sentHover = browse.slice(browse.indexOf('.job-panel .comm-sent:hover'), browse.indexOf('.suggest'));
  assert.match(sentHover, /border-color:\s*var\(--jp-line-strong\)/);
  assert.match(sentHover, /background:\s*transparent/);
  assert.doesNotMatch(sentHover, /var\(--jp-accent\)/);
  const alertUi = fs.readFileSync(path.join(srcDir, 'components', 'ui', 'alert-dialog.jsx'), 'utf8');
  assert.doesNotMatch(alertUi, /bg-background/);
  assert.doesNotMatch(alertUi, /bg-black\/50/);
  const overlayRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-overlay']"), browse.indexOf("[data-slot='alert-dialog-content']"));
  const overlayAlpha = Number((overlayRule.match(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/) || [])[1]);
  assert.ok(overlayAlpha >= 0.55);
  const contentRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-content']"), browse.indexOf("[data-slot='alert-dialog-header']"));
  assert.match(contentRule, /background-color:\s*var\(--jp-surface\)/);
  assert.match(contentRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.doesNotMatch(contentRule, /bg-background|rgba\(/);
  const footerRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-footer'] .jp-btn {"));
  assert.match(footerRule, /background:\s*transparent/);
  assert.match(footerRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.match(footerRule, /color:\s*var\(--jp-summary\)/);
  assert.match(footerRule, /\.jp-btn-primary \{[^}]*background:\s*var\(--jp-accent\)/);
  assert.match(footerRule, /\.jp-btn-danger \{[^}]*background:\s*var\(--jp-confirm-del\)/);
  const views = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'views.tsx'), 'utf8');
  assert.match(views, /function useDeleteConfirm/);
  assert.match(views, /function DetailActionBar/);
  assert.doesNotMatch(views, /askConfirm\(/);
  assert.doesNotMatch(browse, /\.jp-toast\b/);
  assert.doesNotMatch(browse, /background:\s*var\(--jp-float-bg\)/);
  assert.match(browse, /data-sonner-toaster/);
  assert.match(browse, /--jp-surface-2/);
  assert.match(browse, /data-type='error'/);
  assert.equal(callsIn(common).length, 0);
});

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(40)}\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
