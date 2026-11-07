// 测试套件共用的最小运行器：计数、分组标题、样本读取和内容脚本转译。
// 不引入测试框架：用例就是普通函数，失败只打印原因并计数，由 scripts/test.ts 汇总退出码。
import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import type { Job } from '../../src/common/types.js';

// 仓库根目录。用例里读源码、manifest、样本都相对它解析，与 cwd 无关。
export const ROOT = path.resolve(import.meta.dirname, '..', '..');

const counts = { pass: 0, fail: 0 };

export function results(): { pass: number; fail: number } {
  return { ...counts };
}

function report(name: string, error?: unknown) {
  if (error === undefined) {
    counts.pass++;
    console.log('  ✓', name);
    return;
  }
  counts.fail++;
  console.log('  ✗', name, '\n      →', error instanceof Error ? error.message : String(error));
}

export function test(name: string, fn: () => void): void {
  try {
    fn();
    report(name);
  } catch (e) {
    report(name, e ?? new Error('抛出了空值'));
  }
}

export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    report(name);
  } catch (e) {
    report(name, e ?? new Error('抛出了空值'));
  }
}

export function section(title: string): void {
  console.log('\n' + title);
}

// 随包携带的合成样本（结构仿真机逆向，但无任何真实/个人数据）。
export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', name), 'utf8')) as T;
}

// 内容脚本是 TypeScript 写的 IIFE，不能 import。先转成 JS，再交给 vm 在桩环境里跑。
export function runtimeScript(rel: string): string {
  return transformSync(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { loader: 'ts' }).code;
}

// 只实现 chrome.storage.local 的 get / set，够存储层模块读写用。
// 返回值按完整的 chrome 类型给出，便于直接赋给 globalThis.chrome；其余 API 调用会在运行时报错。
export function memoryChrome(): typeof chrome {
  const data: Record<string, unknown> = {};
  const stub = {
    storage: {
      local: {
        get(key?: string | string[] | null): Promise<Record<string, unknown>> {
          if (typeof key === 'string') return Promise.resolve(key in data ? { [key]: data[key] } : {});
          return Promise.resolve({ ...data });
        },
        set(items: Record<string, unknown>): Promise<void> {
          Object.assign(data, items);
          return Promise.resolve();
        },
      },
    },
  };
  return stub as unknown as typeof chrome;
}

// 用例里的岗位常只写几个相关字段。Job 要求 uid / platform，这里显式标出「这是故意不完整的样本」。
export function partialJob<T extends Partial<Job>>(job: T): T & Job {
  return job as unknown as T & Job;
}

// 把局部实现的 chrome 桩挂到全局。桩只覆盖用到的 API，这里统一做一次类型收窄。
export function installChrome(stub: object): void {
  globalThis.chrome = stub as typeof chrome;
}
