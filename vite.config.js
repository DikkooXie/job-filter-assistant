import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const projectDir = fileURLToPath(new URL('.', import.meta.url));
const pagesDir = resolve(projectDir, 'extension-pages');
const outDir = resolve(projectDir, 'dist');

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
    },
  },
});
