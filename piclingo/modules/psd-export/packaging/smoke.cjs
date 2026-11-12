'use strict';
// 通过页面按钮和原生 IPC 验证完整工作流，文件选择使用测试专用固定样本。
const fs = require('node:fs');
const path = require('node:path');
async function runPsdSmoke(win, scenario) {
  const evaluate = script => win.webContents.executeJavaScript(script);
  async function wait(expression, label, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(label + '超时：' + await evaluate("document.getElementById('psd-status').textContent"));
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await click('psd-nav');
  await click('psd-select');
  await wait(`document.querySelectorAll('#psd-files > div').length === ${scenario.files.length} && !document.getElementById('psd-select').disabled`, '选择PSD');
  await click('psd-excel-select');
  await wait("document.querySelectorAll('#psd-languages input').length > 0 && !document.getElementById('psd-select').disabled", '读取Excel');
  await click('psd-preview');
  await wait("document.querySelectorAll('#psd-matches tbody tr').length > 0 && !document.getElementById('psd-preview').disabled", '读取匹配');
  await click('psd-output-select');
  await wait("!document.getElementById('psd-export').disabled", '选择目录');
  await evaluate(`document.getElementById('psd-format').value=${JSON.stringify(scenario.format || 'png')}; document.getElementById('psd-overflow').value='shrink';`);
  await click('psd-export');
  await wait("document.getElementById('psd-status').textContent.startsWith('导出完成') && !document.getElementById('psd-export').disabled", '导出', 300000);
  const result = await evaluate(`({status:document.getElementById('psd-status').textContent,rows:document.querySelectorAll('#psd-matches tbody tr').length,results:document.getElementById('psd-results').textContent,veil:document.getElementById('veil-range').value,range:[document.getElementById('veil-range').min,document.getElementById('veil-range').max],imagePageHidden:document.querySelector('.main-content').hidden})`);
  if (!result.status.includes('成功 ' + scenario.files.length) || !result.status.includes('失败 0') || result.veil !== '94') throw new Error('PSD 界面验收失败：' + JSON.stringify(result));
  await click('workspace-nav');
  result.imagePageRestored = await evaluate("!document.querySelector('.main-content').hidden && document.getElementById('psd-page').hidden");
  await click('psd-nav');
  fs.mkdirSync(path.dirname(scenario.result), { recursive: true });
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 500));
  fs.writeFileSync(path.join(path.dirname(scenario.result), 'psd-ui.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(scenario.result, JSON.stringify(result, null, 2));
}
module.exports = { runPsdSmoke };
