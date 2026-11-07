// 本地筛选

import assert from 'node:assert';

import { normalizeResponse } from '../../src/common/platforms.js';
import { evaluateJob, applyFilters, autoScoreUids } from '../../src/common/filters.js';
import { test, section, loadFixture } from './harness.js';

const bossJobs = normalizeResponse('boss', { code: 0, message: 'success', zpData: { jobList: loadFixture('boss_joblist.sample.json') } });
section('本地筛选');
const sampleJob = bossJobs[0];
assert.ok(sampleJob, 'BOSS 列表样本至少要有一条岗位');
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
  const rules = { excludeCompanies: ['外包'], keywordsExclude: ['电销'], cities: [sampleJob.city ?? ''], salaryMinK: 20 };
  const out = applyFilters(jobs, { ...rules, enabled: false });
  assert.equal(out.length, 4);
  const reasonsOf = (uid: string) => out.find((j) => j.uid === uid)?._filter?.reasons ?? [];
  assert.ok(reasonsOf('a').includes('公司被屏蔽：外包'));
  assert.ok(reasonsOf('b').includes('命中排除词：电销'));
  assert.ok(reasonsOf('c').includes('城市不匹配'));
  assert.ok(reasonsOf('d').includes('薪资低于期望下限 20k'));
  assert.ok(out.every((j) => j._filter?.keep === false));
  assert.equal(applyFilters(jobs, { ...rules, enabled: true }).length, 0);
});
test('applyFilters 关闭时保留风险词标注', () => {
  const out = applyFilters([{ ...sampleJob, title: '外包测试' }], { enabled: false, riskKeywords: ['外包'] });
  assert.deepEqual(out[0]?._filter?.risks, ['外包']);
  assert.equal(out[0]?._filter?.keep, true);
});
test('applyFilters 无设置时不报错', () => {
  const out = applyFilters([sampleJob], undefined);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]?._filter?.reasons, []);
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
