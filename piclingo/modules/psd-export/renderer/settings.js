'use strict';
(() => {
  const api = window.piclingo;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const status = message => { $('update-status').textContent = message; };
  let prompted = '';
  function state(value) {
    status(value.message);
    $('update-progress').value = value.progress || 0;
    $('update-progress').hidden = value.phase !== 'downloading';
    $('update-progress-text').textContent = value.phase === 'downloading' ? `${(value.progress || 0).toFixed(1)}%` : '';
    $('update-notes').textContent = value.notes || '';
    const downloaded = value.phase === 'downloaded';
    $('update-install').disabled = !downloaded; $('update-defer').disabled = !downloaded;
    if (downloaded && prompted !== value.version) {
      prompted = value.version;
      $('update-dialog-notes').textContent = value.notes || '此版本未提供更新日志。';
      $('update-dialog').showModal();
    }
  }
  async function save() {
    const provider = $('update-provider').value;
    return api.configureUpdates({ provider, repository: $('update-repository').value, url: $('update-url').value, automatic: $('update-automatic').checked });
  }
  function fields() { const github = $('update-provider').value === 'github'; $('update-repository-field').hidden = !github; $('update-url-field').hidden = github; }
  $('update-provider').addEventListener('change', fields);
  $('settings-export-logs').addEventListener('click', async () => {
    try { const result = await api.exportLogs(); if (result) status('日志已导出 · ' + result.path); } catch (error) { status(error.message); }
  });
  $('update-check').addEventListener('click', async () => {
    $('update-check').disabled = true;
    try { await save(); state(await api.checkUpdates()); } catch (error) { status(error.message); }
    finally { $('update-check').disabled = false; }
  });
  async function install() {
    try { await api.installUpdate(); } catch (error) { status(error.message); $('update-dialog-status').textContent = error.message; }
  }
  async function defer() {
    try { state(await api.deferUpdate()); $('update-dialog').close(); } catch (error) { status(error.message); }
  }
  $('update-install').addEventListener('click', install);
  $('update-dialog-install').addEventListener('click', install);
  $('update-defer').addEventListener('click', defer);
  $('update-dialog-defer').addEventListener('click', defer);
  $('update-automatic').addEventListener('change', () => save().catch(error => status(error.message)));
  api.onUpdateState(state);
  api.getUpdateSettings().then(settings => {
    $('update-provider').value = settings.provider || 'github';
    $('update-repository').value = settings.repository || ''; $('update-url').value = settings.url || '';
    $('update-automatic').checked = settings.automatic; fields();
    status(settings.repository || settings.url ? '更新源已配置' : '尚未配置更新源');
    return api.getUpdateState();
  }).then(state).catch(error => status(error.message));
})();

