// 开发构建标识：npm run build 的产物在 manifest 名称后加「 · dev」，
// 扩展管理页、工具栏和设置页都能一眼区分本地开发版与正式安装版。
// 发版脚本以 JFA_RELEASE=1 构建，跳过标记。
export const DEV_SUFFIX = ' · dev';

export function toDevManifest(manifest) {
  const name = String(manifest?.name || '');
  if (!name || isDevBuild(manifest)) return manifest;
  const action = manifest.action
    ? { ...manifest.action, default_title: `${manifest.action.default_title || name}${DEV_SUFFIX}` }
    : undefined;
  return {
    ...manifest,
    name: `${name}${DEV_SUFFIX}`,
    short_name: manifest.short_name ? `${manifest.short_name} dev` : manifest.short_name,
    ...(action ? { action } : {}),
  };
}

export function isDevBuild(manifest) {
  return String(manifest?.name || '').endsWith(DEV_SUFFIX);
}

// 界面里读取当前运行的 manifest（预览环境可能没有 chrome.runtime）。
export function runningDevBuild() {
  try {
    return isDevBuild(chrome.runtime.getManifest());
  } catch {
    return false;
  }
}
