import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { isDevBuild, toDevManifest } from './src/common/build.js';

const projectDir = fileURLToPath(new URL('.', import.meta.url));
const pagesDir = resolve(projectDir, 'extension-pages');
const outDir = resolve(projectDir, 'dist');

// 本地构建默认标 dev；发版脚本以 JFA_RELEASE=1 构建，保留正式名称。
async function markDevBuild(buildDir: string) {
  if (process.env.JFA_RELEASE === '1') return;
  const path = resolve(buildDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (isDevBuild(manifest)) return;
  await writeFile(path, `${JSON.stringify(toDevManifest(manifest), null, 2)}\n`);
  console.log(`已标记为开发构建：${toDevManifest(manifest).name}`);
}

// 这些目录不参与页面打包，但要保持 dist 里的原路径（manifest 指向它们）。
// 源文件可以是 .ts，构建时用 esbuild 逐文件转译成同名 .js；其余文件原样复制。
const COMPILED_DIRS = ['src/background', 'src/content', 'src/common'];
const COPIED_DIRS = ['icons', 'src/vendor'];

async function compileDir(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const source = resolve(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await compileDir(source, resolve(targetDir, entry.name));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const target = resolve(targetDir, entry.name.replace(/\.ts$/, '.js'));
      // 纯类型文件（如 types.ts）转译后是空模块，不必产出。
      const { code } = await transform(await readFile(source, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
      if (code.trim()) await writeFile(target, code);
      continue;
    }
    await cp(source, resolve(targetDir, entry.name));
  }
}

function copyExtensionFiles(): Plugin {
  let buildDir = outDir;
  return {
    name: 'copy-extension-files',
    configResolved(config) {
      buildDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const manifestTarget = resolve(buildDir, 'manifest.json');
      await mkdir(dirname(manifestTarget), { recursive: true });
      await cp(resolve(projectDir, 'manifest.json'), manifestTarget);
      for (const path of COPIED_DIRS) {
        await cp(resolve(projectDir, path), resolve(buildDir, path), { recursive: true });
      }
      for (const path of COMPILED_DIRS) {
        await compileDir(resolve(projectDir, path), resolve(buildDir, path));
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
          const ids = chunkInfo.moduleIds || [];
          if (ids.some((id) => id.includes('/components/ui/badge'))) return 'assets/badge.js';
          // 画像和开发标识在同一个共享 chunk。浮窗不再引用 build.js 时，Rollup 会把原 profile.js 改名为 build.js，更新后旧文件会留下。
          if (ids.some((id) => /\/common\/profile\.(js|ts)$/.test(id))) return 'assets/profile.js';
          return `assets/${chunkInfo.name}.js`;
        },
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
