'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');

// 固定字段顺序，把版本、平台和载荷摘要一同签名，防止跨平台重用清单。
function message(version, file, platform = process.platform, arch = process.arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '')) throw new Error('更新签名元数据无效');
  return Buffer.from(JSON.stringify({ schema: 1, version, platform, arch, sha512: file.sha512 }));
}
function verify(publicKey, version, file, platform, arch) {
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('更新公钥必须为 Ed25519');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(file.piclingoSignature || '') || !crypto.verify(null, message(version, file, platform, arch), key, Buffer.from(file.piclingoSignature, 'base64'))) throw new Error('更新发布签名无效，请等待发布者修复');
}
async function verifyFile(publicKey, version, info, file) {
  verify(publicKey, version, info);
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('base64') !== info.sha512) throw new Error('更新缓存 SHA512 校验失败');
}
module.exports = { message, verify, verifyFile };

