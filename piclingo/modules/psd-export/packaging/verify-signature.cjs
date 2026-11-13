'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
module.exports = (publishers, file) => new Promise(resolve => {
  const script = path.join(__dirname, 'verify-signature.ps1').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const encoded = Buffer.from(JSON.stringify(publishers), 'utf8').toString('base64');
  execFile(powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-FilePath',file,'-PublishersBase64',encoded],
    { windowsHide: true, shell: false, timeout: 60000, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout) => {
      if (error) return resolve('签名检查调用失败 ' + error.message);
      try { const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); resolve(result.ok ? null : '签名检查失败 ' + result.message); }
      catch { resolve('签名检查返回无效结果'); }
    });
});

