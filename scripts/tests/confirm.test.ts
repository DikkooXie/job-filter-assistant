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
  const toolsAt = greet.indexOf('className="comm-tools"');
  const sentAt = greet.indexOf('className="comm-sent"');
  assert.ok(toolsAt >= 0 && sentAt > toolsAt);
  assert.match(greet, />我已发出招呼</);
  assert.doesNotMatch(greet, /等 HR|完成招呼后解锁|comm-wait/);
  assert.doesNotMatch(browse, /\.comm-wait/);
  const sentRule = browse.slice(browse.indexOf('.job-panel .comm-sent {'), browse.indexOf('.job-panel .comm-sent:hover'));
  assert.match(sentRule, /width:\s*100%/);
  assert.match(sentRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.match(sentRule, /background:\s*transparent/);
  assert.match(sentRule, /color:\s*var\(--jp-summary\)/);
  assert.doesNotMatch(sentRule, /var\(--jp-accent\)/);
  const sentHover = browse.slice(browse.indexOf('.job-panel .comm-sent:hover'), browse.indexOf('.suggest'));
  assert.match(sentHover, /border-color:\s*var\(--jp-line-strong\)/);
  assert.match(sentHover, /background:\s*transparent/);
  assert.doesNotMatch(sentHover, /var\(--jp-accent\)/);
  const alertUi = fs.readFileSync(path.join(srcDir, 'components', 'ui', 'alert-dialog.tsx'), 'utf8');
  assert.doesNotMatch(alertUi, /bg-background/);
  assert.doesNotMatch(alertUi, /bg-black\/50/);
  const overlayRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-overlay']"), browse.indexOf("[data-slot='alert-dialog-content']"));
  const overlayAlpha = Number((overlayRule.match(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/) || [])[1]);
  assert.ok(overlayAlpha >= 0.55);
  const contentRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-content']"), browse.indexOf("[data-slot='alert-dialog-header']"));
  assert.match(contentRule, /background-color:\s*var\(--jp-surface\)/);
  assert.match(contentRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.doesNotMatch(contentRule, /bg-background|rgba\(/);
  const footerRule = browse.slice(browse.indexOf("[data-slot='alert-dialog-footer'] .jp-btn {"));
  assert.match(footerRule, /background:\s*transparent/);
  assert.match(footerRule, /border:\s*1px solid var\(--jp-line\)/);
  assert.match(footerRule, /color:\s*var\(--jp-summary\)/);
  assert.match(footerRule, /\.jp-btn-primary \{[^}]*background:\s*var\(--jp-accent\)/);
  assert.match(footerRule, /\.jp-btn-danger \{[^}]*background:\s*var\(--jp-confirm-del\)/);
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
