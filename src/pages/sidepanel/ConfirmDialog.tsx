import React, { useEffect, useRef, useState } from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '../../lib/cn.js';
import { confirmQueue, splitConfirmCopy } from './confirmQueue.js';
import type { ConfirmItem } from './confirmQueue.js';

// 确认层挂在 .job-panel 内部，所以用 absolute 而不是 fixed，只盖住侧栏。
// 遮罩至少 rgba(0,0,0,0.55)，比 black/50 略深，避免透见底层控件。
const overlayClass = 'absolute inset-0 z-40 bg-black/60';
// 弹层必须是实色 surface，不能用 shadcn 默认的 bg-background 或半透明色。
const contentClass = cn(
  'absolute top-1/2 right-4 left-4 z-[41] m-0 w-auto max-w-none sm:max-w-none max-h-[calc(100%-32px)] overflow-auto',
  'translate-x-0 -translate-y-1/2 gap-3 rounded-xl border border-jp-line bg-jp-surface p-4 text-jp-ink shadow-(--jp-shadow)',
);
const titleClass = 'min-w-0 text-section leading-[1.4] font-[650] text-jp-ink whitespace-normal [overflow-wrap:anywhere]';
const descriptionClass = 'max-h-[38vh] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-control leading-normal text-jp-secondary';
// browse.css 的 .job-panel button 重置（border/background/padding/font/color）不在层里，按钮样式要用 ! 压过它。
const buttonBase = 'inline-flex min-h-8 min-w-[72px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md !border !border-solid !px-2.5 !py-[5px] !text-hint !font-[550]';
const cancelButton = cn(buttonBase, '!border-jp-line !bg-transparent !text-jp-summary hover:!border-jp-line-strong hover:!text-jp-ink');
const primaryButton = cn(
  buttonBase,
  '!border-jp-accent !bg-jp-accent !text-jp-on-accent',
  'hover:!border-[color-mix(in_srgb,var(--jp-accent)_88%,var(--jp-ink))] hover:!bg-[color-mix(in_srgb,var(--jp-accent)_88%,var(--jp-ink))]',
);
const dangerButton = cn(
  buttonBase,
  '!border-jp-confirm-del !bg-jp-confirm-del !text-white',
  'hover:!border-[color-mix(in_srgb,var(--jp-confirm-del)_86%,#000)] hover:!bg-[color-mix(in_srgb,var(--jp-confirm-del)_86%,#000)]',
);

/** 侧栏内的确认层。Escape 和「取消」都是 false，不写任何状态。 */
export function ConfirmDialogHost() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [container, setContainer] = useState<Element | null>(null);
  const [req, setReq] = useState<ConfirmItem | null>(null);
  useEffect(() => setContainer(anchorRef.current?.closest('.job-panel') || null), []);
  useEffect(() => confirmQueue.attach(setReq), []);
  const finish = (value: boolean) => {
    if (!req || req.settled) return;
    confirmQueue.settle(value);
  };
  const copy = splitConfirmCopy(req?.message || '');
  return (
    <>
      <span ref={anchorRef} hidden />
      <AlertDialog open={!!req && !!container} onOpenChange={(open: boolean) => { if (!open) finish(false); }}>
        <AlertDialogContent container={container} className={contentClass} overlayClassName={overlayClass}>
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className={titleClass}>{copy.title}</AlertDialogTitle>
            {copy.body ? <AlertDialogDescription className={descriptionClass}>{copy.body}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row items-center justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <button type="button" className={cancelButton}>取消</button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <button type="button" className={req?.destructive ? dangerButton : primaryButton} onClick={() => finish(true)}>
                确认
              </button>
            </AlertDialogPrimitive.Action>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
