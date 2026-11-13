'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Updates, configuration, newer, INTERVAL } = require('../packaging/updates.cjs');
function fixture(t, signed = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piclingo-update-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const payload = Buffer.from('isolated-test-update');
  const file = path.join(directory, 'update.exe'); fs.writeFileSync(file, payload);
  const info = { version: '1.3.1', releaseNotes: '<b>纯文本</b>', files: [{ url: 'update.exe', sha512: crypto.createHash('sha512').update(payload).digest('base64') }] };
  const engine = new EventEmitter(); let installed = 0;
  engine.checkForUpdates = async () => { engine.emit('update-available', info); return { updateInfo: info }; };
  engine.downloadUpdate = async () => { engine.emit('download-progress', { percent: 50 }); engine.emit('update-downloaded', info); };
  engine.verifySignature = async () => null;
  engine.quitAndInstall = (silent, relaunch) => { assert.equal(silent, true); assert.equal(relaunch, true); installed++; };
  engine.downloadedUpdateHelper = { file };
  const updates = new Updates({ directory, version: '1.3.0', policy: { signed, publisherName: 'Test Publisher' }, factory: () => engine });
  updates.configure('owner/repo', true);
  return { updates, engine, file, directory, installed: () => installed };
}
test('配置、版本及 HTTPS 校验', () => {
  assert(newer('v1.3.1', '1.3.0'));
  assert(!newer('1.2.0', '1.3.0'));
  for (const url of ['http://host/','file:///x','https://a:b@host/','https://host/#x']) assert.throws(() => configuration({ provider: 'generic', url, automatic: true }));
  assert.equal(configuration({ provider: 'generic', url: 'https://host/updates', automatic: true }).url, 'https://host/updates/');
  assert.throws(() => configuration('owner/repo', 'true'));
});
test('延迟 30 秒及每 4 小时检查，退出清理', t => {
  const { updates } = fixture(t); const calls = [];
  updates.clock = { setTimeout: (fn, ms) => { calls.push(ms); return 1; }, setInterval: (fn, ms) => { calls.push(ms); return 2; }, clearTimeout: id => calls.push(-id), clearInterval: id => calls.push(-id) };
  updates.start(); updates.stop(); assert.deepEqual(calls, [30000, INTERVAL, -1, -2]);
});
test('后台进度、更新日志、延期和忙碌保护', async t => {
  const { updates, installed } = fixture(t);
  assert.equal((await updates.check()).phase, 'downloaded');
  assert.equal(updates.state.notes, '<b>纯文本</b>');
  updates.defer(); assert.equal(updates.deferredVersion(), '1.3.1');
  await updates.check(); assert.equal(installed(), 0);
  updates.busy = () => true; await assert.rejects(() => updates.install(), /等待/); assert.equal(installed(), 0);
  updates.busy = () => false; await updates.install(); assert.equal(installed(), 1);
});
test('摘要或签名损坏拒绝安装', async t => {
  const { updates, engine, file, installed } = fixture(t);
  await updates.check(); fs.appendFileSync(file, 'modified');
  await assert.rejects(() => updates.install(), /SHA512/); assert.equal(installed(), 0);
  await updates.check();
  updates.downloadInfo.files[0].sha512 = crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
  engine.verifySignature = async () => '发布者不符';
  await assert.rejects(() => updates.install(), /发布者/); assert.equal(installed(), 0);
});
test('未签名构建保留工作能力并拒绝自动安装', async t => {
  const { updates, installed, directory } = fixture(t, false);
  assert.equal((await updates.check()).phase, 'error');
  assert(fs.readFileSync(path.join(directory, 'update.log'), 'utf8').includes('签名'));
  assert.equal(installed(), 0);
});
test('下载中断被捕获，下一轮可恢复', async t => {
  const { updates, engine } = fixture(t);
  engine.downloadUpdate = async () => { throw new Error('断网'); };
  assert.equal((await updates.check()).phase, 'error'); assert.equal(updates.downloading, false);
  engine.downloadUpdate = async () => engine.emit('update-downloaded', { version: '1.3.1' });
  assert.equal((await updates.check()).phase, 'downloaded');
});
test('延期选择在新会话加载，当前会话检查不会自动安装', async t => {
  const { updates, engine, directory, installed } = fixture(t);
  await updates.check(); updates.defer(); await updates.check(); assert.equal(installed(), 0);
  const next = new Updates({ directory, version: '1.3.0', policy: { signed: true, publisherName: 'Test Publisher' }, factory: () => engine });
  await next.check(); assert.equal(installed(), 1); assert.equal(next.deferredVersion(), null);
});
test('切换提供方复用更新器并关闭旧 Mac 本地服务', async t => {
  const { updates, engine } = fixture(t);
  let closed = 0, selected;
  engine.setFeedURL = value => { selected = value; };
  engine.closeServerIfExists = () => closed++;
  await updates.check();
  updates.configure({ provider: 'generic', url: 'https://updates.example.com/stable/', automatic: true });
  assert.equal(updates.engine(), engine); assert.equal(closed, 1); assert.equal(selected.provider, 'generic');
  updates.configure({ provider: 'generic', url: '', automatic: true });
  assert.equal(closed, 2); assert.equal((await updates.check()).configured, false);
});

