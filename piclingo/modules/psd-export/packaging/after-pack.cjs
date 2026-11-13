'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const directory = context.appOutDir;
  const resources = context.electronPlatformName === 'darwin' ? path.join(directory, 'PicLingo.app/Contents/Resources') : path.join(directory, 'resources');
  const signed = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
  const publisherName = process.env.PICLINGO_PUBLISHER || '';
  const { configuration } = require('./updates.cjs');
  const defaultFeed = configuration(process.env.PICLINGO_UPDATE_URL
    ? { provider: 'generic', url: process.env.PICLINGO_UPDATE_URL, automatic: true }
    : require('./release-channel.json'));
  const updatePublicKey = fs.readFileSync(path.join(__dirname, 'update-public-key.pem'), 'utf8');
  if (require('node:crypto').createPublicKey(updatePublicKey).asymmetricKeyType !== 'ed25519') throw new Error('更新公钥无效');
  if (signed && context.electronPlatformName === 'win32' && !publisherName) throw new Error('Windows 签名构建需要 PICLINGO_PUBLISHER');
  fs.writeFileSync(path.join(resources, 'update-policy.json'), JSON.stringify({ signed, publisherName, defaultFeed, updatePublicKey }));
  if (process.env.PICLINGO_TEST_BUILD === '1') fs.writeFileSync(path.join(resources, 'piclingo-test-build.json'), '{}');
  if (context.electronPlatformName !== 'win32') return;
  fs.copyFileSync(path.join(__dirname, '../release/PicLingoMaintenance.exe'), path.join(directory, 'PicLingoMaintenance.exe'));
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Windows 安装载荷含链接');
      if (entry.isDirectory()) walk(file); else files.push(path.relative(directory, file).split(path.sep).join('/'));
    }
  }
  walk(directory);
  // NSIS 在 afterPack 之后加入此固定辅助程序。
  if (!files.includes('resources/elevate.exe')) files.push('resources/elevate.exe');
  fs.writeFileSync(path.join(directory, '.piclingo-managed.json'), JSON.stringify(files));
  fs.writeFileSync(path.join(__dirname, '../release/nsis-incoming.json'), JSON.stringify(files));
};

