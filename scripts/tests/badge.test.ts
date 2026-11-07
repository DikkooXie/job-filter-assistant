// 页面收录角标

import assert from 'node:assert';
import vm from 'node:vm';

import { testAsync, section, runtimeScript } from './harness.js';

section('页面收录角标');
type MessageListener = (event: { source: unknown; data: unknown }) => void;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
interface FakeEl {
  className: string;
  removed: boolean;
}

function runCollector(stored: object | undefined) {
  const appended: FakeEl[] = [];
  const listeners: { message: MessageListener[]; storage: StorageListener[] } = { message: [], storage: [] };
  const makeEl = () => {
    const el = {
      className: '', innerHTML: '', removed: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      querySelector: () => ({ textContent: '' }),
      remove() { el.removed = true; },
    };
    return el;
  };
  const fakeWindow = {
    addEventListener: (type: string, fn: MessageListener) => type === 'message' && listeners.message.push(fn),
    postMessage() {},
  };
  const ctx = {
    window: fakeWindow,
    location: { href: 'https://example.com/', hostname: 'example.com', origin: 'https://example.com' },
    URL,
    document: {
      createElement: makeEl,
      body: { appendChild: (el: FakeEl) => { appended.push(el); return el; } },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    MutationObserver: class { observe() {} },
    Date,
    setTimeout: () => 0, // 不触发兜底抓取与淡出计时
    clearTimeout: () => {},
    chrome: {
      runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } },
      storage: {
        local: { get: async () => (stored === undefined ? {} : { jobHelperSettingsV1: stored }) },
        onChanged: { addListener: (fn: StorageListener) => listeners.storage.push(fn) },
      },
    },
  };
  vm.runInNewContext(runtimeScript('src/content/collector.ts'), ctx);
  const capture = async () => {
    for (const fn of listeners.message) {
      fn({ source: fakeWindow, data: { source: 'job-helper:sniffer', platform: 'boss', url: 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json', payload: { zpData: { jobList: [] } } } });
    }
    await new Promise((r) => setImmediate(r));
  };
  const badges = () => appended.filter((el) => el.className === 'jobhelper-capture-badge' && !el.removed);
  const changeSettings = (newValue: object) => listeners.storage.forEach((fn) => fn({ jobHelperSettingsV1: { newValue } }, 'local'));
  return { capture, badges, changeSettings };
}
await testAsync('未保存过设置时，收录后显示角标', async () => {
  const c = runCollector(undefined);
  await c.capture();
  assert.equal(c.badges().length, 1);
});
await testAsync('showBadge 为 false 时不创建角标', async () => {
  const c = runCollector({ showBadge: false });
  await c.capture();
  await c.capture();
  assert.equal(c.badges().length, 0);
});
await testAsync('在设置页关闭后，已显示的角标立即移除；重新打开后再次显示', async () => {
  const c = runCollector({ showBadge: true });
  await c.capture();
  assert.equal(c.badges().length, 1);
  c.changeSettings({ showBadge: false });
  assert.equal(c.badges().length, 0);
  await c.capture();
  assert.equal(c.badges().length, 0);
  c.changeSettings({ showBadge: true });
  await c.capture();
  assert.equal(c.badges().length, 1);
});

// ---------- 设置页保存队列 ----------
