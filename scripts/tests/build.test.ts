// 构建标识

import assert from 'node:assert';

import { isDevBuild, toDevManifest } from '../../src/common/build.js';
import { test, section } from './harness.js';

section('开发构建标识');
test('开发构建添加标识且不修改原 manifest，重复转换不叠加', () => {
  const original = { name: '助手', short_name: '助手', action: { default_title: '打开助手' }, key: 'example' };
  const dev = toDevManifest(original);
  assert.equal(dev.name, '助手 · dev');
  assert.equal(dev.short_name, '助手 dev');
  assert.equal(dev.action.default_title, '打开助手 · dev');
  assert.equal(dev.key, original.key);
  assert.equal(original.name, '助手');
  assert.equal(isDevBuild(original), false);
  assert.equal(isDevBuild(dev), true);
  assert.deepEqual(toDevManifest(dev), dev);
});

// ---------- URL 匹配 ----------
