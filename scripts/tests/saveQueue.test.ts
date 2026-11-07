// 设置页保存队列

import assert from 'node:assert';

import { testAsync, section } from './harness.js';
import type { LifecycleTarget, ReportFn, SavePhase, SaveQueueEnv } from '../../src/pages/options/saveQueue.js';

type ClockItem = { id: number; at: number; fn: () => void };
type LifecycleListeners = Record<string, (() => void)[]>;

section('设置页保存队列');
const { createSaveQueue } = await import('../../src/pages/options/saveQueue.js');

function createClock() {
  let now = 0;
  let nextId = 1;
  const items: ClockItem[] = [];
  return {
    schedule(fn: () => void, ms: number) {
      const id = nextId++;
      items.push({ id, at: now + ms, fn });
      return id;
    },
    cancel(id: number) {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = items.filter((item) => item.at <= target).sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) break;
        const item = due[0]!;
        items.splice(items.findIndex((entry) => entry.id === item.id), 1);
        now = item.at;
        item.fn();
        await settle();
      }
      now = target;
    },
  };
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function createQueueHarness(report?: ReportFn, extra: SaveQueueEnv = {}) {
  const clock = createClock();
  const listeners: LifecycleListeners = {};
  const bind = <T extends object>(target: T): T & LifecycleTarget => Object.assign(target, {
    addEventListener(type: string, fn: () => void) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type: string, fn: () => void) {
      listeners[type] = (listeners[type] || []).filter((item) => item !== fn);
    },
  });
  const target = bind({});
  const documentTarget = bind({ visibilityState: 'visible' });
  const queue = createSaveQueue(report, {
    // The fake clock uses numeric IDs; SaveQueueEnv uses the host's timer handle type.
    schedule: clock.schedule as unknown as SaveQueueEnv['schedule'],
    cancel: clock.cancel as unknown as SaveQueueEnv['cancel'],
    target,
    documentTarget,
    ...extra,
  });
  const fire = (type: string) => (listeners[type] || []).slice().forEach((fn) => fn());
  return { clock, queue, fire, documentTarget, listeners };
}

await testAsync('防抖窗口内只执行最后一次任务', async () => {
  const { clock, queue } = createQueueHarness();
  const snaps: number[] = [];
  queue.enqueue('settings', () => { snaps.push(1); }, 200);
  await clock.advance(150);
  queue.enqueue('settings', () => { snaps.push(2); }, 200);
  await clock.advance(199);
  assert.deepEqual(snaps, []);
  await clock.advance(1);
  assert.deepEqual(snaps, [2]);
});

await testAsync('设置、画像、供应商按各自间隔独立防抖', async () => {
  const { clock, queue } = createQueueHarness();
  const order: string[] = [];
  queue.enqueue('settings', () => { order.push('settings'); }, 200);
  queue.enqueue('providers', () => { order.push('providers'); }, 500);
  queue.enqueue('profile', () => { order.push('profile'); }, 600);
  await clock.advance(200);
  assert.deepEqual(order, ['settings']);
  await clock.advance(300);
  assert.deepEqual(order, ['settings', 'providers']);
  await clock.advance(100);
  assert.deepEqual(order, ['settings', 'providers', 'profile']);
});

await testAsync('保存失败后按原间隔重新排队，成功后不再重试', async () => {
  const notes: Parameters<ReportFn>[] = [];
  const { clock, queue } = createQueueHarness((message, isError) => notes.push([message, isError]));
  let calls = 0;
  queue.enqueue('profile', async () => {
    calls += 1;
    if (calls === 1) throw new Error('保存失败');
  }, 600);
  await clock.advance(599);
  assert.equal(calls, 0);
  await clock.advance(1);
  assert.equal(calls, 1);
  assert.deepEqual(notes, [['保存失败', true]]);
  await clock.advance(599);
  assert.equal(calls, 1);
  await clock.advance(1);
  assert.equal(calls, 2);
  assert.deepEqual(notes, [['保存失败', true], [null, false]]);
  await clock.advance(5000);
  assert.equal(calls, 2);
});

await testAsync('失败时若已有更新的编辑，不把旧任务重新排队', async () => {
  const { clock, queue } = createQueueHarness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ran: string[] = [];
  queue.enqueue('profile', () => gate.then(() => {
    ran.push('old');
    throw new Error('旧保存失败');
  }), 100);
  await clock.advance(100);
  queue.enqueue('profile', async () => { ran.push('new'); }, 100);
  release();
  await settle();
  await clock.advance(100);
  assert.deepEqual(ran, ['old', 'new']);
  await clock.advance(5000);
  assert.deepEqual(ran, ['old', 'new']);
});

await testAsync('flush 立即执行并等待结果，失败会拒绝当前这次', async () => {
  const { clock, queue } = createQueueHarness();
  let calls = 0;
  queue.enqueue('settings', async () => {
    calls += 1;
    if (calls === 1) throw new Error('写盘失败');
  }, 5000);
  await assert.rejects(queue.flush('settings'), /写盘失败/);
  assert.equal(calls, 1);
  await clock.advance(4999);
  assert.equal(calls, 1);
  await clock.advance(1);
  assert.equal(calls, 2);
});

await testAsync('flush 等正在进行的保存结束后再执行新任务', async () => {
  const { clock, queue } = createQueueHarness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  queue.enqueue('providers', () => { order.push('a'); return gate; }, 10);
  await clock.advance(10);
  queue.enqueue('providers', () => { order.push('b'); }, 5000);
  let flushed = false;
  const done = queue.flush('providers').then(() => { flushed = true; });
  await settle();
  assert.equal(flushed, false);
  assert.deepEqual(order, ['a']);
  release();
  await done;
  assert.equal(flushed, true);
  assert.deepEqual(order, ['a', 'b']);
});

await testAsync('pagehide 与 beforeunload 立刻发出未保存内容，且不重复发送', async () => {
  const { queue, fire } = createQueueHarness();
  let calls = 0;
  queue.enqueue('settings', () => { calls += 1; }, 5000);
  assert.equal(calls, 0);
  fire('pagehide');
  assert.equal(calls, 1);
  fire('beforeunload');
  assert.equal(calls, 1);
});

await testAsync('页面隐藏时立刻保存，重新可见不会再发一次', async () => {
  const { queue, fire, documentTarget } = createQueueHarness();
  let calls = 0;
  queue.enqueue('providers', () => { calls += 1; }, 5000);
  documentTarget.visibilityState = 'hidden';
  fire('visibilitychange');
  assert.equal(calls, 1);
  documentTarget.visibilityState = 'visible';
  fire('visibilitychange');
  assert.equal(calls, 1);
});

await testAsync('关闭页面时不等待上一次保存，立刻发出更新的任务', async () => {
  const { clock, queue, fire } = createQueueHarness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  queue.enqueue('profile', () => { order.push('a'); return gate; }, 10);
  await clock.advance(10);
  queue.enqueue('profile', () => { order.push('b'); }, 5000);
  fire('beforeunload');
  assert.deepEqual(order, ['a', 'b']);
  release();
  await settle();
});

await testAsync('组件卸载时写出未完成保存，之后不再接收新任务', async () => {
  const { clock, queue, listeners } = createQueueHarness();
  let calls = 0;
  queue.enqueue('profile', () => { calls += 1; }, 5000);
  queue.dispose();
  assert.equal(calls, 1);
  assert.equal(listeners.pagehide!.length, 0);
  queue.enqueue('profile', () => { calls += 1; }, 10);
  await clock.advance(10);
  assert.equal(calls, 1);
  queue.dispose();
});

await testAsync('编辑后为保存中，成功后为已保存并记下时间', async () => {
  const savedAt = 1_700_000_123_000;
  const seen: SavePhase[] = [];
  const { clock, queue } = createQueueHarness(undefined, { now: () => savedAt });
  queue.subscribe((snap) => seen.push(snap.phase));
  queue.enqueue('settings', () => {}, 200);
  assert.equal(queue.snapshot().phase, 'saving');
  assert.equal(seen.at(-1), 'saving');
  await clock.advance(199);
  assert.equal(queue.snapshot().phase, 'saving');
  await clock.advance(1);
  assert.equal(queue.snapshot().phase, 'saved');
  assert.equal(queue.snapshot().savedAt, savedAt);
  assert.equal(queue.snapshot().error, null);
});

await testAsync('保存失败时保持可重试，手动重试成功后变为已保存', async () => {
  const { clock, queue } = createQueueHarness(undefined, { now: () => 42 });
  let calls = 0;
  queue.enqueue('profile', async () => {
    calls += 1;
    if (calls === 1) throw new Error('保存失败');
  }, 200);
  await clock.advance(200);
  assert.equal(calls, 1);
  assert.equal(queue.snapshot().phase, 'error');
  assert.match(queue.snapshot().error!, /保存失败/);
  await clock.advance(199);
  assert.equal(calls, 1);
  assert.equal(queue.snapshot().phase, 'error');
  await queue.retry();
  assert.equal(calls, 2);
  assert.equal(queue.snapshot().phase, 'saved');
  assert.equal(queue.snapshot().savedAt, 42);
});

await testAsync('更新的编辑进行中时，不把状态停在上一次失败', async () => {
  const { clock, queue } = createQueueHarness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  queue.enqueue('settings', () => gate.then(() => { throw new Error('旧保存失败'); }), 10);
  await clock.advance(10);
  queue.enqueue('settings', async () => {}, 100);
  assert.equal(queue.snapshot().phase, 'saving');
  release();
  await settle();
  assert.equal(queue.snapshot().phase, 'saving');
  await clock.advance(100);
  assert.equal(queue.snapshot().phase, 'saved');
});
