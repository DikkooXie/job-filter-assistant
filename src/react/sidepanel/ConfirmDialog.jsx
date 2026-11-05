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
import { confirmQueue, splitConfirmCopy } from './confirmQueue.js';

/** 侧栏内的确认层。Escape 和「取消」都是 false，不写任何状态。 */
export function ConfirmDialogHost() {
  const anchorRef = useRef(null);
  const [container, setContainer] = useState(null);
  const [req, setReq] = useState(null);
  useEffect(() => setContainer(anchorRef.current?.closest('.job-panel') || null), []);
  useEffect(() => confirmQueue.attach(setReq), []);
  const finish = (value) => {
    if (!req || req.settled) return;
    confirmQueue.settle(value);
  };
  const copy = splitConfirmCopy(req?.message || '');
  return (
    <>
      <span ref={anchorRef} hidden />
      <AlertDialog open={!!req && !!container} onOpenChange={(open) => { if (!open) finish(false); }}>
        <AlertDialogContent container={container} className="jp-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            {copy.body ? <AlertDialogDescription>{copy.body}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogPrimitive.Cancel asChild>
              <button type="button" className="jp-btn">取消</button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <button
                type="button"
                className={req?.destructive ? 'jp-btn jp-btn-danger' : 'jp-btn jp-btn-primary'}
                onClick={() => finish(true)}
              >
                确认
              </button>
            </AlertDialogPrimitive.Action>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
