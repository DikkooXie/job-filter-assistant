// 领域核心类型：跨层共享（common / extension / pages / background）。
// 只放数据结构与联合类型；具体行为留在各自模块。

export type PlatformId = 'boss';

export type Verdict = 'strong' | 'good' | 'fair' | 'weak';

export type Mode = 'auto' | PlatformId;

export type UpdateChannel = 'stable' | 'preview';

/** 统一岗位对象（由 platforms.js 归一化后写入岗位库）。 */
export interface Job {
  uid: string;
  platform: PlatformId | string;
  jobId?: string;
  title?: string;
  salaryText?: string;
  salaryMinK?: number | null;
  salaryMaxK?: number | null;
  city?: string;
  district?: string;
  experience?: string;
  degree?: string;
  skills?: string[];
  tags?: string[];
  welfare?: string[];
  company?: string;
  companyIndustry?: string;
  companyScale?: string;
  companyType?: string;
  companyStage?: string;
  hrName?: string;
  hrTitle?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  savedAt?: string;
  lastSeenAt?: string;
  star?: boolean;
  match?: Match | null;
  greeting?: string;
  /** 用户编辑中的招呼语草稿（发送前的最终文案）。 */
  greetingDraft?: string;
  comm?: CommRecord;
  raw?: Record<string, unknown>;
  _filter?: FilterResult;
}

export interface MatchDims {
  skill: number | null;
  experience: number | null;
  requirement: number | null;
  location: number | null;
}

export interface MatchGreetings {
  short?: string;
  standard?: string;
  detailed?: string;
  /** 兼容历史字段名（如旧缓存的 enthusiastic / concise）。 */
  [key: string]: string | undefined;
}

export interface Match {
  /** 缺正文等降级结果带此标记；正常打分不带。 */
  incomplete?: string;
  score: number | null;
  verdict?: Verdict;
  eligible?: boolean;
  blockers?: string[];
  dims?: MatchDims | null;
  reasons?: string[];
  gaps?: string[];
  risks?: string[];
  summary?: string;
  greetings?: MatchGreetings;
  greeting?: string;
  at?: string;
  profileFp?: string;
}

export interface FilterResult {
  keep: boolean;
  matchedInclude: string[];
  matchedExclude: string[];
  risks: string[];
  reasons: string[];
}

export interface JobFilters {
  enabled: boolean;
  keywordsInclude: string[];
  keywordsExclude: string[];
  riskKeywords: string[];
  cities: string[];
  salaryMinK: number | null;
  salaryMaxK: number | null;
  experience: string[];
  degrees: string[];
  excludeCompanies: string[];
}

export interface PrivacySettings {
  redactPII: boolean;
  sendCompanyName: boolean;
  confirmBeforeSend: boolean;
}

export interface Settings {
  mode: Mode;
  autoCapture: boolean;
  autoScore: boolean;
  showBadge: boolean;
  dedupe: boolean;
  maxJobs: number;
  activeProviderId: string;
  updateChannel: UpdateChannel;
  privacy: PrivacySettings;
  filters: JobFilters;
}

export interface ProfileTarget {
  jobTitles: string[];
  cities: string[];
  salaryMinK: number | null;
  salaryMaxK: number | null;
  industries: string[];
  companySizes: string[];
  workModes: string[];
}

export interface ProfileBasics {
  name: string;
  yearsOfExperience: number | null;
  education: string;
  currentTitle: string;
}

export interface ProfileCapabilities {
  skills: string[];
  strengths: string[];
  industryExperience: string[];
}

export interface ProfilePreference {
  avoidKeywords: string[];
  dealbreakers: string[];
  notes: string;
}

export interface Profile {
  schemaVersion: number;
  target: ProfileTarget;
  basics: ProfileBasics;
  capabilities: ProfileCapabilities;
  workSummary: string;
  projectSummary: string;
  highlights: string[];
  preference: ProfilePreference;
  updatedAt: string;
  createdAt: string;
}

export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';

export interface AIProvider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /** 可选：完全自定义请求地址，非空则覆盖 baseUrl 拼接。 */
  requestUrl?: string;
  /** 可选：自定义模型列表地址。 */
  modelsUrl?: string;
  model: string;
  apiKey: string;
  anthropicVersion: string;
  /** 自定义请求头（如网关鉴权）。 */
  extraHeaders?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  discoveredModels: string[];
  updatedAt?: string;
}

/** 沟通/招呼记录，按岗位存在岗位库里。 */
export interface CommRecord {
  status?: string;
  sentAt?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface CaptureEntry {
  at: string;
  platform?: string;
  kind?: string;
  uid?: string;
  reason?: string;
  [key: string]: unknown;
}

/** 发布信息（GitHub Release），更新流程共用。 */
export interface ReleaseInfo {
  tag: string;
  name: string;
  version: string;
  notes: string;
  publishedAt: string;
  pageUrl: string;
  downloadUrl: string;
  preview: boolean;
}
