'use strict';
(() => {
  const api = window.piclingo;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const status = message => { $('update-status').textContent = message; };
  $('settings-export-logs').addEventListener('click', async () => {
    try { const result = await api.exportLogs(); if (result) status('日志已导出 · ' + result.path); }
    catch (error) { status(error.message); }
  });
  async function check(save = true) {
    $('update-check').disabled = true;
    try {
      if (save) await api.configureUpdates($('update-repository').value, $('update-automatic').checked);
      const result = await api.checkUpdates();
      status(result.message); $('update-install').disabled = !result.available;
    } catch (error) { status(error.message); }
    finally { $('update-check').disabled = false; }
  }
  $('update-check').addEventListener('click', () => check());
  $('update-install').addEventListener('click', async () => {
    $('update-install').disabled = true; status('正在下载并校验安装包');
    try { await api.installUpdate(); status('安装包已打开'); }
    catch (error) { status(error.message); $('update-install').disabled = false; }
  });
  $('update-automatic').addEventListener('change', () => api.configureUpdates($('update-repository').value, $('update-automatic').checked).catch(error => status(error.message)));
  api.getUpdateSettings().then(settings => {
    $('update-repository').value = settings.repository;
    $('update-automatic').checked = settings.automatic;
    status(settings.repository ? '更新源已配置' : '尚未配置 GitHub 仓库');
    if (settings.repository && settings.automatic) check(false);
  }).catch(error => status(error.message));
})();
