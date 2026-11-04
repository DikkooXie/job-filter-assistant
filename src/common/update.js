// 扩展内更新的纯逻辑：版本比较、GitHub Release 解析、安装包校验。
// 不依赖 chrome.* / DOM，可直接在 Node 下单测（scripts/test_logic.mjs）。

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

/** 解析 "v1.2.3" / "1.2" → [1,2,3] / [1,2,0,0]；非法时返回 null。 */
export function parseVersion(text) {
  const raw = String(text ?? '').trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,3}$/.test(raw)) return null;
  const parts = raw.split('.').map(Number);
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** a > b 返回 1，相等 0，a < b -1；任一非法时抛错。 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`无法比较版本：${a} / ${b}`);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** 缺省、空值和其他写法都按稳定通道，避免旧设置或脏数据走到预览。 */
export function normalizeUpdateChannel(value) {
  return value === 'preview' ? 'preview' : 'stable';
}

/** 稳定通道仍请求 /releases/latest；预览通道只拉最近 20 条发布列表。 */
export function releaseRequest(channel) {
  const mode = normalizeUpdateChannel(channel);
  if (mode === 'preview') return { channel: 'preview', url: `${RELEASES_API}?per_page=20` };
  return { channel: 'stable', url: RELEASE_API };
}

function zipAsset(json) {
  const assets = Array.isArray(json?.assets) ? json.assets : [];
  return assets.find((asset) => /\.zip$/i.test(asset?.name || '') && asset?.browser_download_url) || null;
}

/**
 * GitHub Release JSON → { version, tag, name, notes, publishedAt, zipUrl, zipSize, pageUrl }。
 * 默认拒绝 draft / prerelease。仅 channel 为 preview 时接受 prerelease，draft 仍然拒绝。
 */
export function parseRelease(json, options = {}) {
  const channel = normalizeUpdateChannel(options?.channel);
  if (!json || typeof json !== 'object') throw new Error('发布信息格式不正确');
  if (json.draft || (json.prerelease && channel !== 'preview')) throw new Error('最新发布不是正式版本');
  const tag = String(json.tag_name || '');
  const version = tag.replace(/^v/i, '');
  if (!parseVersion(version)) throw new Error(`发布版本号不正确：${tag || '空'}`);
  const zip = zipAsset(json);
  if (!zip) throw new Error('该版本没有附带安装包（.zip）');
  if (!String(zip.browser_download_url).startsWith(DOWNLOAD_PREFIX)) throw new Error('安装包地址不是本项目的 GitHub 发布地址');
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(zip.digest || ''));
  return {
    version,
    tag,
    name: String(json.name || tag),
    notes: String(json.body || '').trim(),
    publishedAt: json.published_at || '',
    zipUrl: zip.browser_download_url,
    zipSize: Number(zip.size) || 0,
    zipSha256: digest ? digest[1].toLowerCase() : '',
    pageUrl: json.html_url || RELEASE_PAGE,
  };
}

/** 发布列表里第一个带 zip 的 prerelease（跳过 draft 和正式版）。没有则返回 null。 */
export function selectPreviewRelease(list) {
  if (!Array.isArray(list)) throw new Error('发布列表格式不正确');
  const hit = list.find((item) => item && item.prerelease === true && !item.draft && zipAsset(item));
  if (!hit) return null;
  return parseRelease(hit, { channel: 'preview' });
}

export function previewUnavailable(current) {
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
export function changelogTitle(name, version, tag) {
  const title = String(name || '').trim();
  if (!title) return '';
  if (title === tag || title.replace(/^v/i, '') === String(version || '')) return '';
  return title;
}

/** 把 Release 正文收成一行摘要：去掉常见标记，超长截断。 */
export function changelogSummary(notes, limit = 80) {
  const plain = String(notes || '')
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

/**
 * 最近发布列表 → 更新日志条目。数据仍是 GitHub Releases，不另建一份日志。
 * 稳定通道只留正式版；预览通道保留预发布（草稿始终丢掉）。没有安装包也可以出现在日志里。
 * 顺序沿用接口返回（通常是新的在前）。
 */
export function changelogEntries(list, channel = 'stable') {
  if (!Array.isArray(list)) throw new Error('发布列表格式不正确');
  const mode = normalizeUpdateChannel(channel);
  const items = [];
  for (const json of list) {
    if (!json || typeof json !== 'object' || json.draft) continue;
    if (mode !== 'preview' && json.prerelease) continue;
    const tag = String(json.tag_name || '');
    const version = tag.replace(/^v/i, '');
    if (!parseVersion(version)) continue;
    items.push({
      version,
      tag,
      title: changelogTitle(json.name, version, tag),
      summary: changelogSummary(json.body),
      publishedAt: json.published_at || '',
      pageUrl: json.html_url || '',
      prerelease: json.prerelease === true,
    });
  }
  return items;
}

/** 预览检查的纯结果：有包则比较版本，没有则走「暂无预览版」。 */
export function resolvePreviewCheck(list, current) {
  const found = selectPreviewRelease(list);
  if (!found) return previewUnavailable(current);
  return { ...assessUpdate(found, current, 'preview'), previewUnavailable: false };
}

/**
 * 把已解析的发布和当前版本合成检查结果。
 * 稳定通道上正式版更旧时只提示手动覆盖，hasUpdate 保持 false，避免静默降级。
 */
export function assessUpdate(release, current, channel = 'stable') {
  const mode = normalizeUpdateChannel(channel);
  const cmp = compareVersions(release.version, current);
  const hasUpdate = cmp > 0;
  const aheadOfStable = mode === 'stable' && cmp < 0;
  let message = '';
  if (aheadOfStable) message = AHEAD_OF_STABLE_MESSAGE;
  else if (!hasUpdate) message = `已是最新版本（${current}）`;
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
export async function extensionIdFromKey(key) {
  const bin = atob(String(key || ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let id = '';
  for (const byte of digest.slice(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  }
  return id;
}

/**
 * 校验下载包里的 manifest 能否安全替换当前扩展。
 * 返回错误文案；通过时返回空字符串。
 */
export async function packageManifestError(remote, self, selfId) {
  if (!remote || typeof remote !== 'object') return '安装包里没有有效的 manifest.json';
  if (remote.manifest_version !== 3) return '安装包不是 MV3 扩展';
  if (remote.name !== self.name) return `安装包名称不一致（${remote.name}）`;
  if (!remote.key) return '安装包缺少固定 ID 的 key，更新后数据会丢失，已停止';
  if (selfId && (await extensionIdFromKey(remote.key)) !== selfId) return '安装包的扩展 ID 与当前扩展不一致，已停止';
  if (!parseVersion(remote.version)) return `安装包版本号不正确：${remote.version}`;
  if (compareVersions(remote.version, self.version) <= 0) return `安装包版本（${remote.version}）不比当前版本新`;
  return '';
}

/**
 * 生成 fflate unzipSync 的 filter：拒绝条目过多或解压后过大的安装包。
 * 依据 zip 目录中声明的原始大小；fflate 按声明大小分配缓冲区，因此在解压前即可拦截。
 */
export function unzipGuard() {
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
export function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 授权文件夹里的 manifest 是否就是当前运行的扩展。 */
export function isSameInstall(folderManifest, self) {
  return !!folderManifest
    && folderManifest.name === self.name
    && folderManifest.version === self.version
    && (folderManifest.key || '') === (self.key || '');
}

/** zip 内路径是否可以安全写入（拒绝绝对路径、..、反斜杠、隐藏的系统文件）。 */
export function safeEntryPath(name) {
  const path = String(name || '');
  if (!path || path.endsWith('/')) return null;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)) return null;
  const segments = path.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  if (segments[0] === '__MACOSX' || segments.at(-1) === '.DS_Store') return null;
  return segments;
}

// Vite 旧版本产出的带内容哈希的 js/css（如 assets/options-8FXsuZlm.js）
const HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

/**
 * 更新后应删除的旧构建产物：仅限 assets/ 下带 Vite 内容哈希、且新安装包中已不存在的 js/css。
 * 新构建改用固定文件名，正常更新直接覆盖；这里只清理历史版本遗留，避免文件夹越来越大。
 */
export function staleAssets(existingPaths, newPaths) {
  const keep = new Set(newPaths || []);
  return (existingPaths || []).filter((p) => HASHED_ASSET.test(p) && !keep.has(p));
}

/** 把解压后的 { path: bytes } 整理成写入顺序：其他文件在前，manifest.json 最后。 */
export function planWrites(files) {
  const writes = [];
  let manifest = null;
  for (const [name, data] of Object.entries(files || {})) {
    const segments = safeEntryPath(name);
    if (!segments) continue;
    const entry = { path: segments.join('/'), segments, data };
    if (entry.path === 'manifest.json') manifest = entry;
    else writes.push(entry);
  }
  if (!manifest) throw new Error('安装包根目录没有 manifest.json');
  writes.push(manifest);
  return writes;
}
