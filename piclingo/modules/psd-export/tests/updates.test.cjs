'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Updates, newer } = require('../packaging/updates.cjs');

test('版本比较及仓库校验', () => {
  assert.equal(newer('v1.3.0', '1.2.0'), true);
  assert.equal(newer('1.2.0', '1.2.0'), false);
  assert.equal(newer('v1.1.9', '1.2.0'), false);
  assert.equal(newer('not-a-version', '1.2.0'), false);
  const directory = fs.mkdtempSync(path.join(__dirname, 'update-test-'));
  try {
    const updates = new Updates({ directory, version: '1.2.0' });
    assert.throws(() => updates.configure('https://evil.example/test', true));
    assert.equal(updates.configure('owner/repo', true).repository, 'owner/repo');
    assert.equal(updates.settings().automatic, true);
  } finally {
    assert.equal(path.dirname(directory), __dirname);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('下载校验成功及损坏文件拒绝', async () => {
  const directory = fs.mkdtempSync(path.join(__dirname, 'update-test-'));
  const originalFetch = global.fetch;
  const bytes = Buffer.from('known-test-payload');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const response = content => {
    const result = new Response(content);
    Object.defineProperty(result, 'url', { value: 'https://objects.githubusercontent.com/test' });
    return result;
  };
  try {
    const updates = new Updates({ directory, version: '1.2.0' });
    updates.release = { filename: 'test.exe', checksum: { browser_download_url: 'https://github.com/checksum' }, asset: { browser_download_url: 'https://github.com/payload' } };
    global.fetch = async url => response(url.endsWith('checksum') ? hash + '  test.exe' : bytes);
    const result = await updates.download();
    assert.deepEqual(fs.readFileSync(result), bytes);
    global.fetch = async url => response(url.endsWith('checksum') ? '0'.repeat(64) : bytes);
    await assert.rejects(() => updates.download(), /SHA256/);
    assert.equal(fs.readdirSync(directory).some(name => name.includes('.partial-')), false);
  } finally {
    global.fetch = originalFetch;
    assert.equal(path.dirname(directory), __dirname);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
