// 岗位浏览预览用的虚构数据。只由 extension-pages/sidepanel-browse-preview.tsx 加载，不进入扩展包。
// 正式侧栏 extension-pages/sidepanel.tsx 不引用本文件；空库不会回落到这里的岗位。
import { profileFingerprint } from '../src/common/profileFingerprint.js';
import type { Job, Match, Profile } from '../src/common/types.js';

// 侧栏发来的消息。预览只认用得到的字段。
interface PreviewMessage {
  type?: string;
  uid?: string;
  text?: string;
  patch?: { privacy?: object; filters?: object; [key: string]: unknown };
  profile?: Profile;
  instruction?: unknown;
}
type Listener = (msg: object, sender: object, reply: () => void) => void;

// 预览页暴露给浏览器自动化的调试入口。
interface PreviewWindow {
  chrome: unknown;
  __previewOpened?: string;
  __previewCapture?: (partial?: Partial<Job>) => Job;
  __previewRemoveJob?: (uid: string) => void;
  __previewAllowReads?: () => void;
  __previewFail?: (uid: string, on?: boolean) => void;
  __previewAutoQueue?: (uids: string[]) => void;
  __previewState?: typeof state;
}
const previewWindow = window as unknown as PreviewWindow;

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'normal';

const jobs: Job[] = [
  { uid: 'boss:s1', platform: 'boss', jobId: 's1', title: '前端开发工程师', salaryText: '18–25K', salaryMinK: 18, salaryMaxK: 25, city: '深圳', district: '南山', experience: '应届', degree: '本科', skills: ['Vue 3', 'TypeScript', 'AI 应用'], tags: [], welfare: ['补充医疗'], company: '青禾科技', companyIndustry: '软件', companyScale: '100–499人', companyType: '民营', companyStage: 'A轮', hrName: '周宁', hrTitle: '招聘', description: '参与业务前端功能开发，维护组件与工程规范。', url: 'https://example.invalid/jobs/s1', savedAt: '2026-11-01T08:00:00.000Z', lastSeenAt: '2026-11-04T08:00:00.000Z', star: true, greetingDraft: '您好，我对贵司前端岗很感兴趣。近两年主要做 React / TypeScript，有中后台与可视化经验，期待进一步沟通。', match: { score: 92, verdict: 'strong', summary: 'Vue 与 TypeScript 要求吻合，有 AI 应用工程实践的加分项。', reasons: ['Vue 与 TypeScript 吻合'], gaps: [], risks: [], eligible: true, blockers: [], dims: { skill: 90, experience: 80, requirement: 88, location: 92 } } },
  { uid: 'boss:s2', platform: 'boss', jobId: 's2', title: 'AI 应用全栈工程师', salaryText: '20–30K', salaryMinK: 20, salaryMaxK: 30, city: '深圳', district: '福田', experience: '1–3年', degree: '本科', skills: ['React', 'Node.js', 'LLM'], tags: [], welfare: [], company: '远山智能', companyIndustry: '人工智能', companyScale: '20–99人', companyType: '民营', companyStage: '天使轮', hrName: '', hrTitle: '', description: '独立交付 AI 应用功能，和产品一起迭代。', url: 'https://example.invalid/jobs/s2', savedAt: '2026-11-01T07:00:00.000Z', lastSeenAt: '2026-11-04T07:00:00.000Z', star: false, match: { score: 84, verdict: 'good', summary: '技术方向契合，但独立交付经验要求高于应届岗位，建议在沟通中确认。', reasons: ['技术方向契合'], gaps: ['独立交付经验'], risks: ['要求独立交付，沟通时确认是否接受应届生'], eligible: true, blockers: [] } },
  { uid: 'boss:s3', platform: 'boss', jobId: 's3', title: 'Web 前端开发（校招）', salaryText: '15–22K', salaryMinK: 15, salaryMaxK: 22, city: '广州', district: '天河', experience: '应届', degree: '本科', skills: ['JavaScript', 'Vue', '工程化'], tags: [], welfare: [], company: '方舟网络', companyIndustry: '互联网', companyScale: '500–999人', companyType: '民营', companyStage: '', hrName: '陈敏', hrTitle: 'HR', description: '校招前端岗位，参与业务页面开发。', url: 'https://example.invalid/jobs/s3', savedAt: '2026-11-01T06:00:00.000Z', lastSeenAt: '2026-11-04T06:00:00.000Z', star: false, match: null },
  { uid: 'boss:s4', platform: 'boss', jobId: 's4', title: '前端工程师 · 企业级低代码与可视化协作平台方向', salaryText: '18–28K', salaryMinK: 18, salaryMaxK: 28, city: '深圳', district: '宝安', experience: '1–3年', degree: '本科', skills: ['React', '可视化', '组件库'], tags: [], welfare: [], company: '墨石软件', companyIndustry: '企业服务', companyScale: '100–499人', companyType: '民营', companyStage: 'B轮', hrName: '', hrTitle: '', description: '负责低代码与可视化协作平台的前端组件。', url: 'https://example.invalid/jobs/s4', savedAt: '2026-11-01T05:00:00.000Z', lastSeenAt: '2026-11-04T05:00:00.000Z', star: false, match: { score: 78, verdict: 'good', summary: '组件开发与工程化经验相关，需要补充复杂业务场景的实践说明。', reasons: ['组件经验相关'], gaps: ['复杂业务场景'], risks: [], eligible: true, blockers: [] } },
  { uid: 'boss:s5', platform: 'boss', jobId: 's5', title: '前端开发工程师', salaryText: '12–16K', salaryMinK: 12, salaryMaxK: 16, city: '深圳', district: '龙岗', experience: '1–3年', degree: '本科', skills: ['Vue', '小程序'], tags: ['外包'], welfare: [], company: '城际信息服务', companyIndustry: '信息技术', companyScale: '100–499人', companyType: '民营', companyStage: '', hrName: '', hrTitle: '', description: '岗位含驻场安排，部分项目以外包方式交付。', url: 'https://example.invalid/jobs/s5', savedAt: '2026-11-01T04:00:00.000Z', lastSeenAt: '2026-11-04T04:00:00.000Z', star: false, match: { score: 61, verdict: 'weak', summary: '技术栈部分匹配，岗位涉及驻场和外包交付，需确认劳动合同主体。', reasons: ['技术栈部分匹配'], gaps: ['外包交付'], risks: [], eligible: true, blockers: [] } },
  { uid: 'boss:s6', platform: 'boss', jobId: 's6', title: 'Node.js 后端开发', salaryText: '18–26K', salaryMinK: 18, salaryMaxK: 26, city: '杭州', district: '滨江', experience: '应届', degree: '本科', skills: ['Node.js', 'NestJS', 'SQL'], tags: [], welfare: [], company: '松果云', companyIndustry: '云计算', companyScale: '20–99人', companyType: '民营', companyStage: 'A轮', hrName: '', hrTitle: '', description: '参与 Node.js 服务开发。', url: 'https://example.invalid/jobs/s6', savedAt: '2026-11-01T03:00:00.000Z', lastSeenAt: '2026-11-04T03:00:00.000Z', star: true, match: { score: 86, verdict: 'good', summary: 'Node.js 和 NestJS 经验与岗位要求相符，需进一步确认数据库能力要求。', reasons: ['Node.js 相符'], gaps: ['数据库'], risks: [], eligible: true, blockers: [] } },
  { uid: 'boss:s7', platform: 'boss', jobId: 's7', title: '前端开发实习生', salaryText: '200–250/天', salaryMinK: null, salaryMaxK: null, city: '上海', district: '徐汇', experience: '在校', degree: '本科', skills: ['React', 'CSS'], tags: ['实习'], welfare: [], company: '白鹭互动', companyIndustry: '互动娱乐', companyScale: '100–499人', companyType: '民营', companyStage: '', hrName: '', hrTitle: '', description: '实习岗位，参与页面实现。', url: 'https://example.invalid/jobs/s7', savedAt: '2026-11-01T02:00:00.000Z', lastSeenAt: '2026-11-04T02:00:00.000Z', star: false, match: null },
  { uid: 'boss:s8', platform: 'boss', jobId: 's8', title: '软件开发工程师（校招）', salaryText: '16–24K', salaryMinK: 16, salaryMaxK: 24, city: '深圳', district: '南山', experience: '应届', degree: '本科', skills: ['JavaScript', 'Java', 'SQL'], tags: [], welfare: [], company: '北辰数字', companyIndustry: '软件', companyScale: '500–999人', companyType: '民营', companyStage: '', hrName: '', hrTitle: '', description: '校招软件开发，包含前端与服务端协作。', url: 'https://example.invalid/jobs/s8', savedAt: '2026-11-01T01:00:00.000Z', lastSeenAt: '2026-11-04T01:00:00.000Z', star: false, match: { score: 80, verdict: 'good', summary: '工程实践要求匹配，Java 岗位职责比重需要沟通确认。', reasons: ['工程实践匹配'], gaps: ['Java 比重'], risks: [], eligible: true, blockers: [] } },
];

const store: Record<string, unknown> = {
  'job-progress-v1:boss%3As4': { status: 'prepared', at: '2026-11-03T01:00:00.000Z' },
  'job-progress-v1:boss%3As6': { status: 'opened', at: '2026-11-03T02:00:00.000Z' },
  'job-progress-v1:boss%3As8': { status: 'sent', at: '2026-11-03T03:00:00.000Z' },
  'job-progress-v1:boss%3As2': { status: 'sent', at: '2026-11-03T04:00:00.000Z' },
  // s8：已过招呼，两个真实节点，并有待确认的新节点（E3）。s2：初聊、无待确认（E2）。
  'job-comm-v1:boss%3As8': {
    nodes: [
      { id: 'greet', label: '打招呼', state: 'done', sub: '11/02', detail: '已发 + 简历图' },
      { id: 'chat', label: '初聊', state: 'current', detail: '已回复' },
    ],
    pending: { id: 'onsite', label: '一面', sub: '周五', hint: '摘自对话' },
    baseline: '',
    sync: { at: '2026-11-04T06:22:00.000Z', count: 12 },
    messages: [
      { id: 's8-1', role: 'hr', text: '你好，看了你的简历，方便聊聊吗？', at: '2026-11-05T06:00:00.000Z' },
      { id: 's8-2', role: 'me', text: '你好，方便的，请问岗位还在招吗？', at: '2026-11-05T06:05:00.000Z' },
      { id: 's8-3', role: 'hr', text: '在招的。你这边什么时候有空面试？周五下午可以吗？', at: '2026-11-05T06:12:00.000Z' },
    ],
  },
  'job-comm-v1:boss%3As2': {
    nodes: [
      { id: 'greet', label: '打招呼', state: 'done', sub: '11/01', detail: '已发' },
      { id: 'chat', label: '初聊', state: 'current', detail: '' },
    ],
    pending: null,
    baseline: '',
    sync: { at: '2026-11-04T03:08:00.000Z', count: 5 },
    messages: [
      { id: 's2-1', role: 'hr', text: '你好，看了你的简历，方便聊聊吗？', at: '2026-11-05T02:40:00.000Z' },
      { id: 's2-2', role: 'me', text: '你好，方便的，请问岗位还在招吗？', at: '2026-11-05T02:48:00.000Z' },
      { id: 's2-3', role: 'hr', text: '在招的。你这边什么时候有空面试？周五下午可以吗？', at: '2026-11-05T02:55:00.000Z' },
      { id: 's2-4', role: 'me', text: '周五可以，想先确认下工作内容和编制情况。', at: '2026-11-05T03:02:00.000Z' },
      { id: 's2-5', role: 'hr', text: '好的，收到。', at: '2026-11-05T03:08:00.000Z' },
    ],
  },
};
const listeners: Listener[] = [];
const scoreDelay = Number(params.get('scoreDelay') || 0);
const state = {
  jobs: scenario === 'empty' ? [] : jobs.map((job) => (
    scenario === 'missing-jd' && job.uid === 'boss:s2' ? { ...job, description: '' } : { ...job }
  )),
  failReads: scenario === 'error',
  hangReads: scenario === 'loading',
  settings: {
    mode: 'auto', autoCapture: true, autoScore: false, showBadge: true, dedupe: true, maxJobs: 800,
    activeProviderId: 'demo',
    privacy: { redactPII: true, sendCompanyName: true, confirmBeforeSend: false },
    filters: { enabled: false, keywordsInclude: [], keywordsExclude: ['外包', '实习'], riskKeywords: ['驻场'], cities: [], salaryMinK: null, salaryMaxK: null, experience: [], degrees: [], excludeCompanies: [] },
  },
  providers: params.get('providers') === '0' ? [] : [{ id: 'demo', name: '演示接口', protocol: 'openai-chat', baseUrl: 'https://example.invalid/v1', apiKey: 'sk-demo', model: 'demo', extraHeaders: {}, temperature: 0.3, maxTokens: 2048 }],
  profile: {
    schemaVersion: 1,
    target: { jobTitles: ['前端工程师'], cities: ['深圳'], salaryMinK: 18, salaryMaxK: 30, industries: ['互联网'], companySizes: [], workModes: [] },
    basics: { name: '', yearsOfExperience: 1, education: '本科', currentTitle: '前端工程师' },
    capabilities: { skills: ['Vue', 'TypeScript'], strengths: ['组件开发'], industryExperience: ['软件'] },
    workSummary: '虚构的一年前端实践，仅用于界面预览。', projectSummary: '虚构组件库项目。', highlights: ['虚构预览'],
    preference: { avoidKeywords: [], dealbreakers: [], notes: '' },
    updatedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z',
  },
  ctx: { platform: 'boss', url: 'https://example.invalid/jobs/s3', jobKey: 's3', isChat: false },
  failUids: new Set(String(params.get('fail') || '').split(',').filter(Boolean)),
};

function previewFingerprint() {
  return profileFingerprint(state.profile, state.providers[0] || { model: 'demo' });
}

// s1/s2 盖当前画像戳，指纹模式应跳过；s4 盖过期戳，应重新分析。其余已有结果视为尚未盖戳。
const previewFp = state.providers.length ? previewFingerprint() : '';
for (const job of state.jobs) {
  if (!job.match || !previewFp) continue;
  if (job.uid === 'boss:s1' || job.uid === 'boss:s2') job.match = { ...job.match, profileFp: previewFp };
  else if (job.uid === 'boss:s4') job.match = { ...job.match, profileFp: 'stale-preview-fp' };
}

function broadcast(msg: object) { listeners.forEach((fn) => { try { fn(msg, {}, () => {}); } catch { /* 预览监听失败不影响页面 */ } }); }

function respond(msg: PreviewMessage) {
  switch (msg.type) {
    case 'SETTINGS_GET': return state.settings;
    case 'SETTINGS_SAVE':
      state.settings = { ...state.settings, ...msg.patch, privacy: { ...state.settings.privacy, ...(msg.patch && msg.patch.privacy) }, filters: { ...state.settings.filters, ...(msg.patch && msg.patch.filters) } };
      return state.settings;
    case 'JOB_LIST_REQUEST': return state.jobs;
    case 'JOB_STAR_TOGGLE': state.jobs = state.jobs.map((job) => job.uid === msg.uid ? { ...job, star: !job.star } : job); return state.jobs;
    case 'JOB_DELETE': state.jobs = state.jobs.filter((job) => job.uid !== msg.uid); broadcast({ type: 'JOBS_UPDATED' }); return state.jobs;
    case 'JOB_CLEAR_REQUEST': state.jobs = []; return state.jobs;
    case 'GREETING_SAVE': state.jobs = state.jobs.map((job) => job.uid === msg.uid ? { ...job, greetingDraft: msg.text } : job); return state.jobs;
    case 'ACTIVE_CONTEXT_REQUEST': return { platform: state.ctx.platform, url: state.ctx.url, jobKey: state.ctx.jobKey, isChat: state.ctx.isChat, platformName: 'BOSS直聘' };
    case 'AI_PROVIDERS_GET': return state.providers;
    case 'PROFILE_GET': return state.profile;
    case 'PROFILE_SAVE': state.profile = msg.profile as typeof state.profile; return state.profile;
    case 'AI_MATCH_SCORE': {
      if (state.failUids.has(String(msg.uid))) throw new Error('超时');
      const current = state.jobs.find((job) => job.uid === msg.uid);
      if (current && !String(current.description || '').trim()) {
        const blocked: Match = { incomplete: 'missing-description', score: null, summary: '没有岗位描述，这次没有完成分析', at: '2026-11-04T00:00:00.000Z' };
        state.jobs = state.jobs.map((job) => job.uid === msg.uid ? { ...job, match: blocked } : job);
        throw new Error(String(blocked.summary));
      }
      const match: Match = { score: 82, verdict: 'good', eligible: true, blockers: [], dims: { skill: 80, experience: 70, requirement: 75, location: 90 }, reasons: ['虚构分析'], gaps: [], risks: [], summary: '这是预览用的虚构分析结果。', greetings: { short: '虚构短招呼', standard: '虚构标准招呼', detailed: '虚构长招呼' }, greeting: '虚构标准招呼', at: '2026-11-04T00:00:00.000Z', profileFp: previewFingerprint() };
      state.jobs = state.jobs.map((job) => job.uid === msg.uid ? { ...job, match } : job);
      return match;
    }
    case 'AI_TAILOR_RESUME': return { matchedSkills: ['Vue'], missingSkills: [], keywordsToAlign: ['组件'], summaryDraft: '虚构的自我评价草稿。', bulletSuggestions: ['把项目放前'], tips: ['核对真实经历'], note: '' };
    case 'AI_SUGGEST_REPLY': {
      const ask = String(msg.instruction || '');
      if (!ask.trim()) throw new Error('请先说明怎么改这条建议');
      if (/外包/.test(ask)) return { text: '您好，感谢回复。想再确认一下这个岗位是公司正式编制，还是外包或派遣？方便的话麻烦说明一下。' };
      if (/加班/.test(ask)) return { text: '您好，感谢回复。想了解一下咱们团队平时的加班情况，周末是否需要到岗？' };
      if (/工作内容|模块/.test(ask)) return { text: '您好，感谢回复。方便介绍一下这个岗位日常主要负责哪些工作吗？' };
      if (/面试|视频|现场/.test(ask)) return { text: '您好，感谢回复。想确认一下面试是视频还是现场，需要提前准备什么吗？' };
      if (/薪资|工资|待遇/.test(ask)) return { text: '您好，感谢回复。想再了解一下薪资结构，底薪、绩效和年终大概如何组成？' };
      return { text: '您好，感谢回复。我想再礼貌地确认一下刚才提到的安排，方便的话请帮忙说明一下。' };
    }
    case 'OPEN_OPTIONS': return { ok: true };
    case 'OPEN_JOB_CHAT': return { ok: true, mode: 'opened', tabId: 1 };
    default: return { ok: true };
  }
}

previewWindow.chrome = {
  runtime: {
    lastError: null,
    id: 'browse-preview',
    sendMessage(msg: PreviewMessage, cb?: (env: object) => void) {
      const latency = msg.type === 'AI_MATCH_SCORE' ? (scoreDelay || 20) : 20;
      const finish = (env: object) => { if (typeof cb === 'function') setTimeout(() => cb(env), latency); };
      if (msg.type === 'JOB_LIST_REQUEST' && state.hangReads) return undefined;
      if (msg.type === 'JOB_LIST_REQUEST' && state.failReads) return finish({ ok: false, error: '本地数据暂时无法读取' });
      try { finish({ ok: true, data: respond(msg) }); }
      catch (error) { finish({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return undefined;
    },
    onMessage: { addListener: (fn: Listener) => listeners.push(fn), removeListener: (fn: Listener) => { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); } },
    getURL: (path: string) => path,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (!keys) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        list.forEach((key) => { if (key in store) out[key] = store[key]; });
        return out;
      },
      set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  tabs: { create: (options?: { url?: string }) => { previewWindow.__previewOpened = options?.url || ''; return Promise.resolve({ id: 1 }); } },
  downloads: { download: async () => 1 },
};

previewWindow.__previewCapture = (partial: Partial<Job> = {}) => {
  const uid = partial.uid || `boss:new-${Date.now()}`;
  const job: Job = {
    platform: 'boss',
    jobId: uid,
    title: '海外投放专员',
    salaryText: '12–18K',
    salaryMinK: 12,
    salaryMaxK: 18,
    city: '深圳',
    district: '南山',
    experience: '1–3年',
    degree: '本科',
    skills: ['投放'],
    tags: [],
    welfare: [],
    company: '海风传媒',
    hrName: '陈先生',
    hrTitle: '招聘',
    description: '预览用新收录岗位。',
    url: 'https://example.invalid/jobs/new',
    savedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    star: false,
    match: null,
    ...partial,
    uid,
  };
  state.jobs = [job, ...state.jobs.filter((item) => item.uid !== uid)];
  broadcast({ type: 'JOBS_UPDATED', added: 1 });
  return job;
};
previewWindow.__previewRemoveJob = (uid) => {
  state.jobs = state.jobs.filter((job) => job.uid !== uid);
  broadcast({ type: 'JOBS_UPDATED' });
};
previewWindow.__previewAllowReads = () => { state.failReads = false; state.hangReads = false; };
previewWindow.__previewFail = (uid, on = true) => { if (on) state.failUids.add(uid); else state.failUids.delete(uid); };
previewWindow.__previewAutoQueue = (uids) => broadcast({ type: 'JOBS_UPDATED', autoQueue: uids });
const previewAuto = String(params.get('auto') || '').split(',').filter(Boolean);
if (previewAuto.length) setTimeout(() => broadcast({ type: 'JOBS_UPDATED', autoQueue: previewAuto }), 600);
previewWindow.__previewState = state;
