// AI 提示词构造：简历抽取、单岗位匹配打分。
// 均要求模型返回严格 JSON，配合 client.chatJson 使用。
import { redactProfileForAi, redactJobForAi } from './privacy.js';
import { jobText } from '../filters.js';
import { getDealbreakers } from '../profile.js';

// —— 简历文本 -> 画像草稿 ——
export function buildResumeExtractPrompt(resumeText) {
  const system =
    '你是资深招聘与职业规划顾问。请从求职者简历中抽取结构化个人画像，只输出 JSON，不要任何解释或 Markdown 围栏。' +
    '只提取材料明确支持的事实；区分实际经历、实习、计划、推断和待核实内容，计划与假设不能写成已具备的能力或成果。' +
    '不要夸大个人贡献、上线情况或业务效果；无法确定的字段留空字符串、空数组或 null，不要编造。工作年限仅指明确的全职工作年限，实习不自动折算。金额单位统一为千元/月（k）。';
  const schema = `{
  "target": {
    "jobTitles": ["目标/胜任岗位名，最多5个"],
    "cities": ["期望或现居城市"],
    "salaryMinK": 期望月薪下限数字或null,
    "salaryMaxK": 期望月薪上限数字或null,
    "industries": ["目标行业"],
    "companySizes": [],
    "workModes": []
  },
  "basics": {
    "yearsOfExperience": 工作年限数字或null,
    "education": "最高学历，如 本科/硕士",
    "currentTitle": "当前或最近职位"
  },
  "capabilities": {
    "skills": ["专业技能关键词，尽量全"],
    "strengths": ["3-6条个人优势亮点"],
    "industryExperience": ["涉猎过的行业"]
  },
  "workSummary": "150字内工作经历概述",
  "projectSummary": "150字内代表项目概述",
  "highlights": ["3-6条可量化的核心成就"]
}`;
  const user =
    `请依据以下简历内容抽取画像，严格按此 JSON 结构输出：\n${schema}\n\n` +
    `=== 简历原文开始 ===\n${String(resumeText || '').slice(0, 12000)}\n=== 简历原文结束 ===`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// —— 单岗位匹配打分 ——
export function buildMatchPrompt(profile, job, opts = {}) {
  const includeCompany = opts.includeCompany !== false;
  const includeName = !!opts.includeName;
  const p = redactProfileForAi(profile, { includeName });
  const j = redactJobForAi(job, { includeCompany });
  // 历史字段共同构成雷点，字面命中仅作为语义判断的线索。
  const pref = (profile && profile.preference) || {};
  const dealbreakers = getDealbreakers({ dealbreakers: strArr(pref.dealbreakers), avoidKeywords: strArr(pref.avoidKeywords) });
  const hits = dealbreakers.filter((k) => jobText(j).includes(k.toLowerCase()));

  const system =
    '你是求职匹配分析助手。基于「求职者画像」评估「岗位」的匹配度，站在求职者视角给出理性、务实的判断，' +
    '不夸大、不贬低。只输出 JSON，不要解释或 Markdown 围栏。\n' +
    '评分方法（务必遵守）：\n' +
    '1) 先做硬门槛判定。若岗位明确要求的经验年限高于求职者、或明确要求更高学历、或岗位资深度明显不匹配' +
    '（如岗位要「高级/资深/专家/总监/Leader」而求职者经验尚浅，或反之岗位是初级而求职者过于资深），' +
    '则视为存在硬性门槛：blockers 列出具体门槛，eligible 置为 false。注意「优先/加分/最好」等非强制措辞不算硬门槛。\n' +
    '2) 再做四维加权打分：技能匹配 40%、经验匹配 25%、岗位要求命中 20%、城市匹配 15%，' +
    '分别给 0-100 的分项分，score 为加权综合分（四舍五入取整）。存在硬门槛时 score 应显著偏低。\n' +
    '3) 只依据画像与岗位中已有信息判断，信息不足时保守评估，绝不编造求职者没有的经历或技能。未知年限不是零，不能仅因未知认定经验不达标。\n' +
    '4) 招呼语要像求职者给招聘者发的自然短消息：结合岗位名称及 JD 中具体职责或技术，挑选画像里有证据的一项相关经历说明契合；有可靠公司信息时可自然提及，不能推测公司业务、文化或招聘需求。' +
    '实习写实习，参与写参与；不要把计划、测评推断、岗位要求或未核实成果说成自己的经历，不编造年限、数字、业绩和热情。信息不足就简洁表达真实意向，不要硬凑亮点。避免模板套话、堆砌技能、夸张自评和重复公司名；以礼貌沟通或询问机会收尾。\n' +
    '5) 雷点判断：画像 preference.dealbreakers 和 preference.avoidKeywords 都是求职者明确不喜欢的岗位特征。要结合岗位描述做语义判断，不只认字面——介绍写得委婉或换个说法也算命中。' +
    '命中时在 risks 或 gaps 里写明命中的是哪条雷点，并明显降低 score（雷点明确命中可降到 40 分以下）。' +
    '雷点属于求职者的偏好，不是岗位的硬性门槛：不要因为它把 eligible 置为 false，也不要因此否定岗位其余信息的可信度。\n' +
    '6) 雷点字面匹配：系统已对全部雷点做字面匹配，命中项列在用户消息的「雷点字面命中」里。' +
    '字面命中只是线索，要结合上下文确认岗位是否真的属于该情况（例如「外包」出现在「拒绝外包团队」中就不算命中）；确认命中后同样降分并写入 risks。\n' +
    '7) 求职者在 preference.notes 里写明可以接受的事项，不要写入 risks，也不要因此降低 score。';
  const schema = `{
  "score": 0-100 的整数综合匹配分（四维加权后取整）,
  "verdict": "strong | good | fair | weak 之一",
  "eligible": true 或 false（存在硬性门槛时为 false）,
  "blockers": ["硬性门槛，如「要求5年经验，画像仅2年」「要求硕士，画像本科」「岗位为高级/资深，经验不足」，没有则空数组"],
  "dims": {
    "skill": 技能匹配分 0-100,
    "experience": 经验匹配分 0-100,
    "requirement": 岗位要求命中分 0-100,
    "location": 城市匹配分 0-100
  },
  "reasons": ["3-5条命中/契合点，具体到技能或经历"],
  "gaps": ["1-4条差距或需补齐项，没有则空数组"],
  "risks": ["1-3条风险提示，如疑似外包/薪资倒挂/经验要求过高，没有则空数组"],
  "summary": "40字内一句话总评",
  "greetings": {
    "short": "精简版开场白，30-50字，直击最核心的1个匹配亮点与求职意向，可直接发给HR",
    "standard": "标准版开场白，60-100字，结合自身亮点与岗位要点，礼貌自然，可直接发给HR",
    "detailed": "详细版开场白，120-180字，展开2-3个与岗位契合的亮点，适合正式自我介绍"
  }
}`;
  const user =
    `【求职者画像】\n${JSON.stringify(p, null, 1)}\n\n` +
    `【岗位信息】\n${JSON.stringify(j, null, 1)}\n\n` +
    (dealbreakers.length
      ? `【雷点字面命中】\n${hits.length ? hits.join('、') : '无'}\n（仅作线索，需结合上下文确认是否真的命中）\n\n`
      : '') +
    `请按以下 JSON 结构输出匹配分析：\n${schema}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 校验/规整匹配结果
export function sanitizeMatch(obj) {
  const o = typeof obj === 'object' && obj ? obj : {};
  let score = Math.round(Number(o.score));
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, score));
  const verdicts = ['strong', 'good', 'fair', 'weak'];
  let verdict = verdicts.includes(o.verdict) ? o.verdict : scoreToVerdict(score);
  const arr = (x) =>
    Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean).slice(0, 6) : [];
  const greetings = normalizeGreetings(o);
  const blockers = arr(o.blockers);
  // eligible 缺省为 true（兼容旧缓存无此字段）；显式 false 或有硬门槛则为 false
  const eligible = o.eligible === false || blockers.length > 0 ? false : true;
  return {
    score,
    verdict,
    eligible,
    blockers,
    dims: normalizeDims(o.dims),
    reasons: arr(o.reasons),
    gaps: arr(o.gaps),
    risks: arr(o.risks),
    summary: String(o.summary || '').trim().slice(0, 120),
    greetings,
    greeting: greetings.standard, // 兼容旧字段：默认取标准版
    at: new Date().toISOString(),
  };
}

// 归一化四维分项分：每项收敛到 0-100 整数；缺失返回 null（UI 据此决定是否展示分项）
export function normalizeDims(obj) {
  const o = typeof obj === 'object' && obj ? obj : {};
  const one = (v) => {
    if (v == null || v === '') return null;
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  };
  const dims = { skill: one(o.skill), experience: one(o.experience), requirement: one(o.requirement), location: one(o.location) };
  // 全空则返回 null，表示本次结果无分项（旧缓存）
  if (dims.skill == null && dims.experience == null && dims.requirement == null && dims.location == null) return null;
  return dims;
}

export const DIM_LABELS = {
  skill: '技能',
  experience: '经验',
  requirement: '要求命中',
  location: '城市',
};

// 归一化三档招呼语：接受新结构 {greetings:{short,standard,detailed}} 或旧单字段 {greeting:"..."}。
// 任一档缺失时用已有的其它档兜底，保证三档都非空。
export function normalizeGreetings(obj) {
  const o = typeof obj === 'object' && obj ? obj : {};
  const g = typeof o.greetings === 'object' && o.greetings ? o.greetings : {};
  const clean = (v) => String(v == null ? '' : v).trim().slice(0, 600);
  let short = clean(g.short);
  let standard = clean(g.standard || o.greeting); // 旧缓存的 greeting 视作标准版
  let detailed = clean(g.detailed);
  // 兜底：优先用标准版填补，其次任取一个非空的
  const any = standard || detailed || short;
  if (!standard) standard = any;
  if (!short) short = standard;
  if (!detailed) detailed = standard;
  return { short, standard, detailed };
}

export const GREETING_LEVELS = [
  { key: 'short', label: '精简版' },
  { key: 'standard', label: '标准版' },
  { key: 'detailed', label: '详细版' },
];

export function scoreToVerdict(score) {  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'weak';
}

export const VERDICT_LABELS = {
  strong: '强匹配',
  good: '较匹配',
  fair: '一般',
  weak: '偏低',
};

// —— 按岗位 JD 生成简历定制建议 ——
// 基于求职者画像 + 目标岗位，给出「怎么改简历去投这个岗位」的建议（只建议、不伪造、不落库）。
export function buildTailorResumePrompt(profile, job, opts = {}) {
  const includeCompany = opts.includeCompany !== false;
  const includeName = !!opts.includeName;
  const p = redactProfileForAi(profile, { includeName });
  const j = redactJobForAi(job, { includeCompany });

  const system =
    '你是资深简历顾问。基于「求职者画像」和「目标岗位」，给出针对该岗位定制简历的具体建议，' +
    '帮助求职者把已有经历往岗位要求上靠。只输出 JSON，不要解释或 Markdown 围栏。\n' +
    '铁律：\n' +
    '1) 绝不编造求职者没有的经历、技能或数字——只做「重组、改写措辞、突出重点、对齐关键词」；\n' +
    '2) JD 要求但画像没有的能力，只在 missingSkills 里如实指出，不要写进自我评价或改写建议里假装拥有；\n' +
    '3) 措辞对齐岗位术语（如岗位说「中后台」就用「中后台」），可量化的成就优先突出；\n' +
    '4) 建议要具体、可直接照做，避免空话套话。若画像信息过少，在 note 里说明并给出「先补全画像」的提示。';
  const schema = `{
  "matchedSkills": ["画像中已具备、且该岗位需要的技能/经历（照实列，最多8条）"],
  "missingSkills": ["岗位要求但画像未体现的能力，如实指出、不要编造（最多6条，没有则空数组）"],
  "keywordsToAlign": ["建议在简历中对齐/补充的岗位关键词（最多8条）"],
  "summaryDraft": "一段可直接粘进简历的『自我评价/求职意向』草稿，80-160字，只基于画像已有信息、对齐该岗位",
  "bulletSuggestions": ["3-5条经历/项目改写建议，格式为『把X改写为Y』或『突出X』，只基于已有经历"],
  "tips": ["2-4条投递该岗位的针对性提醒，如面试可能考察点、需重点准备的方向"],
  "note": "可选，一句话补充说明（如画像信息不足的提示），没有则空字符串"
}`;
  const user =
    `【求职者画像】\n${JSON.stringify(p, null, 1)}\n\n` +
    `【目标岗位】\n${JSON.stringify(j, null, 1)}\n\n` +
    `请按以下 JSON 结构输出简历定制建议：\n${schema}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// 校验/规整简历定制建议结果
export function sanitizeTailor(obj) {
  const o = typeof obj === 'object' && obj ? obj : {};
  const arr = (x, n = 8) =>
    Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean).slice(0, n) : [];
  return {
    matchedSkills: arr(o.matchedSkills, 8),
    missingSkills: arr(o.missingSkills, 6),
    keywordsToAlign: arr(o.keywordsToAlign, 8),
    summaryDraft: String(o.summaryDraft || '').trim().slice(0, 400),
    bulletSuggestions: arr(o.bulletSuggestions, 5),
    tips: arr(o.tips, 4),
    note: String(o.note || '').trim().slice(0, 200),
    at: new Date().toISOString(),
  };
}

// 取非空字符串数组（画像里的偏好列表）
function strArr(x) {
  return Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean) : [];
}
