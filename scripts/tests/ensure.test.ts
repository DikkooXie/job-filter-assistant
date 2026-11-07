// 空 JD 补抓与打开原岗位

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { MSG } from '../../src/common/constants.js';
import {
  ENSURE_DESC_GAP_MS, ENSURE_DESC_TIMEOUT_MS, createEnsureQueue, ensureGapWait, filterCapturedJobs, hasJobDescription, jobNeedsDescription, runEnsureDescription, shouldReuseMatchCache, decideOpenOriginal, acceptDetailScrape, patchExistingDescription, jobKeyFromUid, cleanDetailText, DETAIL_TEXT_MIN, scoreGate, missingDescriptionMatch, missingDescriptionError, runIsolatedBatch,
} from '../../src/common/ensureDescription.js';
import {
  appendCaptureEntry, appendCaptureLog, captureLogJson, emptyCaptureLog, ensureLogEntry, loadCaptureLog,
} from '../../src/common/captureLog.js';
import { loadJobs, mergeJobs, setJobMatch } from '../../src/common/jobsStore.js';
import { emptyProfile } from '../../src/common/profile.js';
import {
  analysisGrade, analysisSummary, descriptionGap, filterVisibleJobs, isCompleteAnalysis, jobDescriptionText,
} from '../../src/pages/sidepanel/browseModel.js';
import {
  canExpandNodes, confirmPending, confirmedNodes, defaultBaseline, groupChatDays, ignorePending, isGreetGateOpen, nextChip, railSteps, sanitizeComm, suggestionFromChip, suggestionFromDemand, syncLabel,
} from '../../src/pages/sidepanel/commTab.js';
import { buildSuggestReplyPrompt, sanitizeSuggestReply, replyEchoesInstruction } from '../../src/common/ai/prompts.js';
import type { Job } from '../../src/common/types.js';
import type { CaptureLogEntry } from '../../src/common/captureLog.js';
import { test, testAsync, section, runtimeScript, memoryChrome, partialJob, ROOT } from './harness.js';

type CheckedLogEntry = CaptureLogEntry & { description?: unknown };
type StorageGet = (key?: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;

interface DetailResponse {
  ok: boolean;
  jobKey: string;
  description: string;
  mismatch?: boolean;
  reason?: string;
}

type DetailMessage = { type: string; jobKey: string };
type DetailListener = (message: DetailMessage, sender: object, respond: (data: DetailResponse) => void) => void;
type DetailBlock = ReturnType<typeof detailNode> & {
  nextElementSibling?: ReturnType<typeof detailNode>;
};

section('空 JD 分析前补抓');
test('已有描述或没有定位信息的岗位不补抓，间隔不小于现有限速', () => {
  assert.equal(jobNeedsDescription({ uid: 'boss:0', platform: 'boss', description: '岗位职责：已有', url: 'https://www.zhipin.com/job_detail/0.html' }), false);
  assert.equal(jobNeedsDescription({ uid: 'boss:1', platform: 'boss', description: '  ', jobId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html' }), true);
  assert.equal(jobNeedsDescription(partialJob({ uid: 'boss:2', description: '' })), false);
  assert.equal(hasJobDescription(partialJob({ description: '  正文 ' })), true);
  assert.ok(ENSURE_DESC_GAP_MS >= 500);
  assert.ok(ENSURE_DESC_TIMEOUT_MS >= 3000 && ENSURE_DESC_TIMEOUT_MS <= 10000);
  assert.equal(ensureGapWait(0, 5000), 0);
  assert.equal(ensureGapWait(1000, 1200), 300);
  assert.equal(ensureGapWait(1000, 1800), 0);
  const known = filterCapturedJobs(
    [partialJob({ uid: 'boss:1', description: '岗位职责：新' }), partialJob({ uid: 'boss:2', description: '另一条' })],
    [partialJob({ uid: 'boss:1', description: '' })],
    false,
  );
  assert.deepEqual(known.map((job) => job.uid), ['boss:1']);
  assert.equal(filterCapturedJobs([partialJob({ uid: 'boss:2' })], [], true).length, 1);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: false, hasDescription: true }), false);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: true, hasDescription: true }), true);
  assert.equal(shouldReuseMatchCache({ force: false, cached: { score: 1 }, hadDescription: false, hasDescription: false }), false);
  assert.equal(shouldReuseMatchCache({ force: true, cached: { score: 1 }, hadDescription: true, hasDescription: true }), false);
});
await testAsync('补抓优先点卡片，点不到才短开；失败或超时仍把原岗位交回去', async () => {
  const empty = { uid: 'boss:abc', platform: 'boss', jobId: 'abc', description: '', url: 'https://www.zhipin.com/job_detail/abc.html' };
  const calls: string[] = [];
  const clicked = await runEnsureDescription(empty, {
    now: () => 1000,
    sleep: async (ms) => { calls.push(`sleep:${ms}`); },
    clickCard: async () => { calls.push('click'); return true; },
    openUrl: async () => { calls.push('open'); return 7; },
    closeTab: async (id) => { calls.push(`close:${id}`); },
    waitForDescription: async () => ({ ...empty, description: '岗位职责：点卡得到' }),
  }, { lastAt: 0 });
  assert.equal(clicked.action, 'click');
  assert.ok(clicked.job.description!.includes('点卡得到'));
  assert.deepEqual(calls, ['click']);

  const opened: string[] = [];
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

  const scrapeCalls: string[] = [];
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
  assert.ok(scraped.job.description!.includes('详情页可见正文'));
  assert.deepEqual(scrapeCalls, ['scrape:4']);

  const bare: string[] = [];
  const logs: Array<CheckedLogEntry | null> = [];
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
  assert.equal(logs[0]!.kind, 'ensure');
  assert.equal(logs[0]!.scrape, 'skipped');
  assert.equal(logs[0]!.reason, 'no-scrape');
  assert.equal(logs[0]!.description, undefined);

  const dom: string[] = [];
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
  assert.ok(fromClick.job.description!.includes('点卡后补刮'));
  assert.deepEqual(dom, ['scrape:3']);

  const crossed: string[] = [];
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
  assert.ok(afterReject.job.description!.includes('短开详情页'));
  assert.deepEqual(crossed, ['scrape:3', 'open', 'scrape:8', 'close:8']);
});
await testAsync('多次补抓串行，不会同时点开两张卡', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const queued = createEnsureQueue(async (job: Pick<Job, 'uid'>) => {
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
  const root = ROOT;
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
  const empty = partialJob({ uid: 'boss:1', description: '', match: { score: 86, verdict: 'strong', summary: '只看了标题' } });
  const filled = partialJob({ uid: 'boss:1', description: '岗位职责：负责数据采集与清洗，并输出可检索的岗位说明。', match: { score: 86, verdict: 'strong', summary: 'JD 吻合' } });
  assert.equal(scoreGate(empty), 'degraded');
  assert.equal(scoreGate(partialJob({ description: '   ' })), 'degraded');
  assert.equal(scoreGate(filled), 'score');
  const degraded = missingDescriptionMatch('2026-11-05T00:00:00.000Z');
  assert.equal(degraded.score, null);
  assert.equal(degraded.incomplete, 'missing-description');
  assert.equal(analysisGrade(degraded), null);
  assert.ok(analysisGrade(empty.match), '旧的 fail-open 分数本身仍能算出档');
  assert.equal(isCompleteAnalysis(empty), false);
  assert.equal(isCompleteAnalysis(filled), true);
  assert.equal(descriptionGap(empty)!.label, '缺描述');
  assert.equal(descriptionGap(filled), null);
  assert.equal(descriptionGap(partialJob({ description: '', match: null })), null);
  assert.equal(analysisSummary(empty).grade, null);
  assert.equal(analysisSummary(filled).grade!.label, '匹配');
  assert.match(jobDescriptionText(filled), /^岗位职责：负责数据采集/);
  assert.match(jobDescriptionText(empty), /没有读到岗位描述/);
  assert.match(jobDescriptionText(partialJob({ description: '', match: null })), /暂无岗位描述/);
  const listed = filterVisibleJobs([empty, filled], { verdict: 'strong', platform: 'all', sort: 'recent' });
  assert.deepEqual(listed.map((job) => job.uid), ['boss:1']);
  assert.equal(listed[0]!.description, filled.description);
  const unscored = filterVisibleJobs([empty, filled], { verdict: 'unscored', platform: 'all', sort: 'score' });
  assert.equal(unscored.length, 1);
  assert.equal(unscored[0]!.description, '');
  const root = ROOT;
  const views = fs.readFileSync(path.join(root, 'src/pages/sidepanel/views.tsx'), 'utf8');
  assert.match(views, /jobDescriptionText\(job\)/);
  assert.match(views, /descriptionGap\(job\)/);
  assert.doesNotMatch(views, /job\.description \|\| '暂无岗位描述/);
});

await testAsync('岗位库写入串行，后写入的描述不会被打分覆盖掉', async () => {
  const previous = globalThis.chrome;
  const chrome = memoryChrome();
  globalThis.chrome = chrome;
  const originalGet = chrome.storage.local.get.bind(chrome.storage.local) as StorageGet;
  let arm = false;
  let reads = 0;
  let release = () => {};
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const pausedGet: StorageGet = (key) => {
    const result = originalGet(key);
    if (!arm) return result;
    reads += 1;
    if (reads === 1) return result.then((data) => paused.then(() => data));
    return result;
  };
  chrome.storage.local.get = pausedGet as typeof chrome.storage.local.get;
  let scoring;
  let filling;
  try {
    await mergeJobs([partialJob({ uid: 'boss:lock', title: '前端', description: '', url: 'https://www.zhipin.com/job_detail/lock.html' })]);
    arm = true;
    scoring = setJobMatch('boss:lock', { score: 80, verdict: 'good', summary: '旧分' });
    await Promise.resolve();
    filling = mergeJobs([partialJob({ uid: 'boss:lock', description: '岗位职责：锁里补上的正文' })]);
    await Promise.resolve();
    assert.equal(reads, 1);
    release();
    await Promise.all([scoring, filling]);
    const saved = await loadJobs();
    const job = saved.find((item) => item.uid === 'boss:lock')!;
    assert.equal(job.match!.score, 80);
    assert.ok(job.description!.includes('锁里补上'));
  } finally {
    release();
    await Promise.all([scoring, filling].filter(Boolean)).catch(() => {});
    if (previous === undefined) delete (globalThis as { chrome?: typeof chrome }).chrome;
    else globalThis.chrome = previous;
  }
});

section('打开原岗位：空描述等待并超时刮详情');
test('已有描述只打开，空描述才等待；刮到的正文只补已有 uid', () => {
  const url = 'https://www.zhipin.com/job_detail/abc.html';
  assert.equal(decideOpenOriginal(partialJob({ uid: 'boss:abc', url, description: '已经收录的岗位描述正文' })), 'open');
  assert.equal(decideOpenOriginal(partialJob({ uid: 'boss:abc', url, description: '   ' })), 'wait');
  assert.equal(decideOpenOriginal(partialJob({ uid: 'boss:abc', url: '', description: '' })), 'skip');
  assert.equal(decideOpenOriginal(partialJob({ uid: 'boss:abc', url: 'javascript:alert(1)', description: '' })), 'open');
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
    partialJob({ uid: 'boss:abc', title: '前端', description: '', star: true, match: { score: 80 } }),
    partialJob({ uid: 'boss:other', description: '' }),
  ];
  const patched = patchExistingDescription(stored, 'boss:abc', scraped);
  assert.equal(patched.patched, true);
  assert.equal(patched.jobs.length, stored.length);
  assert.match(patched.jobs[0]!.description!, /^岗位职责：负责数据采集/);
  assert.equal(patched.jobs[0]!.star, true);
  assert.equal(patched.jobs[0]!.match!.score, 80);
  assert.equal(patched.jobs[0]!.title, '前端');
  assert.equal(patched.jobs[1]!.description, '');
  assert.equal(stored[0]!.description, '');
  const missing = patchExistingDescription(stored, 'boss:new', scraped);
  assert.equal(missing.patched, false);
  assert.equal(missing.jobs.length, 2);
  assert.equal(missing.jobs.some((job) => job.uid === 'boss:new'), false);
  const kept = patchExistingDescription(
    [partialJob({ uid: 'boss:abc', description: '接口返回的完整 JD 正文足够长' })],
    'boss:abc',
    scraped,
  );
  assert.equal(kept.patched, false);
  assert.match(kept.jobs[0]!.description!, /接口返回/);
  assert.equal(patchExistingDescription([partialJob({ uid: 'boss:1', description: '' })], 'boss:1', '  ').patched, false);
});
test('打开原岗位的接线：空描述走等待，超时才刮；已有描述仍只开标签', () => {
  const root = ROOT;
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
function detailNode(text: string, size = { width: 480, height: 160 }) {
  return {
    textContent: text,
    innerText: text,
    getBoundingClientRect: () => ({ top: 40, left: 0, ...size }),
  };
}
function runDetailPage(href: string, blocks: Record<string, DetailBlock[]>) {
  const listeners: DetailListener[] = [];
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
      querySelector: (sel: string) => (blocks[sel] || [])[0] || null,
      querySelectorAll: (sel: string) => blocks[sel] || [],
    },
    MutationObserver: class { observe() {} },
    Date,
    setTimeout: () => 0,
    clearTimeout: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: (fn: DetailListener) => listeners.push(fn) },
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
  const ask = (msg: DetailMessage): DetailResponse | null => {
    let response: DetailResponse | null = null;
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
  assert.equal(hit!.ok, true);
  assert.equal(hit!.jobKey, 'abc');
  assert.equal(hit!.description, jd);
  const mismatch = boss({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'other' });
  assert.equal(mismatch!.mismatch, true);
  assert.equal(mismatch!.description, '');
  const hidden = runDetailPage('https://www.zhipin.com/job_detail/abc.html', {
    '.job-sec-text': [detailNode('岗位职责：这段在视口外，不应被当成详情正文。', { width: 10, height: 4 })],
    'h1, h2, h3, h4, .job-sec-title, .t1, .title': [{
      ...detailNode('职位描述', { width: 80, height: 24 }),
      nextElementSibling: detailNode(jd),
    }],
  });
  const fallback = hidden({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'abc' });
  assert.equal(fallback!.description, jd);
  const merged = patchExistingDescription(
    [partialJob({ uid: 'boss:abc', description: '', title: '数据岗' })],
    'boss:abc',
    hit!.description,
  );
  assert.equal(merged.patched, true);
  assert.equal(merged.jobs[0]!.description, jd);
  assert.equal(merged.jobs[0]!.title, '数据岗');
  const drawer = runDetailPage('https://www.zhipin.com/web/geek/job?city=101280600', {
    '.job-sec-text': [detailNode(jd)],
  });
  const blocked = drawer({ type: 'SCRAPE_JOB_DETAIL', jobKey: 'ENCRYPT_CLICK' });
  assert.equal(blocked!.mismatch, true);
  assert.equal(blocked!.reason, 'page-key-missing');
  assert.equal(blocked!.description, '');
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
    assert.equal(stored.entries[0]!.reason, 'no-scrape');
    assert.equal((stored.entries[0]! as CheckedLogEntry).description, undefined);
    assert.equal(JSON.stringify(stored).includes('不该出现'), false);
    assert.equal(JSON.stringify(stored).includes('SEC_SHOULD_NOT_STORE'), false);
    await appendCaptureLog({ kind: 'sniff-drop', reason: 'code', code: '37', api: 'detail' });
    await appendCaptureLog({ kind: 'uid-mismatch', reason: 'uid-mismatch', hint: 'ENCRYPT_CLICK', bodyKey: 'OTHER_ENCRYPT' });
    const loaded = await loadCaptureLog();
    assert.equal(loaded.entries.length, 3);
    assert.equal(loaded.entries[1]!.code, '37');
    assert.equal(loaded.entries[2]!.hint, 'ENCRYPT_CLICK');
    const exported = captureLogJson(loaded);
    assert.match(exported, /no-scrape/);
    assert.match(exported, /uid-mismatch/);
    assert.equal(exported.includes(secret), false);
    const capped = appendCaptureEntry(emptyCaptureLog(), { kind: 'ensure', reason: 'timeout' }, 1);
    const again = appendCaptureEntry(capped, { kind: 'scrape', reason: 'page-key-missing' }, 1);
    assert.equal(again.entries.length, 1);
    assert.equal(again.entries[0]!.reason, 'page-key-missing');
  } finally {
    if (previous === undefined) delete (globalThis as { chrome?: typeof chrome }).chrome;
    else globalThis.chrome = previous;
  }
});

await testAsync('批量里单个缺描述失败不会挡住下一条', async () => {
  const sleeps: number[] = [];
  const results = await runIsolatedBatch(['boss:1', 'boss:2'], async (uid) => {
    if (uid === 'boss:1') throw missingDescriptionError('2026-11-05T00:00:00.000Z');
    return { score: 81 };
  }, { sleep: async (ms) => { sleeps.push(ms); }, gap: 400 });
  assert.equal(results.length, 2);
  assert.equal(results[0]!.ok, false);
  assert.equal(results[0]!.incomplete, 'missing-description');
  assert.match(results[0]!.error, /没有岗位描述/);
  assert.equal(results[1]!.ok, true);
  assert.equal(results[1]!.value!.score, 81);
  assert.deepEqual(sleeps, [400]);
  const root = ROOT;
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
  assert.equal(greetOnly[0]!.label, '打招呼');
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
  assert.equal(history.pending!.label, '一面');
  assert.equal(railSteps(history.nodes, false).length, 0);
  const openRail = railSteps(history.nodes, true);
  assert.equal(openRail.filter((step) => !step.ghost).length, 2);
  assert.equal(openRail.at(-1)!.ghost, true);
  assert.equal(openRail.at(-1)!.mark, '待生长');

  const confirmed = confirmPending(history, 'sent');
  assert.equal(confirmed.pending, null);
  assert.equal(confirmed.nodes.at(-1)!.label, '一面');
  assert.equal(confirmed.nodes.at(-1)!.state, 'current');
  assert.equal(confirmed.nodes.at(-1)!.detail, '已确认');
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
  assert.equal(typed!.source, 'demand');
  assert.equal(typed!.chipId, null);
  assert.equal(typed!.text, '好的，周五下午都可以。也想问问团队规模。');
  assert.doesNotMatch(typed!.text, /外包|加班|工作内容/);
  const now = new Date(2026, 10, 4, 16, 0, 0);
  const at = new Date(2026, 10, 4, 14, 22, 0);
  const synced = syncLabel({ at: at.toISOString(), count: 12 }, now);
  assert.equal(synced, '已同步 · 今日 14:22 · 12 条');
  assert.equal(syncLabel(null), '');
});

test('沟通 Tab 按 LOCK-v2：气泡在滚动区，建议条贴底，底色共用详情令牌', () => {
  const root = ROOT;
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
  const scrollAt = comm.indexOf('className={commScroll}');
  const stickyAt = comm.indexOf('className={stickyComm}');
  assert.ok(scrollAt >= 0 && stickyAt > scrollAt);
  assert.doesNotMatch(comm.slice(scrollAt, stickyAt), /suggestBox/);
  assert.match(comm.slice(stickyAt), /suggestBox/);
  assert.match(comm.slice(scrollAt, stickyAt), /ChatThread/);
  assert.match(comm, /className=\{commChat\}/);
  assert.match(comm, /const commScroll = '[^']*flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain/);
  assert.match(comm, /const commPill = '[^']*focus-within:border-\[rgba\(45,212,191,0\.38\)\]/);
  assert.match(comm, /const commPillInput = '[^']*caret-\[#2dd4bf\][^']*focus:!outline-none/);
  assert.match(comm, /const suggestCopy = '[^']*!border-0[^']*'/);
  assert.doesNotMatch(css, /\.comm-|\.suggest\b|\.sg-body|\.sg-copy|\.sticky-comm/);
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
  assert.equal(clean.messages[0]!.role, 'hr');
  assert.equal(clean.messages[0]!.text, '你好');
  assert.equal(clean.messages[1]!.role, 'me');
  assert.equal(clean.messages[2]!.role, 'hr');
  const groups = groupChatDays(clean.messages, new Date(2026, 10, 5, 18, 0, 0));
  assert.equal(groups[0]!.label, '今天');
  assert.equal(groups[0]!.messages.length, 2);
  assert.equal(groups[1]!.label, '昨天');
  assert.equal(sanitizeComm({}).messages.length, 0);
});

test('建议改写提示词把说明当指令，不把原文当成功回复', () => {
  const messages = buildSuggestReplyPrompt({
    profile: emptyProfile(),
    job: partialJob({ title: '前端', company: '甲公司', description: '负责页面' }),
    stage: { label: '初聊', sub: '' },
    current: '好的，收到。',
    instruction: '想确定一下是不是外包',
    messages: [{ role: 'hr', text: '方便聊聊吗' }, { role: 'me', text: '方便的' }],
    includeCompany: false,
  });
  assert.match(messages[0]!.content, /改写指令/);
  assert.match(messages[0]!.content, /禁止原样输出/);
  assert.match(messages[1]!.content, /【改写指令】/);
  assert.match(messages[1]!.content, /想确定一下是不是外包/);
  assert.match(messages[1]!.content, /好的，收到/);
  assert.match(messages[1]!.content, /方便聊聊吗/);
  assert.match(messages[1]!.content, /公司名已隐藏/);
  const clean = sanitizeSuggestReply({ text: '  您好，想确认岗位是正式编制还是外包？  ' });
  assert.match(clean.text, /正式编制还是外包/);
  assert.equal(sanitizeSuggestReply({}).text, '');
  assert.equal(sanitizeSuggestReply('想确定一下是不是外包').text, '');
  assert.equal(replyEchoesInstruction('想确定一下是不是外包。', '想确定一下是不是外包'), true);
  assert.equal(replyEchoesInstruction('您好，想确认这个岗位是正式编制还是外包？', '想确定一下是不是外包'), false);
});
