'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { message, verify, verifyFile } = require('../packaging/release-signature.cjs');
const { Updates } = require('../packaging/updates.cjs');

test('发布签名绑定版本、摘要、平台和架构', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const file = { sha512: crypto.createHash('sha512').update('payload').digest('base64') };
  file.piclingoSignature = crypto.sign(null, message('1.3.1', file, 'win32', 'x64'), privateKey).toString('base64');
  assert.doesNotThrow(() => verify(pem, '1.3.1', file, 'win32', 'x64'));
  assert.throws(() => verify(pem, '1.3.2', file, 'win32', 'x64'), /签名/);
  assert.throws(() => verify(pem, '1.3.1', file, 'darwin', 'x64'), /签名/);
  assert.throws(() => verify(pem, '1.3.1', file, 'win32', 'arm64'), /签名/);
  assert.throws(() => verify(pem, '1.3.1', { ...file, sha512: crypto.createHash('sha512').update('altered').digest('base64') }, 'win32', 'x64'), /签名/);
});
test('更新缓存被修改时拒绝安装', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piclingo-signed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const file = { sha512: crypto.createHash('sha512').update('original').digest('base64') };
  file.piclingoSignature = crypto.sign(null, message('1.3.1', file), privateKey).toString('base64');
  const artifact = path.join(directory, 'file.exe');
  fs.writeFileSync(artifact, 'original');
  await verifyFile(pem, '1.3.1', file, artifact);
  fs.writeFileSync(artifact, 'tampered');
  await assert.rejects(() => verifyFile(pem, '1.3.1', file, artifact), /SHA512/);
});
test('内置源自动启用，迁移空地址并保留用户关闭检查的选择', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piclingo-feed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const defaultFeed = { provider: 'github', repository: 'owner/releases', automatic: true };
  const updates = new Updates({ directory, version: '1.3.0', policy: { defaultFeed } });
  assert.deepEqual(updates.settings(), defaultFeed);
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ provider: 'github', repository: '', automatic: false }));
  assert.deepEqual(updates.settings(), { ...defaultFeed, automatic: false });
  updates.configure({ provider: 'generic', url: 'https://custom.example/downloads', automatic: true });
  assert.equal(updates.settings().url, 'https://custom.example/downloads/');
});
test('发布工具签名真实清单并拒绝载荷不一致', async t => {
  const { sign } = require('../packaging/sign-release.cjs');
  const yaml = require('../packaging/node_modules/js-yaml');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piclingo-publish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const secret = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(path.join(directory, 'update.exe'), 'payload');
  const info = { version: '1.3.1', files: [{ url: 'update.exe', sha512: crypto.createHash('sha512').update('payload').digest('base64'), size: 7 }] };
  fs.writeFileSync(path.join(directory, 'latest.yml'), yaml.dump(info));
  await sign(directory, secret);
  const signed = yaml.load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
  verify(pem, signed.version, signed.files[0], 'win32', 'x64');
  fs.appendFileSync(path.join(directory, 'update.exe'), 'modified');
  await assert.rejects(() => sign(directory, secret), /不一致/);
});

