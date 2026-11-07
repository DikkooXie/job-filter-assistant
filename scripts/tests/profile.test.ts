// 个人画像与导入

import assert from 'node:assert';

import {
  appendDealbreaker, appendPreferenceNote, emptyProfile, scoreProfile, sanitizeProfile, mergeDraft, getDealbreakers, updateDealbreakers,
} from '../../src/common/profile.js';
import {
  MAX_PROFILE_IMPORT_BYTES, applyProfileDraft, assertFilesWithinLimit, combineMaterialExtracts, parseProfileJson, planJsonFile, planResumeFiles,
} from '../../src/common/profileImport.js';
import { sanitizeMatch, buildMatchPrompt } from '../../src/common/ai/prompts.js';
import { test, testAsync, section, partialJob } from './harness.js';

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
  assert.throws(() => assertFilesWithinLimit([big]), (error: Error) => {
    assert.match(error.message, /简历\.pdf/);
    assert.match(error.message, /10\.0 MB/);
    assert.match(error.message, /超过 10 MB，已拒绝导入/);
    return true;
  });
  const larger = { name: '材料.md', size: Math.round(12.5 * 1024 * 1024) };
  assert.throws(() => assertFilesWithinLimit([{ name: 'ok.txt', size: limit }, larger]), /材料\.md/);
  assert.match(assertFilesWithinLimit([{ name: '刚好.pdf', size: limit }])[0]!.name!, /刚好\.pdf/);
});
test('画像 JSON 只能单独导入，字段不对时指出具体问题', () => {
  const profile = parseProfileJson('{"target":{"jobTitles":["测试工程师"],"salaryMinK":"18"},"basics":{"yearsOfExperience":0}}') as {
    target: { jobTitles: string[] };
    basics: { yearsOfExperience: number };
  };
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
  assert.equal(planJsonFile([{ name: '画像.json', size: 20 }])!.name, '画像.json');
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
  const calls: string[] = [];
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
  assert.equal(calls[0]!.slice('材料：经历.md\n'.length).length, 10000);
  assert.ok(calls[1]!.startsWith('材料：经历.md\n') && calls[1]!.endsWith('乙'));
  assert.ok(calls[2]!.startsWith('材料：补充.txt\n'));
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
  const messages = buildMatchPrompt(emptyProfile(), partialJob({ title: '前端', company: '测试公司' }), { includeCompany: false });
  assert.ok(messages[0]!.content.includes('未知年限不是零'));
  assert.ok(messages[0]!.content.includes('实习写实习'));
  assert.ok(!messages[1]!.content.includes('测试公司'));
});

test('匹配提示包含雷点语义规则，且雷点不否决岗位', () => {
  const profile = emptyProfile();
  profile.preference.dealbreakers = ['大小周'];
  const messages = buildMatchPrompt(profile, partialJob({ title: '前端', description: '每周工作六天' }));
  const system = messages[0]!.content;
  assert.ok(system.includes('雷点'));
  assert.ok(system.includes('preference.dealbreakers'));
  assert.ok(system.includes('不要因为它把 eligible 置为 false'));
  assert.ok(messages[1]!.content.includes('【雷点字面命中】\n无'));
});

test('规避关键词命中由代码先匹配并写进提示词', () => {
  const profile = emptyProfile();
  profile.preference.avoidKeywords = ['外包', '不存在的词'];
  profile.preference.dealbreakers = ['驻场'];
  const job = partialJob({ title: '前端工程师', description: '本岗位为外包驻场项目' });
  const messages = buildMatchPrompt(profile, job);
  const user = messages[1]!.content;
  assert.ok(user.includes('【雷点字面命中】'));
  const hitSection = user.slice(user.indexOf('【雷点字面命中】'), user.indexOf('请按以下 JSON 结构输出'));
  assert.ok(hitSection.includes('外包'));
  assert.ok(hitSection.includes('驻场'));
  assert.ok(!hitSection.includes('不存在的词'));
  assert.ok(messages[0]!.content.includes('字面命中只是线索'));
});

test('未配置规避关键词时不输出命中区块', () => {
  const messages = buildMatchPrompt(emptyProfile(), partialJob({ title: '前端', description: '外包项目' }));
  assert.ok(!messages[1]!.content.includes('【雷点字面命中】'));
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
  const system = buildMatchPrompt(profile, partialJob({ title: '前端' }))[0]!.content;
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
  const user = buildMatchPrompt(profile, partialJob({ title: '销售驻场', description: '需要驻场销售' }))[1]!.content;
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
