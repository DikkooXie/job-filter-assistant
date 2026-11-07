// BOSS 平台：URL、薪资、归一化、嗅探与采集

import assert from 'node:assert';
import vm from 'node:vm';

import {
  normalizeResponse, matchPlatformApi, parseSalary, jobKeyFromPageUrl, preferDetailJobKey, detailUidDecision, acceptedHintJobId, captureKeyNotes,
} from '../../src/common/platforms.js';
import { captureApiKind, classifyBossDrop, sanitizeCaptureEntry } from '../../src/common/captureLog.js';
import { mergeJobs } from '../../src/common/jobsStore.js';
import { test, testAsync, section, runtimeScript, loadFixture, memoryChrome } from './harness.js';

// VM 脚本不能导出类型；这里仅描述这些用例实际使用的消息与浏览器桩。
interface WindowMessage {
  source?: string;
  type?: string;
  platform?: string;
  url?: string;
  payload?: unknown;
  reason?: string;
  replay?: boolean;
}
type WindowListener = (event: { source: unknown; data: WindowMessage }) => void;
// 负向断言需要读取清洗器应当剔除的额外字段。
type InspectedCaptureEntry = NonNullable<ReturnType<typeof sanitizeCaptureEntry>> & {
  url?: unknown;
  description?: unknown;
};
type SnifferFetch = (url: string) => Promise<{ clone(): { json(): Promise<unknown> } }>;
interface CollectorMessage {
  type: string;
  jobKey?: string;
  url?: string;
  pageUrl?: string;
  data?: WindowMessage;
  payload?: unknown;
  hintJobId?: string;
  hintRejected?: string;
  sniffDrop?: string;
}
interface CollectorLink {
  click(): void;
  getBoundingClientRect(): { width: number; height: number };
}
type ChromeListener = (
  message: { type: string; jobId: string },
  sender: object,
  respond: (value: unknown) => void,
) => boolean | undefined;


section('平台 URL 匹配');
test('BOSS joblist 命中', () => {
  const m = matchPlatformApi('https://www.zhipin.com/wapi/zpgeek/search/joblist.json?city=101280100');
  assert.equal(m!.platform, 'boss');
});
test('无关 URL 不命中', () => {
  assert.equal(matchPlatformApi('https://www.baidu.com/s?wd=x'), null);
});
test('BOSS 详情/卡片 URL 按详情命中，推荐列表仍是列表', () => {
  const detailUrls: [string, 'detail' | 'list'][] = [
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
const salaryCases: [string, ReturnType<typeof parseSalary>][] = [
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
const bossRaw = loadFixture<Record<string, unknown>[]>('boss_joblist.sample.json');
const bossEnvelope = { code: 0, message: 'success', zpData: { jobList: bossRaw } };
const bossJobs = normalizeResponse('boss', bossEnvelope);
test('解析出全部 3 条', () => assert.equal(bossJobs.length, 3));
test('首条含关键字段', () => {
  const j = bossJobs[0]!;
  assert.equal(j.platform, 'boss');
  assert.ok(j.title, '有岗位名');
  assert.ok(j.company, '有公司名');
  assert.ok(j.uid.startsWith('boss:'), 'uid 前缀');
  assert.ok(j.raw!.securityId, '保留 securityId 详情凭据');
  assert.ok(j.raw!.encryptJobId, '保留 encryptJobId');
  assert.equal(j.description, '', '列表不写 JD');
});
test('薪资解析到数值', () => {
  const withSalary = bossJobs.filter((j) => j.salaryMinK != null);
  assert.equal(withSalary.length, 3, `全部解析出薪资，实际 ${withSalary.length}`);
  assert.deepEqual([bossJobs[0]!.salaryMinK, bossJobs[0]!.salaryMaxK], [25, 40]);
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
  const j = bossDetail[0]!;
  assert.equal(j.uid, 'boss:abc123XYZ');
  assert.equal(j.jobId, 'abc123XYZ');
  assert.equal(j.title, '高级前端工程师');
  assert.deepEqual([j.salaryMinK, j.salaryMaxK], [25, 40], '薪资 25-40K');
  assert.equal(j.city, '广州');
  assert.equal(j.degree, '本科');
  assert.deepEqual(j.skills, ['React', 'TypeScript', 'Node.js'], 'showSkills');
  assert.ok(j.description!.includes('岗位职责'), '带 JD 正文');
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
  const j = sparse[0]!;
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
  )[0]!;
  assert.equal(j.uid, 'boss:URL_KEY', 'uid 取自 URL 的 encryptJobId');
  assert.equal(j.jobId, 'URL_KEY');
});
test('详情无 URL 时回退响应体 encryptId', () => {
  const j = normalizeResponse('boss', { code: 0, zpData: { jobInfo: { encryptId: 'BODY_KEY', jobName: 'X' } } })[0]!;
  assert.equal(j.uid, 'boss:BODY_KEY');
});
test('打开原岗位时，页面路径上的 id 盖过响应体里的纯数字 id', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { jobId: '12345', jobName: '前端', postDescription: '岗位职责：页面里的描述' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC',
    pageUrl: 'https://www.zhipin.com/job_detail/ENCRYPT_PAGE.html',
  })[0]!;
  assert.equal(j.uid, 'boss:ENCRYPT_PAGE');
  assert.equal(j.jobId, 'ENCRYPT_PAGE');
  assert.ok(j.description!.includes('页面里的描述'));
});
test('详情页上另一条非数字 id 仍信响应体，查询参数仍优先于页面', () => {
  const other = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', jobName: '相关岗位', postDescription: '岗位职责：相关' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC',
    pageUrl: 'https://www.zhipin.com/job_detail/PAGE_KEY.html',
  })[0]!;
  assert.equal(other.uid, 'boss:OTHER_ENCRYPT');
  const query = normalizeResponse('boss', {
    code: 0,
    zpData: { jobInfo: { encryptId: 'BODY_KEY', jobName: 'X' } },
  }, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=URL_KEY',
    pageUrl: 'https://www.zhipin.com/job_detail/PAGE_KEY.html',
  })[0]!;
  assert.equal(query.uid, 'boss:URL_KEY');
  assert.equal(jobKeyFromPageUrl('https://www.zhipin.com/job_detail/PAGE_KEY.html'), 'PAGE_KEY');
  assert.equal(preferDetailJobKey('', 'PAGE_KEY', '99', undefined), 'PAGE_KEY');
  assert.equal(preferDetailJobKey('URL_KEY', 'PAGE_KEY', '99', undefined), 'URL_KEY');
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
  const missed = normalizeResponse('boss', payload, { url, pageUrl })[0]!;
  assert.equal(missed.uid, 'boss:12345');
  const aligned = normalizeResponse('boss', payload, { url, pageUrl, hintJobId: 'ENCRYPT_CLICK' })[0]!;
  assert.equal(aligned.uid, 'boss:ENCRYPT_CLICK');
  assert.ok(aligned.description!.includes('抽屉里的描述'));
  const notes = captureKeyNotes('boss', payload, { url, pageUrl, hintJobId: 'ENCRYPT_CLICK' });
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, 'uid-hint');
  assert.equal(notes[0]!.uid, 'boss:ENCRYPT_CLICK');
  assert.equal(notes[0]!.bodyKey, '12345');
  assert.equal(JSON.stringify(notes).includes('抽屉'), false);
  const refused = normalizeResponse('boss', payload, { url, pageUrl, hintJobId: acceptedHintJobId('ENCRYPT_CLICK', 'ENCRYPT_CLICK') })[0]!;
  assert.equal(refused.uid, 'boss:12345');
  const other = {
    code: 0,
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', postDescription: '岗位职责：别的岗位正文' } },
  };
  const otherNotes = captureKeyNotes('boss', other, { hintJobId: 'ENCRYPT_CLICK' });
  assert.equal(otherNotes[0]!.reason, 'uid-mismatch');
  assert.equal(otherNotes[0]!.uid, 'boss:OTHER_ENCRYPT');
  assert.equal(JSON.stringify(otherNotes).includes('别的岗位'), false);
  const kept = normalizeResponse('boss', other, { hintJobId: 'ENCRYPT_CLICK' })[0]!;
  assert.equal(kept.uid, 'boss:OTHER_ENCRYPT');
});

// ---------- BOSS 列表抽屉 job/card ----------
section('BOSS 卡片归一化（boss_job_card.sample.json）');
const bossCardEnvelope = loadFixture<{ zpData: { jobCard: Record<string, unknown> } }>('boss_job_card.sample.json');
const bossCardJobs = normalizeResponse('boss', bossCardEnvelope, {
  url: 'https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC_SAMPLE_CARD&lid=LID_CARD_1',
});
test('卡片解析出 1 条且写入 JD', () => {
  assert.equal(bossCardJobs.length, 1);
  const j = bossCardJobs[0]!;
  assert.equal(j.uid, 'boss:SAMPLE_BOSS_CARD_1');
  assert.equal(j.jobId, 'SAMPLE_BOSS_CARD_1');
  assert.equal(j.title, '前端工程师');
  assert.equal(j.company, '示例卡片科技');
  assert.equal(j.city, '杭州');
  assert.equal(j.district, '西湖区·西溪');
  assert.deepEqual([j.salaryMinK, j.salaryMaxK], [20, 35]);
  assert.deepEqual(j.skills, ['React', 'TypeScript']);
  assert.equal(j.hrName, '示例经理');
  assert.ok(j.description!.includes('岗位职责'), '卡片 postDescription 写入 description');
  assert.ok(j.description!.includes('前端开发'));
  assert.equal(j.raw!.securityId, 'SEC_SAMPLE_CARD');
  assert.equal(j.raw!.lid, 'LID_CARD_1');
});
test('卡片 jobDesc 同样映射为 description', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobCard: { encryptJobId: 'CARD_DESC', jobName: '测试岗', jobDesc: '岗位职责：维护示例系统' } },
  })[0]!;
  assert.ok(j.description!.includes('维护示例系统'));
});
test('卡片空 JD 被剔除，避免回盖已有描述', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobCard: { encryptJobId: 'CARD_EMPTY', jobName: '测试岗', postDescription: '  ' } },
  })[0]!;
  assert.equal(j.uid, 'boss:CARD_EMPTY');
  assert.ok(!('description' in j));
});
test('卡片 uid 优先用 URL 的 encryptJobId', () => {
  const j = normalizeResponse('boss', bossCardEnvelope, {
    url: 'https://www.zhipin.com/wapi/zpgeek/job/card.json?encryptJobId=URL_CARD',
  })[0]!;
  assert.equal(j.uid, 'boss:URL_CARD');
});
test('jobDetail 正文包映射为 description', () => {
  const j = normalizeResponse('boss', {
    code: 0,
    zpData: { jobDetail: { encryptJobId: 'DETAIL_PACK', jobName: '详情岗', content: '岗位职责：编写示例接口' } },
  })[0]!;
  assert.equal(j.uid, 'boss:DETAIL_PACK');
  assert.ok(j.description!.includes('编写示例接口'));
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
  assert.equal(jobs[0]!.uid, 'boss:SAMPLE_BOSS_CARD_1');
  assert.ok(jobs[0]!.description!.includes('岗位职责'));
  assert.equal(jobs[0]!.company, '示例卡片科技');
});
await testAsync('mergeJobs 用卡片 JD 补全列表岗位，之后的空 JD 不回盖', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = memoryChrome();
  try {
    const listed = normalizeResponse('boss', {
      code: 0,
      zpData: { jobList: [{ ...bossRaw[0], encryptJobId: 'SAMPLE_BOSS_CARD_1', jobName: '列表名' }] },
    });
    assert.equal(listed[0]!.description, '');
    const first = await mergeJobs(listed);
    assert.equal(first.added, 1);
    const opened = await mergeJobs(normalizeResponse('boss', bossCardEnvelope));
    assert.equal(opened.updated, 1);
    const filled = opened.jobs.find((job) => job.uid === 'boss:SAMPLE_BOSS_CARD_1')!;
    assert.ok(filled.description!.includes('岗位职责'));
    assert.equal(filled.savedAt, first.jobs[0]!.savedAt);
    const again = await mergeJobs(normalizeResponse('boss', {
      code: 0,
      zpData: { jobCard: { encryptJobId: 'SAMPLE_BOSS_CARD_1', jobName: '列表名', postDescription: '' } },
    }));
    const kept = again.jobs.find((job) => job.uid === 'boss:SAMPLE_BOSS_CARD_1')!;
    assert.ok(kept.description!.includes('岗位职责'));
  } finally {
    if (previous === undefined) delete (globalThis as { chrome?: typeof chrome }).chrome;
    else globalThis.chrome = previous;
  }
});

// ---------- MAIN world 嗅探 URL ----------
section('BOSS 嗅探 URL');
function installSniffer(options: { fetch?: SnifferFetch } = {}) {
  const posts: { data: WindowMessage; origin: string }[] = [];
  const listeners: WindowListener[] = [];
  const location = {
    href: 'https://www.zhipin.com/web/geek/recommend',
    origin: 'https://www.zhipin.com',
  };
  const fakeWindow = {
    location,
    postMessage(data: WindowMessage, origin: string) { posts.push({ data, origin }); },
    addEventListener(type: string, fn: WindowListener) { if (type === 'message') listeners.push(fn); },
    fetch: typeof options.fetch === 'function'
      ? options.fetch
      : async () => ({ clone: () => ({ json: async () => ({ code: 0, zpData: {} }) }) }),
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function open() {};
  XMLHttpRequest.prototype.send = function send() {};
  const ctx = { window: fakeWindow, location, URL, XMLHttpRequest };
  vm.runInNewContext(
    runtimeScript('src/content/sniffer.ts'),
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
async function sniffedUrls(urls: string[]) {
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
  assert.equal(drops[0]!.data.reason, 'non-json');
  assert.equal(drops[0]!.data.payload, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(drops[0]!.data, 'payload'), false);
  sniffed.replay();
  assert.equal(sniffed.posts.filter((item) => item.data.type === 'sniff-drop').length, 1);
  const entry: InspectedCaptureEntry | null = sanitizeCaptureEntry({
    kind: 'sniff-drop',
    reason: 'non-json',
    api: captureApiKind(drops[0]!.data.url),
    url: drops[0]!.data.url,
  });
  assert.equal(entry!.api, 'card');
  assert.equal(entry!.url, undefined);
  assert.equal(JSON.stringify(entry).includes('SECRET'), false);
});

section('BOSS 详情请求被当成当前岗位');
function installCollector(hostname: string, href?: string) {
  const sent: CollectorMessage[] = [];
  const listeners: WindowListener[] = [];
  const timers: (() => void)[] = [];
  const links = new Map<string, CollectorLink>();
  const chromeListeners: ChromeListener[] = [];
  const location = { href: href || `https://${hostname}/web/geek/recommend`, hostname, origin: `https://${hostname}` };
  const fakeWindow = {
    location,
    addEventListener: (type: string, fn: WindowListener) => type === 'message' && listeners.push(fn),
    postMessage: (data: WindowMessage) => sent.push({ type: 'window', data }),
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
      querySelector: (sel: string) => links.get(sel) || null,
      querySelectorAll: (sel: string) => (links.has(sel) ? [links.get(sel)] : []),
    },
    MutationObserver: class { observe() {} },
    Date,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    chrome: {
      runtime: {
        sendMessage: (msg: CollectorMessage) => { sent.push(msg); return Promise.resolve(); },
        onMessage: { addListener(fn: ChromeListener) { chromeListeners.push(fn); } },
      },
      storage: {
        local: { get: async () => ({}) },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(
    runtimeScript('src/content/collector.ts'),
    ctx,
  );
  return {
    sent,
    emit(url: string, payload: unknown, extra?: Partial<WindowMessage>) {
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
  assert.ok(captured[2]!.includes('recommend/job/list'));
  assert.equal(boss.sent.find((msg) => msg.type === 'JOBS_CAPTURED')!.pageUrl, 'https://www.zhipin.com/web/geek/recommend');
  assert.equal(boss.sent.find((msg) => msg.type === 'window')!.data!.type, 'replay-request');
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
  assert.equal(boss.sent.find((msg) => msg.type === 'JOBS_CAPTURED')!.pageUrl, 'https://www.zhipin.com/job_detail/PAGE_KEY.html');
  const link = {
    clicked: false,
    click() { link.clicked = true; },
    getBoundingClientRect: () => ({ width: 180, height: 48 }),
  };
  boss.links.set('a[href*="job_detail/PAGE_KEY"]', link);
  let response: unknown = null;
  const handled = boss.chromeListeners[0]!({ type: 'FETCH_JOB_CARD', jobId: 'PAGE_KEY' }, {}, (value) => { response = value; });
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
  boss.chromeListeners[0]!({ type: 'FETCH_JOB_CARD', jobId: 'ENCRYPT_CLICK' }, {}, () => {});
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SEC', {
    zpData: { jobInfo: { encryptId: 'OTHER_ENCRYPT', postDescription: '岗位职责：别的岗位正文不应绑到点卡' } },
  });
  const first = boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').at(-1)!;
  assert.equal(first.hintJobId, undefined);
  assert.equal(first.hintRejected, 'ENCRYPT_CLICK');
  assert.equal(JSON.stringify(first).includes('别的岗位正文'), true);
  boss.emit('https://www.zhipin.com/wapi/zpgeek/job/card.json?securityId=SEC', {
    zpData: { jobCard: { jobId: '12345', postDescription: '岗位职责：抽屉正文足够长' } },
  });
  const second = boss.sent.filter((msg) => msg.type === 'JOBS_CAPTURED').at(-1)!;
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
  assert.equal(classifyBossDrop('boss', { code: 37, message: '失败', zpData: { jobInfo: { postDescription: '不应落盘的正文' } } })!.code, '37');
  assert.equal(classifyBossDrop('boss', { code: 0, zpData: {} }), null);
  assert.equal(normalizeResponse('boss', { code: 37, zpData: { jobList: [] } }).length, 0);
  const logged: InspectedCaptureEntry | null = sanitizeCaptureEntry({
    kind: 'sniff-drop',
    reason: 'code',
    code: '37',
    api: captureApiKind('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=SECRET'),
    description: '不应落盘的正文',
  });
  assert.equal(logged!.reason, 'code');
  assert.equal(logged!.code, '37');
  assert.equal(logged!.api, 'detail');
  assert.equal(logged!.description, undefined);
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
