'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { message } = require('./release-signature.cjs');

// 私钥只从构建环境读取，客户端仅包含公钥。
async function sign(directory, privateKey) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('发布私钥必须为 Ed25519');
  const metadata = path.join(directory, 'latest.yml');
  const info = yaml.load(fs.readFileSync(metadata, 'utf8'));
  if (!Array.isArray(info.files) || !info.files.length) throw new Error('更新清单缺少文件');
  for (const file of info.files) {
    if (!/^[A-Za-z0-9_.-]+\.exe$/.test(file.url)) throw new Error('更新文件名无效');
    const artifact = path.join(directory, file.url);
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(artifact)) hash.update(chunk);
    if (hash.digest('base64') !== file.sha512 || fs.statSync(artifact).size !== file.size) throw new Error('发布文件与更新清单不一致');
    file.piclingoSignature = crypto.sign(null, message(info.version, file, 'win32', 'x64'), key).toString('base64');
  }
  fs.writeFileSync(metadata + '.tmp', yaml.dump(info, { lineWidth: -1 }));
  fs.renameSync(metadata + '.tmp', metadata);
}
if (require.main === module) {
  const key = process.env.PICLINGO_UPDATE_PRIVATE_KEY || (process.env.PICLINGO_UPDATE_PRIVATE_KEY_FILE && fs.readFileSync(process.env.PICLINGO_UPDATE_PRIVATE_KEY_FILE, 'utf8'));
  if (!process.argv[2] || !key) throw new Error('需要发布目录及 PICLINGO_UPDATE_PRIVATE_KEY 或 PICLINGO_UPDATE_PRIVATE_KEY_FILE');
  sign(path.resolve(process.argv[2]), key).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { sign };

