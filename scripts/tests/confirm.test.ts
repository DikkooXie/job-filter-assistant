// 确认弹层与贴底反馈

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { createConfirmQueue, splitConfirmCopy, type ConfirmItem } from '../../src/pages/sidepanel/confirmQueue.js';
import { test, testAsync, section, ROOT } from './harness.js';

section('确认弹层与贴底反馈');
await testAsync('确认队列取消不成功，确认才 resolve true，下一条排队', async () => {
  const queue = createConfirmQueue();
  let shown: ConfirmItem | null = null;
  queue.attach((next) => { shown = next; });
  const visible = (): ConfirmItem => {
    assert.ok(shown, '确认弹层应已显示');
    return shown;
  };
  const first = queue.ask('确定删除岗位「前端」？此操作无法撤销。', { destructive: true });
  const second = queue.ask('确认你已向 甲公司 发送消息？此操作只记录状态。');
  assert.equal(visible().message, '确定删除岗位「前端」？此操作无法撤销。');
  assert.equal(visible().destructive, true);
  queue.settle(false);
  assert.equal(await first, false);
  assert.equal(visible().destructive, false);
  queue.settle(true);
  assert.equal(await second, true);
  queue.settle(true);
  assert.equal(queue.current(), null);
  const opened = splitConfirmCopy('确认打开 甲公司 的岗位并尝试进入沟通？\n内容将复制，请核对会话后手动发送。\n\n您好');
  assert.equal(opened.title, '确认打开 甲公司 的岗位并尝试进入沟通？');
  assert.match(opened.body, /^内容将复制，请核对会话后手动发送。\n\n您好$/);
  assert.equal(splitConfirmCopy('确定删除已选的 2 个岗位？此操作无法撤销。').body, '');
});
test('业务代码不再调用 alert/confirm/prompt，招呼语标题无旁注，反馈走 Sonner', () => {
  const root = ROOT;
  const srcDir = path.join(root, 'src');
  const nativeCall = /(?<![A-Za-z0-9_$])(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/g;
  const callsIn = (text: string) => text.match(new RegExp(nativeCall.source, 'g')) || [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(srcDir);
  // 源码扩展名迁移过一次（.js → .ts）。扫不到文件时这条检查会静默通过，先拦住。
  assert.ok(files.length > 20, `只扫到 ${files.length} 个源码文件，检查扩展名过滤是否过时`);
  const offenders: string[] = [];
  for (const file of files) {
    const hits = callsIn(fs.readFileSync(file, 'utf8'));
    if (hits.length) offenders.push(`${path.relative(root, file)}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
  const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.doesNotMatch(vite, /src\/ui\/sidepanel\.js/);
  const sidepanel = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'SidepanelApp.tsx'), 'utf8');
  const comm = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'CommTab.tsx'), 'utf8');
  const browse = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'browse.css'), 'utf8');
  const common = fs.readFileSync(path.join(srcDir, 'extension', 'messages.ts'), 'utf8');
  assert.match(sidepanel, /askConfirm\(/);
  assert.match(sidepanel, /from '@\/components\/ui\/sonner'/);
  assert.match(sidepanel, /<Toaster \/>/);
  assert.doesNotMatch(sidepanel, /NoticeToast|\.jp-toast/);
  const markStart = sidepanel.indexOf('onMarkSent');
  const markEnd = sidepanel.indexOf('onOpenOriginal', markStart);
  const markBody = sidepanel.slice(markStart, markEnd);
  const confirmAt = markBody.indexOf('askConfirm');
  const progressAt = markBody.indexOf("setProgress(job.uid, 'sent')");
  assert.ok(confirmAt >= 0 && progressAt > confirmAt);
  assert.match(markBody.slice(confirmAt, progressAt), /if \(!accepted\) return/);
  assert.doesNotMatch(markBody, /OPEN_JOB_CHAT|SEND_GREETING|clipboard/);
  assert.doesNotMatch(comm, /单一稿|无分档|<em>/);
  const greet = comm.slice(comm.indexOf('function GreetWork'), comm.indexOf('export function CommTab'));
  const toolsAt = greet.indexOf('className={commTools}');
  const sentAt = greet.indexOf('className={commSent}');
  assert.ok(toolsAt >= 0 && sentAt > toolsAt);
  assert.match(greet, />我已发出招呼</);
  assert.doesNotMatch(greet, /等 HR|完成招呼后解锁|comm-wait/);
  assert.doesNotMatch(browse, /\.comm-wait/);
  const sentClass = comm.slice(comm.indexOf('const commSent ='), comm.indexOf(';', comm.indexOf('const commSent =')));
  assert.match(sentClass, /\bw-full\b/);
  assert.match(sentClass, /!border-jp-line\b/);
  assert.match(sentClass, /!bg-transparent\b/);
  assert.match(sentClass, /!text-jp-summary\b/);
  assert.match(sentClass, /hover:!border-jp-line-strong/);
  assert.match(sentClass, /hover:!text-jp-ink/);
  assert.doesNotMatch(sentClass, /jp-accent/);
  const alertUi = fs.readFileSync(path.join(srcDir, 'components', 'ui', 'alert-dialog.tsx'), 'utf8');
  assert.doesNotMatch(alertUi, /bg-background/);
  assert.doesNotMatch(alertUi, /bg-black\/50/);
  // 确认层的样式写在 ConfirmDialog.tsx 的 Tailwind 类常量里。
  const dialog = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'ConfirmDialog.tsx'), 'utf8');
  const classConst = (name: string) => dialog.slice(dialog.indexOf(`const ${name} =`), dialog.indexOf(';', dialog.indexOf(`const ${name} =`)));
  assert.doesNotMatch(browse, /alert-dialog/);
  assert.match(dialog, /overlayClassName=\{overlayClass\}/);
  const overlayAlpha = Number((classConst('overlayClass').match(/\bbg-black\/(\d+)\b/) || [])[1]) / 100;
  assert.ok(overlayAlpha >= 0.55, `遮罩不透明度 ${overlayAlpha} 低于 0.55`);
  const contentClass = classConst('contentClass');
  assert.match(contentClass, /\bbg-jp-surface\b/);
  assert.match(contentClass, /\bborder border-jp-line\b/);
  assert.doesNotMatch(contentClass, /bg-background|\bbg-[\w-]+\/\d+|rgba\(/);
  const cancelButton = classConst('cancelButton');
  assert.match(cancelButton, /!bg-transparent/);
  assert.match(cancelButton, /!border-jp-line\b/);
  assert.match(cancelButton, /!text-jp-summary/);
  assert.match(classConst('buttonBase'), /!border\b/);
  assert.match(classConst('primaryButton'), /!bg-jp-accent\b/);
  assert.match(classConst('dangerButton'), /!bg-jp-confirm-del\b/);
  assert.doesNotMatch(dialog, /\bjp-btn/);
  const views = fs.readFileSync(path.join(srcDir, 'pages', 'sidepanel', 'views.tsx'), 'utf8');
  assert.match(views, /function useDeleteConfirm/);
  assert.match(views, /function DetailActionBar/);
  assert.doesNotMatch(views, /askConfirm\(/);
  assert.doesNotMatch(browse, /\.jp-toast\b/);
  assert.doesNotMatch(browse, /background:\s*var\(--jp-float-bg\)/);
  assert.match(browse, /data-sonner-toaster/);
  assert.match(browse, /--jp-surface-2/);
  assert.match(browse, /data-type='error'/);
  assert.equal(callsIn(common).length, 0);
});
