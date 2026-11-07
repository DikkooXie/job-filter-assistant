// 扩展内更新的纯逻辑：版本比较、GitHub Release 解析、安装包校验。
// 不依赖 chrome.* / DOM，可直接在 Node 下单测（scripts/test_logic.mjs）。
import type { UpdateChannel } from './types.js';

export const RELEASE_REPO = 'DikkooXie/job-filter-assistant';
export const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases`;
export const RELEASE_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${RELEASE_REPO}/releases`;
export const NO_PREVIEW_MESSAGE = '暂无预览版';
export const AHEAD_OF_STABLE_MESSAGE = '当前高于正式版，请手动下载正式 zip 覆盖后重载';
export const MAX_PACKAGE_BYTES = 40 * 1024 * 1024;
// 解压后总大小与文件数上限，防止压缩炸弹
export const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
const DOWNLOAD_PREFIX = `https://github.com/${RELEASE_REPO}/releases/download/`;

export interface GithubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number | string;
  digest?: string;
}

export interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: GithubAsset[];
}

export interface ParsedRelease {
  version: string;
  tag: string;
  name: string;
  notes: string;
  publishedAt: string;
  zipUrl: string;
  zipSize: number;
  zipSha256: string;
  pageUrl: string;
}

/** 更新检查结果。暂无预览版时没有 version / zipUrl 等发布字段。 */
export interface UpdateCheck {
  version?: string;
  tag?: string;
  name?: string;
  notes?: string;
  publishedAt?: string;
  zipUrl?: string;
  zipSize?: number;
  zipSha256?: string;
  pageUrl?: string;
  current: string;
  channel: UpdateChannel;
  hasUpdate: boolean;
  aheadOfStable: boolean;
  message: string;
  previewUnavailable?: boolean;
}

/** 解析 "v1.2.3" / "1.2" → [1,2,3,0] / [1,2,0,0]；非法时返回 null。 */
export function parseVersion(text: unknown): number[] | null {
  const raw = String(text ?? '')
    .trim()
    .replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,3}$/.test(raw)) return null;
  const parts = raw.split('.').map(Number);
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** a > b 返回 1，相等 0，a < b -1；任一非法时抛错。 */
export function compareVersions(a: unknown, b: unknown): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`无法比较版本：${String(a)} / ${String(b)}`);
  for (let i = 0; i < 4; i++) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

/** 缺省、空值和其他写法都按稳定通道，避免旧设置或脏数据走到预览。 */
export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return value === 'preview' ? 'preview' : 'stable';
}

/** 稳定通道仍请求 /releases/latest；预览通道只拉最近 20 条发布列表。 */
export function releaseRequest(channel?: unknown): { channel: UpdateChannel; url: string } {
  const mode = normalizeUpdateChannel(channel);
  if (mode === 'preview') return { channel: 'preview', url: `${RELEASES_API}?per_page=20` };
  return { channel: 'stable', url: RELEASE_API };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function s(x: unknown): string {
  return typeof x === 'string' ? x : x == null ? '' : String(x);
}

function zipAsset(json: unknown): GithubAsset | null {
  if (!isObj(json) || !Array.isArray(json.assets)) return null;
  for (const asset of json.assets) {
    if (!isObj(asset)) continue;
    if (/\.zip$/i.test(s(asset.name)) && asset.browser_download_url) return asset as GithubAsset;
  }
  return null;
}

/**
 * GitHub Release JSON → { version, tag, name, notes, publishedAt, zipUrl, zipSize, pageUrl }。
 * 默认拒绝 draft / prerelease。仅 channel 为 preview 时接受 prerelease，draft 仍然拒绝。
 */
export function parseRelease(json: unknown, options: { channel?: unknown } = {}): ParsedRelease {
  const channel = normalizeUpdateChannel(options?.channel);
  if (!isObj(json)) throw new Error('发布信息格式不正确');
  if (json.draft || (json.prerelease && channel !== 'preview')) throw new Error('最新发布不是正式版本');
  const tag = s(json.tag_name);
  const version = tag.replace(/^v/i, '');
  if (!parseVersion(version)) throw new Error(`发布版本号不正确：${tag || '空'}`);
  const zip = zipAsset(json);
  if (!zip) throw new Error('该版本没有附带安装包（.zip）');
  const zipUrl = s(zip.browser_download_url);
  if (!zipUrl.startsWith(DOWNLOAD_PREFIX)) throw new Error('安装包地址不是本项目的 GitHub 发布地址');
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(s(zip.digest));
  return {
    version,
    tag,
    name: s(json.name) || tag,
    notes: s(json.body).trim(),
    publishedAt: s(json.published_at),
    zipUrl,
    zipSize: Number(zip.size) || 0,
    zipSha256: digest && digest[1] ? digest[1].toLowerCase() : '',
    pageUrl: s(json.html_url) || RELEASE_PAGE,
  };
}

/**
 * 非草稿、带 zip 的 prerelease 里取版本号最高的一条。没有则返回 null。
 * GitHub /releases 按 tag_name 字符串降序，v1.0.3.9 会排在 v1.0.3.10 前面，不能依赖列表顺序。
 */
export function selectPreviewRelease(list: unknown): ParsedRelease | null {
  if (!Array.isArray(list)) throw new Error('发布列表格式不正确');
  let best: ParsedRelease | null = null;
  for (const item of list) {
    if (!isObj(item) || item.prerelease !== true || item.draft || !zipAsset(item)) continue;
    const parsed = parseRelease(item, { channel: 'preview' });
    if (!best || compareVersions(parsed.version, best.version) > 0) best = parsed;
  }
  return best;
}

export function previewUnavailable(current: unknown): UpdateCheck {
  return {
    channel: 'preview',
    current: String(current ?? ''),
    hasUpdate: false,
    previewUnavailable: true,
    aheadOfStable: false,
    message: NO_PREVIEW_MESSAGE,
  };
}

/** 发布名如果只是版本号，日志里不再重复显示。 */
export function changelogTitle(name: unknown, version: unknown, tag: unknown): string {
  const title = s(name).trim();
  if (!title) return '';
  if (title === tag || title.replace(/^v/i, '') === String(version || '')) return '';
  return title;
}

const ISSUE_GROUP = /[（(]\s*#\d+(?:\s*[/／]\s*#\d+)*\s*[)）]/g;
const BARE_ISSUE = /(^|[\s，。；、])#\d+\b/g;
const SCHEME_CODE = /方案\s+[A-Za-z甲乙丙丁]/g;

function stripChannelLead(text: unknown): string {
  let next = s(text).trim();
  let prev: string;
  do {
    prev = next;
    next = next.replace(/^(?:预览|稳定)\s*[:：]\s*/, '').trim();
  } while (next !== prev);
  return next;
}

function plainBullet(text: unknown): string {
  const unmarked = s(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]/g, '');
  return stripChannelLead(unmarked)
    .replace(ISSUE_GROUP, '')
    .replace(BARE_ISSUE, '$1')
    .replace(SCHEME_CODE, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。；、：:])/g, '$1')
    .replace(/([，、；]){2,}/g, '$1')
    .replace(/^[，、；;：:\s]+/, '')
    .replace(/[；;，、\s]+$/, '')
    .trim();
}

/**
 * Release 正文 → 面向用户的条目。展示层清洗，不改发版说明本身。
 * 去掉重复的「预览：/稳定：」、issue 号和「方案 X」代号；按行、分号或句号拆开。
 * 没有可显示内容时返回空数组，调用方只留版本和时间。
 * 更新日志页不再平铺这份结果，版内三分区见 changelogSections。
 */
export function changelogBullets(notes: unknown): string[] {
  const raw = s(notes).replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const contentLines = lines.filter((line) => !/^#{1,6}\s+/.test(line));
  const listLines = contentLines.filter((line) => /^[-*•]\s+/.test(line) || /^\d+[.)．]\s+/.test(line));
  const useList = listLines.length > 0 && listLines.length === contentLines.length;
  const chunks = useList
    ? listLines.map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)．]\s+/, ''))
    : lines
        .map((line) => line.replace(/^#{1,6}\s+/, ''))
        .join('\n')
        .split(/\n+|；|;|。/)
        .map((part) => part.trim())
        .filter(Boolean);
  const bullets: string[] = [];
  for (const chunk of chunks) {
    const text = plainBullet(chunk);
    if (text) bullets.push(text);
  }
  return bullets;
}

/** 可解析的发布时间（毫秒）。空值或非法时返回 null，排序改走版本号。 */
function changelogPublishedMs(iso: unknown): number | null {
  if (!iso) return null;
  const time = Date.parse(String(iso));
  return Number.isNaN(time) ? null : time;
}

/**
 * 新的在前。两边都有发布时间且不相等时按时间降序；
 * 任一缺失、非法或时间相同则按版本号降序。
 * GitHub /releases 按 tag_name 字符串降序，四段版本不能依赖列表顺序。
 */
function compareChangelogEntries(a: ChangelogEntry, b: ChangelogEntry): number {
  const ta = changelogPublishedMs(a.publishedAt);
  const tb = changelogPublishedMs(b.publishedAt);
  if (ta !== null && tb !== null && ta !== tb) return tb - ta;
  return compareVersions(b.version, a.version);
}

/** 发布时刻，本地时区，精确到分钟。无法解析时返回空字符串。 */
export function formatChangelogWhen(iso: unknown): string {
  const date = new Date(s(iso));
  if (!iso || Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 与已安装版本号完全一致（允许一侧带 v 前缀）时，时间线上标「当前」。 */
export function isCurrentChangelogVersion(version: unknown, installed: unknown): boolean {
  const norm = (value: unknown) =>
    s(value)
      .trim()
      .replace(/^v/i, '');
  const current = norm(installed);
  const release = norm(version);
  return !!current && current === release;
}

export type ChangelogSectionKey = 'added' | 'ui' | 'fixed';
export type ChangelogSections = Record<ChangelogSectionKey, string[]>;

/** 版内三分区。标题字面与 GitHub Release 一致，顺序固定。 */
export const CHANGELOG_SECTION_ORDER = [
  { key: 'added', title: '新增' },
  { key: 'ui', title: 'UI 优化' },
  { key: 'fixed', title: '缺陷修复' },
] as const;

const CHANGELOG_SECTION_KEYS = new Map<string, ChangelogSectionKey>(
  CHANGELOG_SECTION_ORDER.map((section) => [section.title, section.key] as const),
);

function stripListMarker(line: unknown): string {
  return s(line)
    .replace(/^(?:[-*]|[•·∙●])\s+/, '')
    .replace(/^\d+[.)．]\s+/, '');
}

/**
 * 按 `## 新增` / `## UI 优化` / `## 缺陷修复` 拆 Release 正文。
 * 每条非空行是一件事，去掉列表标记和 issue / 方案代号，不按句号再拆。
 * 没有这三节标题的旧正文不归入「新增」；三类都空时调用方显示未分类说明。
 */
export function changelogSections(notes: unknown): ChangelogSections {
  const sections: ChangelogSections = { added: [], ui: [], fixed: [] };
  const raw = s(notes)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  let current: ChangelogSectionKey | null = null;
  let fence = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = trimmed.match(/^##\s+(.+)$/);
    if (heading) {
      current = CHANGELOG_SECTION_KEYS.get((heading[1] ?? '').trim()) || null;
      continue;
    }
    if (!current || !trimmed || /^#{1,6}(?:\s|$)/.test(trimmed) || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue;
    const text = plainBullet(stripListMarker(trimmed));
    if (text) sections[current].push(text);
  }
  return sections;
}

/** 把 Release 正文收成一行摘要：去掉常见标记，超长截断。 */
export function changelogSummary(notes: unknown, limit = 80): string {
  const plain = s(notes)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const max = Number(limit) > 0 ? Number(limit) : 80;
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).trimEnd()}…`;
}

export interface ChangelogEntry {
  version: string;
  tag: string;
  title: string;
  summary: string;
  bullets: string[];
  sections: ChangelogSections;
  publishedAt: string;
  pageUrl: string;
  prerelease: boolean;
}

/**
 * 最近发布列表 → 更新日志条目。数据仍是 GitHub Releases，不另建一份日志。
 * 稳定通道只留正式版；预览通道保留预发布（草稿始终丢掉）。没有安装包也可以出现在日志里。
 * 返回前按发布时间降序；时间戳缺失、非法或相同时按版本号降序。
 * sections 是版内三分区；没有对应标题时三个数组都为空，不把旧正文塞进「新增」。
 */
export function changelogEntries(list: unknown, channel: unknown = 'stable'): ChangelogEntry[] {
  if (!Array.isArray(list)) throw new Error('发布列表格式不正确');
  const mode = normalizeUpdateChannel(channel);
  const items: ChangelogEntry[] = [];
  for (const json of list) {
    if (!isObj(json) || json.draft) continue;
    if (mode !== 'preview' && json.prerelease) continue;
    const tag = s(json.tag_name);
    const version = tag.replace(/^v/i, '');
    if (!parseVersion(version)) continue;
    items.push({
      version,
      tag,
      title: changelogTitle(json.name, version, tag),
      summary: changelogSummary(json.body),
      bullets: changelogBullets(json.body),
      sections: changelogSections(json.body),
      publishedAt: s(json.published_at),
      pageUrl: s(json.html_url),
      prerelease: json.prerelease === true,
    });
  }
  items.sort(compareChangelogEntries);
  return items;
}

/** 预览检查的纯结果：有包则比较版本，没有则走「暂无预览版」。 */
export function resolvePreviewCheck(list: unknown, current: unknown): UpdateCheck {
  const found = selectPreviewRelease(list);
  if (!found) return previewUnavailable(current);
  return { ...assessUpdate(found, current, 'preview'), previewUnavailable: false };
}

/**
 * 把已解析的发布和当前版本合成检查结果。
 * 稳定通道上正式版更旧时只提示手动覆盖，hasUpdate 保持 false，避免静默降级。
 */
export function assessUpdate(release: ParsedRelease, current: unknown, channel: unknown = 'stable'): UpdateCheck {
  const mode = normalizeUpdateChannel(channel);
  const cmp = compareVersions(release.version, current);
  const hasUpdate = cmp > 0;
  const aheadOfStable = mode === 'stable' && cmp < 0;
  let message = '';
  if (aheadOfStable) message = AHEAD_OF_STABLE_MESSAGE;
  else if (!hasUpdate) message = `已是最新版本（${String(current)}）`;
  return {
    ...release,
    current: String(current ?? ''),
    channel: mode,
    hasUpdate,
    aheadOfStable,
    message,
  };
}

/** 按 Chrome 规则由 manifest key（base64 公钥）计算扩展 ID。浏览器与 Node 22 均可用。 */
export async function extensionIdFromKey(key: unknown): Promise<string> {
  const bin = atob(s(key));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let id = '';
  for (const byte of digest.slice(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  }
  return id;
}

export interface InstalledManifest {
  name?: string;
  version?: string;
  key?: string;
}

/**
 * 校验下载包里的 manifest 能否安全替换当前扩展。
 * 返回错误文案；通过时返回空字符串。
 */
export async function packageManifestError(
  remote: unknown,
  self: InstalledManifest,
  selfId?: unknown,
): Promise<string> {
  if (!isObj(remote)) return '安装包里没有有效的 manifest.json';
  if (remote.manifest_version !== 3) return '安装包不是 MV3 扩展';
  if (remote.name !== self.name) return `安装包名称不一致（${s(remote.name)}）`;
  if (!remote.key) return '安装包缺少固定 ID 的 key，更新后数据会丢失，已停止';
  if (selfId && (await extensionIdFromKey(remote.key)) !== selfId) return '安装包的扩展 ID 与当前扩展不一致，已停止';
  if (!parseVersion(remote.version)) return `安装包版本号不正确：${s(remote.version)}`;
  if (compareVersions(remote.version, self.version) <= 0) return `安装包版本（${s(remote.version)}）不比当前版本新`;
  return '';
}

/**
 * 生成 fflate unzipSync 的 filter：拒绝条目过多或解压后过大的安装包。
 * 依据 zip 目录中声明的原始大小；fflate 按声明大小分配缓冲区，因此在解压前即可拦截。
 */
export function unzipGuard(): (file: { originalSize?: unknown }) => boolean {
  let entries = 0;
  let total = 0;
  return (file) => {
    entries += 1;
    total += Number(file.originalSize) || 0;
    if (entries > MAX_ENTRIES) throw new Error('安装包文件数量异常，已停止');
    if (total > MAX_UNZIPPED_BYTES) throw new Error('安装包解压后过大，已停止');
    return true;
  };
}

/** Uint8Array → 小写十六进制 */
export function toHex(bytes: unknown): string {
  return Array.from(new Uint8Array(bytes as ArrayLike<number>), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 授权文件夹里的 manifest 是否就是当前运行的扩展。 */
export function isSameInstall(folderManifest: unknown, self: InstalledManifest): boolean {
  if (!isObj(folderManifest)) return false;
  return (
    folderManifest.name === self.name &&
    folderManifest.version === self.version &&
    s(folderManifest.key) === s(self.key)
  );
}

/** zip 内路径是否可以安全写入（拒绝绝对路径、..、反斜杠、隐藏的系统文件）。 */
export function safeEntryPath(name: unknown): string[] | null {
  const path = s(name);
  if (!path || path.endsWith('/')) return null;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return null;
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  if (segments[0] === '__MACOSX' || segments.at(-1) === '.DS_Store') return null;
  return segments;
}

// Vite 旧版本产出的带内容哈希的 js/css（如 assets/options-8FXsuZlm.js）
const HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

/**
 * 更新后应删除的旧构建产物：仅限 assets/ 下带 Vite 内容哈希、且新安装包中已不存在的 js/css。
 * 新构建改用固定文件名，正常更新直接覆盖；这里只清理历史版本遗留，避免文件夹越来越大。
 */
export function staleAssets(existingPaths: unknown, newPaths: unknown): string[] {
  const keep = new Set<string>(Array.isArray(newPaths) ? (newPaths as string[]) : []);
  const existing = Array.isArray(existingPaths) ? existingPaths : [];
  return existing.filter((p): p is string => typeof p === 'string' && HASHED_ASSET.test(p) && !keep.has(p));
}

export interface WriteEntry {
  path: string;
  segments: string[];
  data: unknown;
}

/** 把解压后的 { path: bytes } 整理成写入顺序：其他文件在前，manifest.json 最后。 */
export function planWrites(files: unknown): WriteEntry[] {
  const writes: WriteEntry[] = [];
  let manifest: WriteEntry | null = null;
  for (const [name, data] of Object.entries(isObj(files) ? files : {})) {
    const segments = safeEntryPath(name);
    if (!segments) continue;
    const entry: WriteEntry = { path: segments.join('/'), segments, data };
    if (entry.path === 'manifest.json') manifest = entry;
    else writes.push(entry);
  }
  if (!manifest) throw new Error('安装包根目录没有 manifest.json');
  writes.push(manifest);
  return writes;
}
