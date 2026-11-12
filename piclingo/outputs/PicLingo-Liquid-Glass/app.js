'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { files: [], selected: null, source: 'zh', target: 'en', languages: [], busy: false, modelBusy: false, cancelled: false, toastTimer: null, dragDepth: 0 };
function toast(message) {
  clearTimeout(state.toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  state.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}
window.addEventListener('piclingo:notice', event => toast(event.detail.message));
function selectedFile() { return state.files.find(file => file.id === state.selected); }
function status(message) { $('#app-status').textContent = message; }
function download(href, name) {
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
function releaseFile(file) { URL.revokeObjectURL(file.url); if (file.translatedUrl) URL.revokeObjectURL(file.translatedUrl); }

function renderFiles() {
  const list = $('#file-list'); list.replaceChildren();
  if (!state.files.length) { const empty = document.createElement('p'); empty.className = 'queue-empty'; empty.textContent = '尚未导入图片'; list.append(empty); }
  for (const file of state.files) {
    const button = document.createElement('button');
    button.className = `file-item${file.id === state.selected ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(file.id === state.selected)); button.title = file.error ? `${file.name}\n${file.error}` : file.name;
    const image = document.createElement('img'); image.src = file.url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const content = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = file.name;
    const description = document.createElement('small'); description.textContent = file.status;
    content.append(name, description); button.append(image, content);
    button.addEventListener('click', () => { state.selected = file.id; renderFiles(); renderPreview(); }); list.append(button);
  }
  $('#nav-count').textContent = String(state.files.length);
  $('#image-count').textContent = `${state.files.length} 张图片`;
}
function renderEditor(file) {
  const table = $('.translation-table'); table.replaceChildren();
  for (const title of ['识别原文', '译文']) { const heading = document.createElement('div'); heading.className = 'table-head'; heading.textContent = title; table.append(heading); }
  const blocks = file?.blocks || [];
  if (!blocks.length) { const empty = document.createElement('p'); empty.className = 'editor-empty'; empty.style.gridColumn = '1 / -1'; empty.textContent = '翻译完成后，可在这里校对译文。'; table.append(empty); }
  blocks.forEach((block, index) => {
    const source = document.createElement('div'); source.className = 'source-text source-cell'; const check = document.createElement('input'); check.type = 'checkbox'; check.checked = block.enabled !== false; check.setAttribute('aria-label', `替换第 ${index + 1} 处文字`); check.addEventListener('change', () => { block.enabled = check.checked; file.dirty = true; $('#apply-edits').disabled = state.busy; }); const label = document.createElement('label'); label.textContent = block.source; label.htmlFor = `edit-${index}`; source.append(check, label);
    const editor = document.createElement('textarea'); editor.id = `edit-${index}`; editor.rows = 1; editor.value = block.translated; editor.setAttribute('aria-label', `第 ${index + 1} 处译文`);
    editor.addEventListener('input', () => { block.translated = editor.value; file.dirty = true; $('#apply-edits').disabled = state.busy; }); table.append(source, editor);
  });
  $('#download-text').disabled = !blocks.length; $('#apply-edits').disabled = !file?.dirty || state.busy || !file?.docId;
}
function renderPreview() {
  const file = selectedFile(), reverse = state.source === 'en';
  const original = $('#original-image'), translated = $('#translated-image');
  $('#source-language').value = state.source; $('#target-language').value = state.target;
  $('#source-symbol').textContent = state.source === 'auto' ? '自动' : reverse ? 'EN' : '中'; $('#target-symbol').textContent = state.target === 'zh' ? '中' : state.target.toUpperCase();
  $('#original-language-label').textContent = state.source === 'auto' ? '自动识别' : reverse ? 'English' : '简体中文';
  $('#translated-language-label').textContent = languageName(file?.target || state.target);
  $('#original-filename').textContent = file?.name || '尚未导入图片'; $('#image-dimensions').textContent = '—';
  $('#original-empty').hidden = !!file; $('#original-empty strong').textContent = '添加图片，开始翻译'; original.hidden = !file;
  if (file) {
    original.onload = () => { $('#image-dimensions').textContent = `${original.naturalWidth} × ${original.naturalHeight}`; };
    original.onerror = () => { original.hidden = true; $('#original-empty').hidden = false; $('#original-empty strong').textContent = '暂时无法预览此图片'; toast('无法解码此图片，请尝试其他图片。'); };
    original.src = file.url; original.alt = file.name;
  } else original.removeAttribute('src');
  const hasResult = !!file?.translatedUrl;
  translated.hidden = !hasResult; $('#translated-empty').hidden = hasResult;
  $('#download-card').disabled = !hasResult; $('#preview-button').disabled = !state.files.length || state.busy || state.modelBusy; $('#export-all').disabled = !state.files.some(item => item.docId) || state.busy; $('#stop-button').disabled = !state.busy || state.cancelled;
  $('#reset-button').disabled = state.busy || !state.files.length;
  $('#result-status').textContent = hasResult ? `✓ 已翻译 · ${file.blocks.length} 处文字` : '等待翻译';
  $('#preview-note').textContent = state.busy ? '正在处理图片，请稍候' : state.files.length ? `已导入 ${state.files.length} 张图片` : '尚未导入图片';
  if (hasResult) { translated.src = file.translatedUrl; translated.alt = `${file.name}的翻译结果`; } else translated.removeAttribute('src');
  renderEditor(file);
}
function importFiles(input) {
  if (state.busy) return;
  const files = [...input];
  const accepted = files.filter(file => /\.(png|jpe?g|webp|bmp)$/i.test(file.name) && file.size <= 20 * 1024 * 1024).slice(0, 1000 - state.files.length);
  if (!accepted.length) { toast('请选择 20MB 以内的 PNG、JPG、WEBP 或 BMP 图片，队列最多 1000 张。'); return; }
  const additions = accepted.map((file, index) => ({ id: `file-${Date.now()}-${index}`, name: file.name, file, url: URL.createObjectURL(file), translatedUrl: null, blocks: [], status: '待处理' }));
  state.files.push(...additions); state.selected = additions[0].id;
  renderFiles(); renderPreview(); status(`已导入 ${state.files.length} 张图片`);
  toast(`已添加 ${accepted.length} 张图片${accepted.length < files.length ? '，部分文件未通过检查' : ''}`);
}
$$('[data-import]').forEach(button => button.addEventListener('click', () => $('#file-input').click()));
$('#file-input').addEventListener('change', event => { importFiles(event.target.files); event.target.value = ''; });
function changeDirection(source) { state.source = source; if (source === state.target) state.target = source === 'zh' ? 'en' : 'zh'; renderPreview(); }
$('#source-language').addEventListener('change', event => changeDirection(event.target.value));
$('#target-language').addEventListener('change', event => { state.target = event.target.value; renderPreview(); });
$('#swap-language').addEventListener('click', () => { if (!['zh', 'en'].includes(state.target)) return toast('当前仅支持识别中英文原图，无法将此目标语言设为原文。'); const source = state.source === 'auto' ? 'zh' : state.source; state.source = state.target; state.target = source; renderPreview(); });
$('#reset-button').addEventListener('click', () => { if (state.busy) return; window.piclingo?.releaseDocuments?.(state.files.filter(file => file.docId).map(file => file.docId)).catch(() => {}); state.files.forEach(releaseFile); state.files = []; state.selected = null; renderFiles(); renderPreview(); status('就绪 · 尚未导入图片'); });
$('#workspace-nav').addEventListener('click', () => { $('.main-content').scrollTop = 0; });
$$('[data-view]').forEach(button => button.addEventListener('click', () => {
  $('#preview-grid').dataset.mode = button.dataset.view;
  $$('[data-view]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
}));
$('#fit-button').addEventListener('click', () => $('[data-view="compare"]').click());
$('#preview-button').addEventListener('click', async () => {
  if (state.busy || !state.files.length) return;
  if (typeof window.piclingo?.translateImage !== 'function') { status('翻译服务未连接'); toast('翻译服务未连接，请检查客户端服务是否已启动。'); return; }
  state.busy = true; state.cancelled = false; renderPreview(); let completed = 0;
  const source = state.source, target = state.target;
  $('#source-language').disabled = $('#target-language').disabled = $('#swap-language').disabled = $('#offline-switch').disabled = true;
  try {
    for (const file of state.files) {
      if (state.cancelled) break;
      file.status = '处理中'; file.error = ''; renderFiles(); status(`正在处理 ${completed + 1}/${state.files.length} · ${file.name}`);
      try {
        const result = await window.piclingo.translateImage({ name: file.name, bytes: new Uint8Array(await file.file.arrayBuffer()), source, target, offline: $('#offline-switch').checked });
        if ((!result?.pngBytes?.length && !result?.imageUrl) || !Array.isArray(result.blocks)) throw new Error('翻译服务未返回有效图片');
        if (file.translatedUrl) URL.revokeObjectURL(file.translatedUrl);
        file.translatedUrl = result.imageUrl || URL.createObjectURL(new Blob([new Uint8Array(result.pngBytes)], { type: 'image/png' })); file.docId = result.docId; file.dirty = false;
        file.blocks = result.blocks.map(block => ({ source: String(block.source ?? ''), translated: String(block.translated ?? ''), enabled: block.enabled !== false }));
        file.target = target; file.status = '已完成'; completed++;
      } catch (error) { file.status = '处理失败'; file.error = error.message; toast(`${file.name}：${error.message}`); }
      renderFiles(); renderPreview();
    }
  } finally {
    state.busy = false; $('#source-language').disabled = $('#target-language').disabled = $('#swap-language').disabled = $('#offline-switch').disabled = false;
    renderPreview(); status(`${state.cancelled ? '已停止' : '处理完成'} · 成功 ${completed} / 共 ${state.files.length} 张`);
  }
});
$('#download-card').addEventListener('click', () => { const file = selectedFile(); if (file?.docId && window.piclingo?.saveImage) { window.piclingo.saveImage(file.docId).then(result => { if (!result.canceled) toast('译图已保存'); }).catch(error => toast(error.message)); return; } if (file?.translatedUrl) download(file.translatedUrl, `${file.name.replace(/\.[^.]+$/, '')}_${file.target}.png`); });
$('#download-text').addEventListener('click', () => {
  const file = selectedFile(); if (!file?.blocks.length) return;
  const content = file.blocks.map(block => `${block.source}\n${block.translated}`).join('\n\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' }));
  download(url, `${file.name.replace(/\.[^.]+$/, '')}_校对译文.txt`); setTimeout(() => URL.revokeObjectURL(url), 3000);
});
$('#offline-switch').addEventListener('change', event => { $('#mode-status').textContent = event.target.checked ? '离线模式' : '允许下载模型'; });
$$('[data-open]').forEach(button => button.addEventListener('click', async () => {
  const dialog = document.getElementById(button.dataset.open); for (const open of $$('dialog[open]')) open.close(); dialog.showModal();
  if (dialog.id === 'languages-dialog') {
    await loadModels(); renderModels();
  }
}));
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); }));
const windowElement = $('.app-window');
windowElement.addEventListener('dragenter', event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); state.dragDepth++; $('#drop-overlay').hidden = false; });
windowElement.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
windowElement.addEventListener('dragleave', () => { state.dragDepth = Math.max(0, state.dragDepth - 1); if (!state.dragDepth) $('#drop-overlay').hidden = true; });
windowElement.addEventListener('drop', event => { event.preventDefault(); state.dragDepth = 0; $('#drop-overlay').hidden = true; importFiles(event.dataTransfer.files); });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { event.preventDefault(); state.dragDepth = 0; $('#drop-overlay').hidden = true; });
window.addEventListener('beforeunload', () => state.files.forEach(releaseFile));
renderFiles(); renderPreview();

function languageName(code) { return state.languages.find(item => item.code === code)?.name || (code === 'zh' ? '简体中文' : code === 'en' ? 'English' : code); }
async function loadModels() {
  if (!window.piclingo?.getModels) return;
  try {
    const models = await window.piclingo.getModels();
    if (!Array.isArray(models.languages)) return;
    state.languages = models.languages;
    const select = $('#target-language'); select.replaceChildren();
    for (const language of models.languages) { const option = document.createElement('option'); option.value = language.code; option.textContent = language.name + (language.installed ? '' : '（需语言包）'); select.append(option); }
    select.value = state.target; renderPreview();
  } catch (error) { status('本地模型读取失败：' + error.message); }
}
function renderModels() {
  const list = $('#model-list'); list.replaceChildren();
  for (const language of state.languages) {
    const row = document.createElement('div'); row.className = 'model-row glass';
    const symbol = document.createElement('span'); symbol.className = 'model-symbol'; symbol.textContent = language.code.toUpperCase();
    const label = document.createElement('div'); const title = document.createElement('strong'); title.textContent = language.name; const sub = document.createElement('small'); sub.textContent = language.installed ? '已就绪，可离线使用' : '安装后可离线使用'; label.append(title, sub);
    const action = document.createElement('button'); action.className = 'button secondary small-button'; action.textContent = language.installed ? '已安装' : '下载'; action.disabled = language.installed || state.busy || state.modelBusy;
    action.addEventListener('click', async () => {
      state.modelBusy = true; renderModels(); renderPreview();
      try { await window.piclingo.installModel(language.code); await loadModels(); $('#model-progress').textContent = '语言包安装完成'; }
      catch (error) { $('#model-progress').textContent = error.message; }
      finally { state.modelBusy = false; renderModels(); renderPreview(); }
    });
    row.append(symbol, label, action); list.append(row);
  }
}
$('#folder-input').addEventListener('change', event => { importFiles(event.target.files); event.target.value = ''; });
$$('[data-import-folder]').forEach(button => button.addEventListener('click', () => $('#folder-input').click()));
$('#stop-button').addEventListener('click', () => { state.cancelled = true; $('#stop-button').disabled = true; status('正在完成当前步骤并停止，已有结果会保留。'); });
$('#export-all').addEventListener('click', async () => {
  try { const result = await window.piclingo.exportImages(state.files.filter(file => file.docId).map(file => file.docId)); if (!result.canceled) toast(`已导出 ${result.count} 张图片及文字记录`); }
  catch (error) { toast(error.message); }
});
$('#apply-edits').addEventListener('click', async () => {
  const file = selectedFile(); if (!file?.docId || state.busy) return;
  state.busy = true; renderPreview();
  try {
    const result = await window.piclingo.renderImage({ docId: file.docId, edits: file.blocks.map(block => ({ translated: block.translated, enabled: block.enabled !== false })) });
    URL.revokeObjectURL(file.translatedUrl); file.translatedUrl = result.imageUrl || URL.createObjectURL(new Blob([new Uint8Array(result.pngBytes)], { type: 'image/png' })); file.dirty = false;
    toast('译图已重新生成，可导出保存。');
  } catch (error) { toast(error.message); }
  finally { state.busy = false; renderPreview(); }
});
if (window.piclingo?.onProgress) window.piclingo.onProgress(text => { status(text); if ($('#languages-dialog').open) $('#model-progress').textContent = text; });
loadModels();
