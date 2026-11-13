'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const verify = require('../packaging/verify-signature.cjs');
test('Windows 签名检查使用字面路径，特殊字符不会成为命令', { skip: process.platform !== 'win32' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piclingo-signature-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "中文 空格 & quote ' $(literal).exe");
  fs.writeFileSync(file, 'non-executable audit fixture');
  const failure = await verify(['expected publisher'], file);
  assert.match(failure, /Invalid Authenticode status/);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(file)]);
});

