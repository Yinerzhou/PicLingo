'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class Backend {
  constructor({ workerPath, tempRoot, logFile, onProgress = () => {}, env = {} }) {
    this.env = env;
    this.workerPath = workerPath; this.tempRoot = path.resolve(tempRoot); this.logFile = logFile; this.onProgress = onProgress;
    this.pending = new Map(); this.documents = new Map(); this.counter = 0; this.child = null;
    fs.mkdirSync(this.tempRoot, { recursive: true });
    this.session = fs.mkdtempSync(path.join(this.tempRoot, 'PicLingo-session-'));
  }
  get busy() { return [...this.pending.values()].some(item => ['translate', 'render', 'install'].includes(item.method)); }
  start() {
    if (this.child) return;
    if (!fs.existsSync(this.workerPath)) throw new Error('本地翻译引擎缺失，请重新安装程序。');
    const child = spawn(this.workerPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...this.env, QT_QPA_PLATFORM: 'offscreen', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.event === 'progress') { this.onProgress(String(message.text).slice(0, 1000)); return; }
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    child.stderr.on('data', chunk => { try { fs.appendFileSync(this.logFile, chunk); } catch {} });
    const failed = error => {
      if (this.child !== child) return;
      this.child = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(error?.message || '本地处理服务已停止，请重新翻译图片。')); }
      this.pending.clear(); this.documents.clear();
    };
    child.on('error', failed); child.on('exit', () => failed());
    child.stdin.on('error', error => failed(error));
  }
  request(method, params = {}) {
    this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('处理超时，请稍后重试。')); this.child?.kill(); }, method === 'install' ? 900000 : 300000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  language(value) {
    if (typeof value !== 'string' || !/^[a-z]{2,4}$/.test(value)) throw new Error('语言参数无效');
    return value;
  }
  record(docId) {
    if (typeof docId !== 'string' || !this.documents.has(docId)) throw new Error('处理结果已失效，请重新翻译图片。');
    return this.documents.get(docId);
  }
  result(result, record) {
    if (!result || !/^[a-f0-9]{32}$/.test(result.docId) || !Array.isArray(result.blocks) || result.blocks.length > 10000) throw new Error('本地引擎返回了无效结果');
    const output = path.resolve(result.path);
    if (path.dirname(output) !== record.directory) throw new Error('处理结果超出了工作目录');
    record.path = output; record.blocks = result.blocks; record.warnings = result.warnings;
    this.documents.set(result.docId, record);
    return { docId: result.docId, pngBytes: fs.readFileSync(output), blocks: result.blocks, warnings: result.warnings };
  }
  async translate(request) {
    if (!request || !['zh', 'en', 'auto'].includes(request.source)) throw new Error('当前仅支持识别中英文原图');
    const target = this.language(request.target);
    if (!(request.bytes instanceof Uint8Array) || !request.bytes.length || request.bytes.length > 20 * 1024 * 1024) throw new Error('图片数据无效或超过 20MB');
    const directory = await fsp.mkdtemp(path.join(this.session, 'image-'));
    const input = path.join(directory, 'input.png');
    await fsp.writeFile(input, request.bytes);
    const name = typeof request.name === 'string' ? path.basename(request.name).slice(0, 240) : 'image.png';
    const result = await this.request('translate', { input, directory, source: request.source, target, offline: request.offline !== false });
    return this.result(result, { directory, name, target });
  }
  async render(request) {
    const record = this.record(request?.docId);
    if (!Array.isArray(request.edits) || request.edits.length !== record.blocks.length) throw new Error('译文数量不匹配');
    const edits = request.edits.map(edit => {
      if (typeof edit.translated !== 'string' || edit.translated.length > 10000) throw new Error('译文过长或格式不正确');
      return { translated: edit.translated, enabled: edit.enabled !== false };
    });
    const result = await this.request('render', { docId: request.docId, edits });
    return this.result(result, record);
  }
  models() { return this.request('models'); }
  install(target) { return this.request('install', { target: this.language(target) }); }
  async release(docIds) {
    if (!Array.isArray(docIds) || docIds.length > 1000) throw new Error('无效的结果列表');
    const known = docIds.filter(id => this.documents.has(id));
    for (const id of known) this.documents.delete(id);
    if (this.child && known.length) await this.request('release', { docIds: known });
  }
  async exportDirectory(docIds, folder) {
    if (!Array.isArray(docIds) || !docIds.length || docIds.length > 1000) throw new Error('请选择已翻译的图片');
    const outputs = [];
    for (const id of docIds) {
      const record = this.record(id);
      const stem = path.parse(record.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'image';
      let file, index = 1;
      do { file = path.join(folder, `${stem}_${record.target}${index === 1 ? '' : '_' + index}.png`); index++; }
      while (fs.existsSync(file) || fs.existsSync(file.replace(/\.png$/, '.json')));
      await fsp.copyFile(record.path, file, fs.constants.COPYFILE_EXCL);
      await fsp.writeFile(file.replace(/\.png$/, '.json'), JSON.stringify({ source: record.name, target: record.target, blocks: record.blocks, warnings: record.warnings || [] }, null, 2), { flag: 'wx' });
      outputs.push(file);
    }
    return outputs;
  }
  async dispose() {
    const child = this.child;
    if (child) await new Promise(resolve => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 2000).unref(); });
    const resolved = path.resolve(this.session);
    if (path.dirname(resolved) !== this.tempRoot || !path.basename(resolved).startsWith('PicLingo-session-') || fs.lstatSync(resolved).isSymbolicLink()) return;
    await fsp.rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  }
}
module.exports = { Backend };
