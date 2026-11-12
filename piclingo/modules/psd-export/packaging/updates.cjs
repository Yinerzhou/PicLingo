'use strict';
// 从用户配置的 GitHub Releases 检查更新，下载后核对 SHA256。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function newer(candidate, current) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const next = parse(candidate), installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}
class Updates {
  constructor({ directory, version }) {
    this.directory = directory;
    this.version = version;
    this.release = null;
    this.downloading = false;
    fs.mkdirSync(directory, { recursive: true });
  }
  settings() {
    try { return JSON.parse(fs.readFileSync(path.join(this.directory, 'settings.json'), 'utf8')); }
    catch { return { repository: '', automatic: true }; }
  }
  configure(repository, automatic) {
    repository = String(repository).trim();
    if (repository && !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)) throw new Error('仓库格式应为 owner/repo');
    const value = { repository, automatic: Boolean(automatic) };
    fs.writeFileSync(path.join(this.directory, 'settings.json'), JSON.stringify(value));
    this.release = null;
    return value;
  }
  async check() {
    const { repository } = this.settings();
    if (!repository) return { configured: false, message: '尚未配置 GitHub 仓库' };
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'PicLingo-Desktop', 'Accept': 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`更新检查失败，GitHub 返回 ${response.status}`);
    const release = await response.json();
    if (!newer(release.tag_name, this.version)) return { configured: true, available: false, message: '当前已是最新版本' };
    const version = release.tag_name.replace(/^v/, '');
    const filename = process.platform === 'win32' ? `PicLingo-Setup-${version}.exe` : `PicLingo-${version}-${process.arch}.dmg`;
    const asset = release.assets.find(item => item.name === filename);
    const checksum = release.assets.find(item => item.name === filename + '.sha256.txt');
    if (!asset || !checksum) throw new Error('此版本缺少当前平台安装包或 SHA256 文件');
    const prefix = `https://github.com/${repository}/releases/download/`;
    if (![asset, checksum].every(item => item.browser_download_url.startsWith(prefix))) throw new Error('更新地址不属于配置的仓库');
    this.release = { version, filename, asset, checksum };
    return { configured: true, available: true, version, message: `发现新版本 ${version}` };
  }
  async download() {
    if (this.downloading) throw new Error('更新正在下载');
    if (!this.release) throw new Error('请先检查更新');
    this.downloading = true;
    const release = this.release;
    const destination = path.join(this.directory, release.filename);
    const temporary = destination + '.partial-' + crypto.randomUUID();
    try {
      const checksumResponse = await fetch(release.checksum.browser_download_url, { signal: AbortSignal.timeout(20000) });
      if (!checksumResponse.ok || new URL(checksumResponse.url).protocol !== 'https:') throw new Error('校验文件下载失败');
      const checksumText = await checksumResponse.text();
      const expected = /^([a-f0-9]{64})(?:\s|$)/i.exec(checksumText)?.[1].toLowerCase();
      if (!expected) throw new Error('SHA256 文件格式无效');
      const response = await fetch(release.asset.browser_download_url, { signal: AbortSignal.timeout(1800000) });
      if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') throw new Error('安装包下载失败');
      const hash = crypto.createHash('sha256'); let bytes = 0;
      const validate = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 ** 3) return callback(new Error('安装包超出 2GB'));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), validate, fs.createWriteStream(temporary, { flags: 'wx' }));
      if (hash.digest('hex') !== expected) throw new Error('安装包 SHA256 不一致');
      await fs.promises.rename(temporary, destination);
      return destination;
    } finally {
      await fs.promises.rm(temporary, { force: true }); this.downloading = false;
    }
  }
}
module.exports = { Updates, newer };
