'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { object } = require('../security.cjs');
const releaseSignature = require('./release-signature.cjs');
const INTERVAL = 4 * 60 * 60 * 1000;
function newer(candidate, current) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const next = parse(candidate), installed = parse(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) if (next[i] !== installed[i]) return next[i] > installed[i];
  return false;
}
function configuration(input, automatic) {
  if (typeof input === 'string') input = { provider: 'github', repository: input.trim(), automatic };
  object(input, '更新设置');
  if (typeof input.automatic !== 'boolean') throw new Error('自动检查设置无效');
  if (input.provider === 'github') {
    const repository = String(input.repository || '').trim();
    if (repository && !/^[a-z\d_.-]{1,100}\/[a-z\d_.-]{1,100}$/i.test(repository)) throw new Error('仓库格式应为 owner/repo');
    return { provider: 'github', repository, automatic: input.automatic };
  }
  if (input.provider === 'generic') {
    const raw = String(input.url || '').trim();
    if (!raw) return { provider: 'generic', url: '', automatic: input.automatic };
    if (raw.length > 2048) throw new Error('更新地址过长');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('更新源需要无凭据的 HTTPS 目录地址');
    return { provider: 'generic', url: url.href.endsWith('/') ? url.href : url.href + '/', automatic: input.automatic };
  }
  throw new Error('更新提供方无效');
}
class Updates {
  constructor({ directory, version, policy = {}, packaged = false, send = () => {}, busy = () => false, dispose = async () => {}, factory, clock = globalThis }) {
    Object.assign(this, { directory, version, policy, packaged, send, busy, dispose, factory, clock });
    fs.mkdirSync(directory, { recursive: true });
    this.state = { phase: 'idle', message: '就绪', progress: 0, notes: '' };
    this.updater = null; this.checking = false; this.downloading = false; this.installing = false;
    this.pendingFromLaunch = this.deferredVersion();
  }
  log(level, message) {
    try {
      const file = path.join(this.directory, 'update.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 ** 2) fs.renameSync(file, file + '.1');
      const safe = String(message).replace(/(token|password|authorization)([=: ]+)\S+/gi, '$1$2[redacted]').replace(/https:\/\/\S+/g, text => { try { const url = new URL(text); return url.origin + url.pathname; } catch { return '[URL]'; } });
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${safe}\n`);
    } catch { /* 日志故障不影响用户任务。 */ }
  }
  publish(value) { this.state = { ...this.state, ...value }; this.send(this.state); }
  error(error) { this.installing = false; this.log('error', error.stack || error.message || error); this.publish({ phase: 'error', message: error.message || String(error) }); }
  settings() {
    const defaults = this.policy.defaultFeed || { provider: 'github', repository: '', automatic: true };
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.directory, 'settings.json'), 'utf8'));
      const saved = configuration(value.provider ? value : { provider: 'github', ...value });
      // 旧版本保存的空地址沿用内置源，同时保留用户的自动检查开关。
      return saved.repository || saved.url ? saved : configuration({ ...defaults, automatic: saved.automatic });
    } catch { return configuration(defaults); }
  }
  configure(input, automatic) {
    if (this.downloading || this.checking || this.installing) throw new Error('请等待更新操作结束再更换更新源');
    const value = configuration(input, automatic);
    fs.writeFileSync(path.join(this.directory, 'settings.json.tmp'), JSON.stringify(value));
    fs.renameSync(path.join(this.directory, 'settings.json.tmp'), path.join(this.directory, 'settings.json'));
    if (this.updater?.setFeedURL) {
      this.updater.closeServerIfExists?.();
      const options = this.provider();
      if (options) this.updater.setFeedURL(options);
    } else { this.updater?.removeAllListeners(); this.updater = null; }
    this.publish({ phase: 'idle', message: '更新源已保存', notes: '', progress: 0 });
    return value;
  }
  provider() {
    const value = this.settings();
    if (value.provider === 'generic') return value.url ? { provider: 'generic', url: value.url } : null;
    if (!value.repository) return null;
    const [owner, repo] = value.repository.split('/');
    return { provider: 'github', owner, repo, private: false };
  }
  requireSignature() {
    if (process.platform === 'win32' && this.policy.updatePublicKey) return;
    if (!this.policy.signed || (process.platform === 'win32' && !this.policy.publisherName)) throw new Error('当前构建未配置正式发布签名，自动安装已停用，请使用已签名发行版');
  }
  releaseFile() {
    return this.downloadInfo?.files?.find(item => process.platform === 'win32' ? /\.exe$/i.test(new URL(item.url, 'https://update.invalid/').pathname) : /\.zip$/i.test(new URL(item.url, 'https://update.invalid/').pathname));
  }
  engine() {
    if (this.updater) return this.updater;
    const options = this.provider();
    if (!options) return null;
    if (!this.packaged && !this.factory) throw new Error('开发模式不执行正式自动更新');
    const updater = this.factory ? this.factory(options) : new (require('electron-updater')[process.platform === 'darwin' ? 'MacUpdater' : 'NsisUpdater'])(options);
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowDowngrade = false; updater.allowPrerelease = false; updater.disableWebInstaller = true;
    if (updater.httpExecutor) {
      const createRequest = updater.httpExecutor.createRequest.bind(updater.httpExecutor);
      updater.httpExecutor.createRequest = (options, callback) => {
        if (options.protocol !== 'https:') throw new Error('更新请求及重定向必须使用 HTTPS');
        return createRequest(options, callback);
      };
    }
    updater.logger = Object.fromEntries(['info','warn','error','debug'].map(level => [level, (...args) => this.log(level, args.join(' '))]));
    if (process.platform === 'win32' && this.policy.publisherName) {
      // 固定本机发行策略中的身份，更换下载源仍执行相同身份验证。
      updater.configOnDisk = { value: Promise.resolve({ publisherName: this.policy.publisherName }) };
      if (!this.factory) updater.verifyUpdateCodeSignature = require('./verify-signature.cjs');
    }
    if (process.platform === 'win32' && this.policy.updatePublicKey) {
      // 通过 NSIS 自定义验证入口校验发布签名，禁止无校验安装。
      updater.configOnDisk = { value: Promise.resolve({ publisherName: 'PicLingo Ed25519' }) };
      updater.verifyUpdateCodeSignature = async (_publishers, file) => {
        try {
          await releaseSignature.verifyFile(this.policy.updatePublicKey, this.downloadInfo.version, this.releaseFile(), file);
          if (this.policy.signed && this.policy.publisherName) return require('./verify-signature.cjs')([this.policy.publisherName], file);
          return null;
        } catch (error) { return error.message; }
      };
    }
    updater.on('error', error => this.error(error));
    updater.on('update-available', info => {
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes || []).map(item => item.note || '').join('\n');
      this.publish({ phase: 'available', version: info.version, message: '发现版本 ' + info.version, notes: notes.slice(0, 20000) });
    });
    updater.on('update-not-available', () => this.publish({ phase: 'idle', message: '当前已是最新版本' }));
    updater.on('download-progress', progress => this.publish({ phase: 'downloading', message: '后台下载中', progress: Math.min(100, Math.max(0, progress.percent)), transferred: progress.transferred, total: progress.total }));
    updater.on('update-downloaded', info => {
      this.publish({ phase: 'downloaded', version: info.version, message: '下载完成，可重启更新', progress: 100 });
      this.log('info', '更新下载并校验完成 ' + info.version);
    });
    this.updater = updater;
    return updater;
  }
  async check() {
    if (this.checking || this.downloading || this.installing) return { ...this.state, message: '更新正在处理' };
    if (!this.provider()) return { configured: false, message: '尚未配置更新源' };
    this.checking = true;
    const pending = this.pendingFromLaunch;
    this.pendingFromLaunch = null;
    try {
      this.publish({ phase: 'checking', message: '正在检查更新' }); this.log('info', '检查更新');
      const result = await this.engine().checkForUpdates();
      if (result && newer(result.updateInfo.version, this.version)) {
        this.downloadInfo = result.updateInfo;
        if (process.platform === 'win32' && this.policy.updatePublicKey) releaseSignature.verify(this.policy.updatePublicKey, this.downloadInfo.version, this.releaseFile());
        this.requireSignature(); await this.download();
        if (pending === result.updateInfo.version && !this.busy()) await this.install();
      }
      return { configured: true, available: this.state.phase === 'downloaded', ...this.state };
    } catch (error) { this.error(error); return { configured: true, available: false, ...this.state }; }
    finally { this.checking = false; }
  }
  async download() {
    if (this.downloading) throw new Error('更新正在下载');
    this.requireSignature(); this.downloading = true;
    try { await this.engine().downloadUpdate(); }
    catch (error) { this.error(error); throw error; }
    finally { this.downloading = false; }
  }
  deferredVersion() { try { return JSON.parse(fs.readFileSync(path.join(this.directory, 'deferred.json'), 'utf8')).version; } catch { return null; } }
  defer() {
    if (this.state.phase !== 'downloaded') throw new Error('更新尚未就绪');
    fs.writeFileSync(path.join(this.directory, 'deferred.json'), JSON.stringify({ version: this.state.version }));
    this.publish({ message: '已设为下次启动时更新' }); return this.state;
  }
  async install() {
    this.requireSignature();
    if (this.state.phase !== 'downloaded' || this.installing) throw new Error('更新尚未就绪');
    if (this.busy()) throw new Error('请等待当前图片或 PSD 任务完成');
    this.installing = true;
    try {
      const engine = this.engine();
      const file = engine.downloadedUpdateHelper?.file;
      const info = this.downloadInfo?.files?.find(item => process.platform === 'win32' ? /\.exe$/i.test(new URL(item.url, 'https://update.invalid/').pathname) : /\.zip$/i.test(new URL(item.url, 'https://update.invalid/').pathname));
      if (!file || !info?.sha512) throw new Error('更新缓存或摘要信息缺失，请重新检查更新');
      const hash = crypto.createHash('sha512');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      if (hash.digest('base64') !== info.sha512) throw new Error('更新缓存 SHA512 校验失败');
      if (process.platform === 'win32') {
        const failure = await engine.verifySignature(file);
        if (failure) throw new Error(failure);
      }
      if (this.busy()) throw new Error('请等待当前任务结束');
      await this.dispose();
      fs.rmSync(path.join(this.directory, 'deferred.json'), { force: true });
      this.log('info', '开始安装已验证更新'); this.engine().quitAndInstall(true, true);
      return { started: true };
    } catch (error) { this.installing = false; this.error(error); throw error; }
  }
  start() {
    const check = () => { if (this.settings().automatic) void this.check().catch(error => this.error(error)); };
    this.delay = this.clock.setTimeout(check, 30000); this.delay?.unref?.();
    this.interval = this.clock.setInterval(check, INTERVAL); this.interval?.unref?.();
  }
  stop() { this.clock.clearTimeout(this.delay); this.clock.clearInterval(this.interval); }
}
module.exports = { Updates, newer, configuration, INTERVAL };

