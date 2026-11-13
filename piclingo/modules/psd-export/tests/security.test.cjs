'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FileAccess, request, inspect, settings } = require('../security.cjs');
test('日志操作与未授权路径均拒绝，真实选择路径可处理', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'psd-security-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, '中文 空格.psd'); fs.writeFileSync(file, 'test');
  const access = new FileAccess();
  assert.throws(() => request({ operation: 'logs', destination: file }, access), /未授权/);
  assert.throws(() => request({ operation: 'inspect', files: [file] }, access), /未经选择/);
  const real = access.authorize(file, 'psd');
  assert.equal(request({ operation: 'inspect', files: [real] }, access).files[0], real);
  assert.throws(() => request({ operation: 'inspect', files: [real], destination: file }, access), /未知请求/);
});
test('请求过量及危险配置拒绝', () => {
  assert.throws(() => inspect({ value: 'x'.repeat(3 * 1024 ** 2) }), /8MB/);
  assert.throws(() => inspect(JSON.parse('{"__proto__":{}}')), /字段/);
  assert.throws(() => settings({ photoshop: { windows_progid: 'WScript.Shell' } }), /COM/);
  assert.throws(() => settings({ photoshop: { mac_application: '/tmp/a.app' } }), /路径/);
  settings({ photoshop: { windows_progid: 'Photoshop.Application', mac_application: '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app' } });
});

