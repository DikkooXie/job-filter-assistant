// 扩展内更新的浏览器层：文件夹授权（File System Access）、下载 Release 安装包、覆盖写入并重新加载。
// 纯逻辑在 ../common/update.js。
import { unzipSync, strFromU8 } from '../vendor/fflate.module.js';
import {
  RELEASE_API, MAX_PACKAGE_BYTES, compareVersions, parseRelease,
  packageManifestError, isSameInstall, planWrites, unzipGuard, toHex,
} from '../common/update.js';

const DB_NAME = 'jobHelperUpdate';
const STORE = 'handles';
const HANDLE_KEY = 'extDir';
const PICKER_ID = 'job-filter-assistant-ext';
export const REOPEN_FLAG = 'reopenAfterUpdate';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const loadHandle = () => idb('readonly', (s) => s.get(HANDLE_KEY));
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, HANDLE_KEY));
export const forgetFolder = () => idb('readwrite', (s) => s.delete(HANDLE_KEY));

export const supportsFolderAccess = () => typeof globalThis.showDirectoryPicker === 'function';

async function readManifest(dir) {
  try {
    const file = await (await dir.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}
const selfManifest = () => chrome.runtime.getManifest();

/** 授权状态：none（未选择）/ granted（已授权）/ prompt（重启浏览器后需再确认）/ denied */
export async function folderStatus() {
  const handle = await loadHandle();
  if (!handle) return { state: 'none', name: '' };
  let state = 'prompt';
  try { state = await handle.queryPermission({ mode: 'readwrite' }); } catch {}
  return { state, name: handle.name };
}

/** 让用户选择扩展所在文件夹；必须由点击触发。 */
export async function pickFolder() {
  if (!supportsFolderAccess()) throw new Error('当前浏览器不支持文件夹授权，请使用新版 Edge 或 Chrome');
  let handle;
  try {
    handle = await globalThis.showDirectoryPicker({ id: PICKER_ID, mode: 'readwrite' });
  } catch (e) {
    if (e?.name === 'AbortError') return null;
    throw new Error(`无法使用该文件夹：${e?.message || e}。请不要直接选择「下载」或「桌面」，而是选择其中解压出来的扩展文件夹`);
  }
  if (!isSameInstall(await readManifest(handle), selfManifest())) {
    throw new Error(`「${handle.name}」不是当前正在运行的扩展文件夹（里面的 manifest.json 不一致），请选择你在扩展管理页「加载解压缩的扩展」时选的那个文件夹`);
  }
  await saveHandle(handle);
  return handle.name;
}

/** 确保拥有写权限；需要时弹出浏览器确认（必须由点击触发）。 */
async function ensureWritable() {
  const handle = await loadHandle();
  if (!handle) throw new Error('请先选择扩展所在的文件夹');
  let state = await handle.queryPermission({ mode: 'readwrite' });
  if (state !== 'granted') state = await handle.requestPermission({ mode: 'readwrite' });
  if (state !== 'granted') throw new Error('没有获得文件夹写入权限，更新已取消');
  return handle;
}

/** 查询 GitHub 最新正式版。返回 parseRelease 结果加 { current, hasUpdate }。 */
export async function fetchLatestRelease() {
  const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (res.status === 404) throw new Error('还没有发布任何版本');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub 请求过于频繁，请稍后再试');
  if (!res.ok) throw new Error(`检查更新失败（HTTP ${res.status}）`);
  const release = parseRelease(await res.json());
  const current = selfManifest().version;
  return { ...release, current, hasUpdate: compareVersions(release.version, current) > 0 };
}

async function download(url, onProgress) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`下载安装包失败（HTTP ${res.status}）`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_PACKAGE_BYTES) throw new Error('安装包过大，已停止');
  const reader = res.body.getReader();
  const chunks = [];
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

async function writeFile(root, segments, data) {
  let dir = root;
  for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
  const writable = await (await dir.getFileHandle(segments.at(-1), { create: true })).createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
}

/**
 * 下载并安装 release（fetchLatestRelease 的结果），成功后重新加载扩展。
 * 必须由点击触发（可能需要请求文件夹权限）。onProgress({ phase, received, total, done, count })。
 */
export async function installRelease(release, onProgress) {
  const handle = await ensureWritable(); // 先拿权限：用户手势在长时间下载后可能失效
  const self = selfManifest();
  if (!isSameInstall(await readManifest(handle), self)) {
    throw new Error('授权的文件夹已不是当前运行的扩展，请重新选择文件夹');
  }

  const zip = await download(release.zipUrl, onProgress);
  onProgress?.({ phase: 'verify' });
  if (release.zipSha256) {
    const actual = toHex(await crypto.subtle.digest('SHA-256', zip));
    if (actual !== release.zipSha256) throw new Error('安装包校验值与 GitHub 记录不一致，已停止');
  }
  let files;
  try {
    files = unzipSync(zip, { filter: unzipGuard() });
  } catch (e) {
    throw new Error(/已停止/.test(e?.message) ? e.message : '安装包损坏，无法解压');
  }
  let remote = null;
  try { remote = JSON.parse(strFromU8(files['manifest.json'] || new Uint8Array())); } catch {}
  const problem = await packageManifestError(remote, self, chrome.runtime.id);
  if (problem) throw new Error(problem);
  const writes = planWrites(files);

  // 下载期间文件夹可能被改动，写入前再确认一次
  if (!isSameInstall(await readManifest(handle), self)) {
    throw new Error('授权的文件夹在下载期间被改动，更新已取消');
  }
  for (let i = 0; i < writes.length; i++) {
    await writeFile(handle, writes[i].segments, writes[i].data);
    onProgress?.({ phase: 'write', done: i + 1, count: writes.length });
  }

  await chrome.storage.local.set({ [REOPEN_FLAG]: true });
  onProgress?.({ phase: 'reload' });
  setTimeout(() => chrome.runtime.reload(), 600);
}
