import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { isDevBuild, toDevManifest } from './src/common/build.js';

const projectDir = fileURLToPath(new URL('.', import.meta.url));
const pagesDir = resolve(projectDir, 'extension-pages');
const outDir = resolve(projectDir, 'dist');

// 本地构建默认标 dev；发版脚本以 JFA_RELEASE=1 构建，保留正式名称。
async function markDevBuild(buildDir) {
  if (process.env.JFA_RELEASE === '1') return;
  const path = resolve(buildDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (isDevBuild(manifest)) return;
  await writeFile(path, `${JSON.stringify(toDevManifest(manifest), null, 2)}\n`);
  console.log(`已标记为开发构建：${toDevManifest(manifest).name}`);
}

function copyExtensionFiles() {
  let buildDir = outDir;
  return {
    name: 'copy-extension-files',
    configResolved(config) {
      buildDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      for (const path of ['manifest.json', 'icons', 'src/background', 'src/content', 'src/common', 'src/vendor']) {
        const destination = resolve(buildDir, path);
        await mkdir(resolve(destination, '..'), { recursive: true });
        await cp(resolve(projectDir, path), destination, { recursive: true });
      }
      await markDevBuild(buildDir);
    },
  };
}

export default defineConfig({
  root: pagesDir,
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss(), copyExtensionFiles()],
  resolve: { alias: { '@': resolve(projectDir, 'src') } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        ['popup', 'sidepanel', 'options'].map((page) => [page, resolve(pagesDir, `${page}.html`)]),
      ),
      // 固定文件名（不带内容哈希）：扩展从本地磁盘加载，不需要缓存失效；
      // 固定名字让更新时直接覆盖旧文件，避免每次发版都在扩展文件夹里留下新文件。
      output: {
        entryFileNames: 'assets/[name].js',
        // 共享模块会被抽成一个 chunk。代表模块一变，Rollup 就会把原来的 badge.js
        // 改名成别的文件，更新时旧文件不会被清掉。只要这个 chunk 里还有 badge 组件，就沿用原名。
        chunkFileNames(chunkInfo) {
          const sharedBadge = (chunkInfo.moduleIds || []).some((id) => id.includes('/components/ui/badge'));
          return `assets/${sharedBadge ? 'badge' : chunkInfo.name}.js`;
        },
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
