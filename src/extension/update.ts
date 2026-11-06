// 扩展内更新的浏览器层：文件夹授权（File System Access）、下载 Release 安装包、覆盖写入并重新加载。
// 纯逻辑在 ../common/update.js。
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import {
  MAX_PACKAGE_BYTES, parseRelease, releaseRequest, resolvePreviewCheck, assessUpdate, previewUnavailable,
  packageManifestError, isSameInstall, planWrites, unzipGuard, toHex, staleAssets, changelogEntries,
} from '../common/update.js';
import type { ChangelogEntry, InstalledManifest, UpdateCheck } from '../common/update.js';

const DB_NAME = 'jobHelperUpdate';
const STORE = 'handles';
const HANDLE_KEY = 'extDir';
const PICKER_ID = 'job-filter-assistant-ext';
export const REOPEN_FLAG = 'reopenAfterUpdate';

// File System Access API 不在标准 lib.dom 里，这里只声明实际用到的成员。
interface FsWritable {
  write(data: unknown): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FsFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}

interface FsDirHandle {
  name: string;
  queryPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterableIterator<string>;
}

type DirectoryPicker = (opts: { id: string; mode: 'readwrite' }) => Promise<FsDirHandle>;

/** 更新进度回调；各阶段携带的字段不同。 */
export interface UpdateProgress {
  phase: 'download' | 'verify' | 'write' | 'reload';
  received?: number;
  total?: number;
  done?: number;
  count?: number;
}
export type ProgressFn = (progress: UpdateProgress) => void;

/** 文件夹授权状态：none（未选择）/ granted（已授权）/ prompt（重启浏览器后需再确认）/ denied */
export type FolderState = 'none' | 'granted' | 'prompt' | 'denied';

function idb<T = unknown>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result as T); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const loadHandle = () => idb<FsDirHandle | undefined>('readonly', (s) => s.get(HANDLE_KEY));
const saveHandle = (h: FsDirHandle) => idb('readwrite', (s) => s.put(h, HANDLE_KEY));
export const forgetFolder = () => idb('readwrite', (s) => s.delete(HANDLE_KEY));

function directoryPicker(): DirectoryPicker | undefined {
  return (globalThis as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
}

export const supportsFolderAccess = () => typeof directoryPicker() === 'function';

async function readManifest(dir: FsDirHandle): Promise<unknown> {
  try {
    const file = await (await dir.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}
const selfManifest = (): InstalledManifest => chrome.runtime.getManifest();

/** 授权状态：none（未选择）/ granted（已授权）/ prompt（重启浏览器后需再确认）/ denied */
export async function folderStatus(): Promise<{ state: FolderState; name: string }> {
  const handle = await loadHandle();
  if (!handle) return { state: 'none', name: '' };
  let state: FolderState = 'prompt';
  try { state = await handle.queryPermission({ mode: 'readwrite' }); } catch { /* 有些浏览器不支持查询，按待确认处理 */ }
  return { state, name: handle.name };
}

/** 弹出文件夹选择窗口并校验是当前扩展；取消时返回 null。必须由点击触发。 */
async function chooseFolder(): Promise<FsDirHandle | null> {
  const picker = directoryPicker();
  if (!picker) throw new Error('当前浏览器不支持文件夹授权，请按下方说明手动更新');
  let handle: FsDirHandle;
  try {
    handle = await picker({ id: PICKER_ID, mode: 'readwrite' });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return null;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`无法使用该文件夹：${message}。请不要直接选择「下载」或「桌面」，而是选择其中解压出来的扩展文件夹`);
  }
  if (!isSameInstall(await readManifest(handle), selfManifest())) {
    throw new Error(`「${handle.name}」不是当前正在运行的扩展文件夹。请在扩展管理页查看本扩展的「来源」，选择那里显示的文件夹`);
  }
  await saveHandle(handle);
  return handle;
}

/** 取得可写的扩展文件夹：没授权过就弹出选择窗口，授权过期就请求确认。取消时返回 null。 */
async function getWritableFolder(): Promise<FsDirHandle | null> {
  const saved = await loadHandle();
  if (!saved) return chooseFolder();
  let state = await saved.queryPermission({ mode: 'readwrite' });
  if (state !== 'granted') state = await saved.requestPermission({ mode: 'readwrite' });
  if (state !== 'granted') throw new Error('没有获得文件夹写入权限，更新已取消');
  return saved;
}

/** 扩展管理页中本扩展的详情地址（可看到「来源」路径）。 */
export function extensionsPageUrl(): string {
  const scheme = /\bEdg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
  return `${scheme}://extensions/?id=${chrome.runtime.id}`;
}

/** 带 HTTP 状态码的请求错误，供调用方区分 404 与网络错误。 */
class GithubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

async function fetchGithub(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (res.status === 404) throw new GithubError('还没有发布任何版本', 404);
  if (res.status === 403 || res.status === 429) throw new Error('GitHub 请求过于频繁，请稍后再试');
  if (!res.ok) throw new Error(`检查更新失败（HTTP ${res.status}）`);
  return res.json();
}

/**
 * 按通道查询可安装版本。
 * stable：/releases/latest，拒绝 prerelease（与现网一致）。
 * preview：最近 20 条里版本号最高、且带 zip 的非草稿 prerelease；没有则返回「暂无预览版」，不抛错。
 * 正式版不比当前新时 hasUpdate 为 false；稳定通道上当前更高则带 aheadOfStable，不静默降级。
 */
export async function fetchLatestRelease(channel: unknown = 'stable'): Promise<UpdateCheck> {
  const request = releaseRequest(channel);
  const current = selfManifest().version;
  if (request.channel === 'preview') {
    try {
      const json = await fetchGithub(request.url);
      return resolvePreviewCheck(json, current);
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) return previewUnavailable(current);
      throw error;
    }
  }
  const release = parseRelease(await fetchGithub(request.url));
  return { ...assessUpdate(release, current, 'stable'), previewUnavailable: false };
}

/**
 * 当前通道的更新日志。请求地址与预览检查相同（最近 20 条 Release），
 * 稳定通道再去掉预发布。404 视为空列表。
 * 每条的 sections 按 Release 正文的 `## 新增` / `## UI 优化` / `## 缺陷修复` 拆开。
 */
export async function fetchReleaseNotes(channel: unknown = 'stable'): Promise<ChangelogEntry[]> {
  const url = releaseRequest('preview').url;
  try {
    const json = await fetchGithub(url);
    return changelogEntries(json, channel);
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return [];
    throw error;
  }
}

async function download(url: string, onProgress?: ProgressFn): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`下载安装包失败（HTTP ${res.status}）`);
  if (!res.body) throw new Error('下载安装包失败（响应体为空）');
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_PACKAGE_BYTES) throw new Error('安装包过大，已停止');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_PACKAGE_BYTES) { reader.cancel().catch(() => {}); throw new Error('安装包过大，已停止'); }
    chunks.push(value);
    onProgress?.({ phase: 'download', received, total });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}

/** 删除旧版本遗留的哈希命名构建产物（只动 assets/ 下、不在新包里的 js/css）。 */
async function removeStaleAssets(root: FsDirHandle, newPaths: string[]): Promise<void> {
  let assets: FsDirHandle;
  try { assets = await root.getDirectoryHandle('assets'); } catch { return; }
  const existing: string[] = [];
  for await (const name of assets.keys()) existing.push(`assets/${name}`);
  for (const path of staleAssets(existing, newPaths)) {
    try { await assets.removeEntry(path.slice('assets/'.length)); } catch { /* 已被删除或无权限，忽略 */ }
  }
}

async function writeFile(root: FsDirHandle, segments: string[], data: unknown): Promise<void> {
  let dir = root;
  for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
  const last = segments.at(-1);
  if (!last) throw new Error('安装包内有非法路径，已停止');
  const writable = await (await dir.getFileHandle(last, { create: true })).createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
}

/**
 * 下载并安装 release（fetchLatestRelease 的结果），成功后重新加载扩展并返回 true；用户取消选择文件夹时返回 false。
 * 必须由点击触发（首次会弹出文件夹选择窗口，之后可能请求权限确认）。onProgress({ phase, received, total, done, count })。
 */
export async function installRelease(release: UpdateCheck, onProgress?: ProgressFn): Promise<boolean> {
  // 先拿文件夹和权限：点击手势在长时间下载后会失效
  const handle = await getWritableFolder();
  if (!handle) return false;
  const self = selfManifest();
  if (!isSameInstall(await readManifest(handle), self)) {
    await forgetFolder();
    throw new Error('之前授权的文件夹已不是当前运行的扩展（可能被移动或替换），请再点一次「立即更新」重新选择');
  }
  if (!release.zipUrl) throw new Error('该版本没有可下载的安装包');

  const zip = await download(release.zipUrl, onProgress);
  onProgress?.({ phase: 'verify' });
  if (release.zipSha256) {
    const actual = toHex(await crypto.subtle.digest('SHA-256', zip));
    if (actual !== release.zipSha256) throw new Error('安装包校验值与 GitHub 记录不一致，已停止');
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: unzipGuard() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(/已停止/.test(message) ? message : '安装包损坏，无法解压');
  }
  let remote: unknown = null;
  try { remote = JSON.parse(strFromU8(files['manifest.json'] ?? new Uint8Array(), false)); } catch { /* 交给下方校验报错 */ }
  const problem = await packageManifestError(remote, self, chrome.runtime.id);
  if (problem) throw new Error(problem);
  const writes = planWrites(files);

  // 下载期间文件夹可能被改动，写入前再确认一次
  if (!isSameInstall(await readManifest(handle), self)) {
    throw new Error('授权的文件夹在下载期间被改动，更新已取消');
  }
  for (let i = 0; i < writes.length; i++) {
    const entry = writes[i];
    if (!entry) continue;
    await writeFile(handle, entry.segments, entry.data);
    onProgress?.({ phase: 'write', done: i + 1, count: writes.length });
  }

  await removeStaleAssets(handle, writes.map((w) => w.path));
  await chrome.storage.local.set({ [REOPEN_FLAG]: true });
  onProgress?.({ phase: 'reload' });
  setTimeout(() => chrome.runtime.reload(), 600);
  return true;
}
