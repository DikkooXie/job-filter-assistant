// 发版：构建 → 把 dist/ 的内容打成 zip（manifest.json 在 zip 根目录）→ 用 gh 创建 GitHub Release。
// 用法：
//   npm run release -- --dry-run            只构建并打包，不发布
//   npm run release -- --notes "更新说明"    发布正式版（版本号取 manifest.json 的 version，成为 /releases/latest）
//   npm run release -- --notes-file CHANGES.md
//   npm run release -- --prerelease --notes "预览说明"
// 预览包：发之前把 manifest version 改成四段，且必须大于已安装版本（正式 1.0.3 → 预览 1.0.3.1）。
// 不带 --prerelease 时行为与现网一致，会创建正式 Release。不要用它发预览，也不要为此把正式三段版本号抬高。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'DikkooXie/job-filter-assistant';
const projectDir = resolve(import.meta.dirname, '..');
const distDir = resolve(projectDir, 'dist');
const outDir = resolve(projectDir, 'release');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', cwd: projectDir, ...opts });

const manifest = JSON.parse(readFileSync(resolve(projectDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const tag = `v${version}`;
const prerelease = flag('--prerelease');
if (!manifest.key) throw new Error('manifest.json 缺少 key，发布后用户更新会丢失数据');
if (prerelease && !/^\d+(?:\.\d+){3}$/.test(version)) {
  throw new Error(`预览包请使用四段版本号，且必须大于已安装版本（例如正式版 1.0.3 发 1.0.3.1）。当前 manifest version 为 ${version}`);
}

const git = (...argv) => execFileSync('git', argv, { cwd: projectDir, encoding: 'utf8' }).trim();
if (!flag('--dry-run')) {
  if (git('status', '--porcelain')) throw new Error('工作区有未提交的改动，请先提交，保证发布内容与代码一致');
}

run('npm', ['test']);
// 发版包不能带本地开发标记
run('npm', ['run', 'build'], { env: { ...process.env, JFA_RELEASE: '1' } });
const built = JSON.parse(readFileSync(resolve(distDir, 'manifest.json'), 'utf8'));
if (built.version !== version || built.key !== manifest.key || built.name !== manifest.name) {
  throw new Error('dist/manifest.json 与源 manifest 不一致（名称可能被 dev 标记改动）');
}

mkdirSync(outDir, { recursive: true });
const zipPath = resolve(outDir, `job-filter-assistant-${version}.zip`);
rmSync(zipPath, { force: true });
// 在 dist 内打包，保证 manifest.json 位于 zip 根目录；排除系统垃圾文件
run('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store', '-x', '__MACOSX/*'], { cwd: distDir });
console.log(`\n已打包：${zipPath}`);

if (flag('--dry-run')) {
  console.log('（--dry-run：未发布）');
  process.exit(0);
}

const notes = option('--notes');
const notesFile = option('--notes-file');
if (!notes && !notesFile) throw new Error('请用 --notes "说明" 或 --notes-file <文件> 提供更新说明（会显示在扩展的更新面板里）');
if (notesFile && !existsSync(notesFile)) throw new Error(`找不到 ${notesFile}`);

const head = git('rev-parse', 'HEAD');
run('git', ['fetch', '--quiet', 'personal']);
if (!git('branch', '-r', '--contains', head).split('\n').some((b) => b.trim().startsWith('personal/'))) {
  throw new Error('当前提交还没有推送到 personal 远端，请先 git push personal');
}

run('gh', [
  'release', 'create', tag, zipPath,
  '--repo', REPO,
  '--target', head,
  '--title', tag,
  ...(prerelease ? ['--prerelease'] : []),
  ...(notesFile ? ['--notes-file', notesFile] : ['--notes', notes]),
]);
console.log(prerelease
  ? `\n已发布预览版 ${tag}。此发布不会改变 /releases/latest。在扩展里把更新通道切到「预览」后点「检查更新」。`
  : `\n已发布 ${tag}。已安装的用户在「设置 → 通用与隐私 → 关于与更新」里点「检查更新」即可升级。`);
