'use strict';
// 独立 PSD 调度器，和图片翻译后端分别启动、分别管理任务。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const crypto = require('node:crypto');
const security = require('./security.cjs');

class PsdController {
  constructor({ moduleRoot, stateRoot, packaged, send = () => {} }) {
    this.moduleRoot = moduleRoot;
    this.stateRoot = stateRoot;
    this.packaged = packaged;
    this.send = send;
    this.jobs = new Map();
    this.lastOutput = null;
    this.access = new security.FileAccess();
    fs.mkdirSync(path.join(stateRoot, 'jobs'), { recursive: true });
    this.configFile = path.join(stateRoot, 'config.json');
    if (!fs.existsSync(this.configFile)) fs.writeFileSync(this.configFile, '{}\n');
  }
  get busy() { return [...this.jobs.values()].some(job => ['inspect', 'preview', 'export', 'diagnose'].includes(job.operation)); }
  command() {
    if (this.packaged) return [path.join(this.moduleRoot, process.platform === 'win32' ? 'PicLingoPSD.exe' : 'PicLingoPSD')];
    return [path.join(this.moduleRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), path.join(this.moduleRoot, 'service.py')];
  }
  authorize(value, kind) { return this.access.authorize(value, kind); }
  exportLogs(destination) { return this.run({ operation: 'logs', destination }, true); }
  async run(request, internal = false) {
    security.request(request, this.access, internal);
    if (this.jobs.size >= 4) throw new Error('PSD 任务过多，请稍后重试');
    if (this.busy && request.operation !== 'logs' && request.operation !== 'workbook') throw new Error('PSD 任务正在处理');
    const defaults = JSON.parse(fs.readFileSync(this.configFile, 'utf8').replace(/^\uFEFF/, ''));
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw new Error('PSD 配置文件应为 JSON 对象');
    security.settings(defaults);
    const settings = Object.assign(Object.create(null), defaults);
    for (const [key, value] of Object.entries(request.settings || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) settings[key] = { ...defaults[key], ...value };
      else settings[key] = value;
    }
    request = { ...request, settings };
    const id = crypto.randomUUID();
    const directory = path.join(this.stateRoot, 'jobs', id);
    fs.mkdirSync(directory);
    const requestFile = path.join(directory, 'request.json');
    fs.writeFileSync(requestFile, JSON.stringify(request));
    const [executable, ...prefix] = this.command();
    if (!fs.existsSync(executable)) throw new Error('PSD 引擎缺失，请重新安装客户端');
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...prefix, '--request', requestFile, '--job', directory], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PICLINGO_PSD_HOME: this.stateRoot, PICLINGO_LOG_DESTINATION: internal ? path.resolve(request.destination) : '', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      });
      const job = { id, directory, operation: request.operation, child };
      this.jobs.set(id, job);
      let response = null;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        this.jobs.delete(id);
        if (error) reject(error); else resolve(value);
      };
      readline.createInterface({ input: child.stdout }).on('line', line => {
        fs.appendFileSync(path.join(directory, 'process.log'), line + '\n');
        try {
          const event = JSON.parse(line);
          if (event.event === 'result') response = event;
          else this.send({ jobId: id, ...event });
        } catch { /* 原始输出仍完整写入日志。 */ }
      });
      child.stderr.on('data', data => fs.appendFileSync(path.join(directory, 'stderr.log'), data));
      child.on('error', error => finish(error));
      child.on('close', code => {
        if (code !== 0 || !response?.ok) return finish(new Error((response?.error || `PSD 引擎退出，代码 ${code}`) + `\n日志 ${directory}`));
        if (request.operation === 'export') this.lastOutput = response.result.output_dir;
        finish(null, response.result);
      });
    });
  }
  stop() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.operation === 'export') { fs.writeFileSync(path.join(job.directory, 'cancel'), 'stop'); count++; }
    }
    return count;
  }
  async dispose() {
    this.stop();
    await Promise.race([
      Promise.all([...this.jobs.values()].map(job => new Promise(resolve => job.child.once('close', resolve)))),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    for (const job of this.jobs.values()) {
      fs.mkdirSync(path.join(this.stateRoot, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(this.stateRoot, 'runs/RECOVERY_REQUIRED.json'), JSON.stringify({ run_dir: job.directory, message: '客户端退出时调用尚未结束，请检查 Photoshop 与日志。' }));
      job.child.kill();
    }
  }
}
module.exports = { PsdController };

