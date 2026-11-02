import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RELEASE_PAGE } from '../common/update.js';
import { folderStatus, pickFolder, fetchLatestRelease, installRelease, supportsFolderAccess } from '../ui/update.js';

const FOLDER_LABEL = {
  none: ['未授权', 'outline'],
  granted: ['已授权', 'secondary'],
  prompt: ['需确认', 'outline'],
  denied: ['已拒绝', 'destructive'],
};

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
function progressText(p) {
  if (!p) return '';
  if (p.phase === 'download') return p.total ? `正在下载 ${mb(p.received)} / ${mb(p.total)}（${Math.round((p.received / p.total) * 100)}%）` : `正在下载 ${mb(p.received)}`;
  if (p.phase === 'verify') return '正在校验安装包…';
  if (p.phase === 'write') return `正在写入文件 ${p.done} / ${p.count}`;
  if (p.phase === 'reload') return '更新完成，扩展即将重新加载，设置页会自动重新打开…';
  return '';
}

export default function UpdatePanel({ onConfirm }) {
  const { version } = chrome.runtime.getManifest();
  const [folder, setFolder] = useState({ state: 'none', name: '' });
  const [release, setRelease] = useState(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(() => (location.hash === '#updated' ? `已更新到 ${version}` : ''));
  const installing = !!progress;

  const refresh = useCallback(() => folderStatus().then(setFolder).catch(() => {}), []);
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  const run = async (fn) => {
    setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e?.message || String(e)); }
  };
  const choose = () => run(async () => {
    const name = await pickFolder();
    if (name) setMessage(`已授权文件夹「${name}」`);
    await refresh();
  });
  const check = () => run(async () => {
    setChecking(true);
    try {
      const r = await fetchLatestRelease();
      setRelease(r);
      if (!r.hasUpdate) setMessage(`已是最新版本（${r.current}）`);
    } finally { setChecking(false); }
  });
  const install = () => onConfirm({
    title: `更新到 ${release.version}？`,
    body: '将下载安装包并覆盖扩展文件夹中的文件，完成后扩展自动重新加载。岗位、画像和配置会保留。',
    // 不 await：让确认框立即关闭，进度显示在本面板（仍处于点击手势内，可请求文件夹权限）
    run: () => { run(async () => {
      setProgress({ phase: 'download', received: 0, total: release.zipSize });
      try {
        await installRelease(release, setProgress);
      } catch (e) {
        setProgress(null);
        await refresh();
        throw e;
      }
    }); },
  });

  const [folderText, folderVariant] = FOLDER_LABEL[folder.state] || FOLDER_LABEL.prompt;
  const canInstall = release?.hasUpdate && folder.state !== 'none' && !installing;

  return <Card>
    <CardHeader>
      <CardTitle>关于与更新</CardTitle>
      <CardDescription>首次使用请选择扩展所在的文件夹（就是在扩展管理页「加载解压缩的扩展」时选的那个），之后可以直接在这里更新。扩展 ID 已固定，岗位、画像和配置会保留。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="text-sm text-muted-foreground">版本 {version} · 扩展 ID {chrome.runtime.id}</div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">扩展文件夹</span>
        <Badge variant={folderVariant}>{folderText}</Badge>
        {folder.name && <span className="text-muted-foreground">{folder.name}</span>}
        {folder.state === 'prompt' && <span className="text-muted-foreground">浏览器重启后需要再确认一次，更新时会自动询问</span>}
      </div>

      {!supportsFolderAccess() && <p className="text-sm text-destructive">当前浏览器不支持扩展内更新，请到 <a className="underline" href={RELEASE_PAGE} target="_blank" rel="noreferrer">GitHub 发布页</a> 手动下载。</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={installing || !supportsFolderAccess()} onClick={choose}>{folder.state === 'none' ? '选择文件夹' : '重新选择文件夹'}</Button>
        <Button variant="outline" disabled={installing || checking} onClick={check}>{checking ? '正在检查…' : '检查更新'}</Button>
        {release?.hasUpdate && <Button disabled={!canInstall} onClick={install}>立即更新到 {release.version}</Button>}
      </div>
      {release?.hasUpdate && folder.state === 'none' && <p className="text-sm text-muted-foreground">更新前需要先选择扩展文件夹。</p>}

      {release?.hasUpdate && <div className="space-y-2 rounded-md border p-3 text-sm">
        <div className="font-medium">{release.name}{release.publishedAt && <span className="ml-2 font-normal text-muted-foreground">{new Date(release.publishedAt).toLocaleDateString()}</span>}</div>
        {release.notes && <p className="max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{release.notes}</p>}
        <a className="text-muted-foreground underline" href={release.pageUrl} target="_blank" rel="noreferrer">在 GitHub 查看</a>
      </div>}

      {installing && <div role="status" aria-live="polite" className="space-y-2 text-sm">
        <div>{progressText(progress)}</div>
        {progress.phase === 'download' && progress.total > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.min(100, (progress.received / progress.total) * 100)}%` }} /></div>}
      </div>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
