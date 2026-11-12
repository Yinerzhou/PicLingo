'use strict';
// 新页面在独立作用域中运行，保持原图片翻译页面的事件与状态。
(() => {
  const api = window.piclingo;
  const $ = id => document.getElementById(id);
  const state = { files: [], excel: null, book: null, preview: null, manual: {}, output: null, busy: false, report: null, dirty: true };
  const original = document.querySelector('.main-content');
  const page = $('psd-page');
  const nav = $('psd-nav');
  const imageNav = $('workspace-nav');
  const sidebarItems = [...document.querySelectorAll('.sidebar-section-title, #file-list, .add-more, .drop-hint')];
  const defaultFonts = { ja: ['YuGothic-Regular', 'YuGothic', 'HiraginoSans-W3', 'NotoSansCJKjp-Regular'], ko: ['MalgunGothic', 'AppleSDGothicNeo-Regular'], 'zh-CN': ['MicrosoftYaHei', 'PingFangSC-Regular'], th: ['Tahoma', 'Thonburi'], ar: ['ArialMT', 'Tahoma', 'GeezaPro'], he: ['ArialMT', 'Tahoma', 'ArialHebrew'] };
  $('psd-fonts').value = JSON.stringify(defaultFonts, null, 2);

  function show(psd) {
    original.hidden = psd; page.hidden = !psd;
    nav.classList.toggle('active', psd); imageNav.classList.toggle('active', !psd);
    nav.setAttribute('aria-current', psd ? 'page' : 'false'); imageNav.setAttribute('aria-current', psd ? 'false' : 'page');
    sidebarItems.forEach(item => { item.hidden = psd; });
    if (psd) page.scrollTop = 0;
  }
  nav.addEventListener('click', () => show(true));
  imageNav.addEventListener('click', () => show(false));
  function status(text, error = false) { $('psd-status').textContent = text; $('psd-status').classList.toggle('psd-warning', error); }
  function settings() {
    return { match_by: $('psd-match').value, worksheet: $('psd-sheet').value || null,
      hidden_layers: $('psd-hidden').value,
      output: { format: $('psd-format').value, jpg_quality: Number($('psd-quality').value) },
      overflow: { strategy: $('psd-overflow').value, minimum_font_size: Number($('psd-min-size').value) },
      font_fallbacks: JSON.parse($('psd-fonts').value), rtl_enabled: $('psd-rtl').checked,
      photoshop: { windows_progid: $('psd-progid').value, mac_application: $('psd-mac-app').value }
    };
  }
  function ready() {
    $('psd-export').disabled = state.busy || !state.files.length || !state.excel || !state.output || !state.preview || state.dirty || !document.querySelector('#psd-languages input:checked');
    $('psd-stop').disabled = !state.busy;
    for (const id of ['psd-select', 'psd-clear', 'psd-excel-select', 'psd-sheet', 'psd-match', 'psd-preview', 'psd-output-select', 'psd-format', 'psd-naming', 'psd-overflow', 'psd-min-size', 'psd-quality', 'psd-hidden', 'psd-fonts', 'psd-rtl', 'psd-mac-app', 'psd-progid', 'psd-diagnose']) $(id).disabled = state.busy;
    document.querySelectorAll('#psd-languages input, #psd-matches select').forEach(input => { input.disabled = state.busy; });
  }
  async function action(work) {
    if (state.busy) return;
    state.busy = true; ready();
    try { await work(); }
    catch (error) { status(error.message, true); }
    finally { state.busy = false; ready(); }
  }
  function invalidate() { state.dirty = true; $('psd-match-summary').textContent = '设置已变更，请重新读取匹配'; ready(); }
  function files(values) {
    state.files = [...new Set([...state.files, ...values])];
    $('psd-files').replaceChildren();
    for (const path of state.files) { const row = document.createElement('div'); row.className = 'model-row glass'; row.textContent = path; $('psd-files').append(row); }
    invalidate();
  }
  $('psd-select').addEventListener('click', () => action(async () => { files(await api.psdChooseFiles()); }));
  $('psd-clear').addEventListener('click', () => { state.files = []; files([]); });
  for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    document.querySelector('.app-window').addEventListener(eventName, event => {
      if (page.hidden || !event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (eventName === 'drop' && !state.busy) {
        const paths = [...event.dataTransfer.files].map(file => api.pathForFile(file)).filter(path => /\.psd$/i.test(path));
        if (paths.length) files(paths); else status('请选择 PSD 文件', true);
      }
    }, true);
  }
  async function loadExcel() {
    const book = await api.psdRun({ operation: 'workbook', excel: state.excel, settings: settings() });
    state.book = book;
    const previous = $('psd-sheet').value;
    $('psd-sheet').replaceChildren();
    if (book.needs_sheet) { const option = new Option('选择工作表', ''); $('psd-sheet').append(option); }
    for (const name of book.sheets) $('psd-sheet').append(new Option(name, name));
    $('psd-sheet').value = book.worksheet || previous || '';
    $('psd-languages').replaceChildren();
    for (const [index, language] of book.languages.entries()) {
      const label = document.createElement('label'); label.className = 'psd-check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = language.code; input.checked = index === 0;
      input.addEventListener('change', ready);
      label.append(input, document.createTextNode(language.name + (language.rtl ? ' · 实验' : ''))); $('psd-languages').append(label);
    }
    $('psd-excel-warnings').textContent = book.needs_sheet ? '请选择工作表' : book.warnings.map(item => item.message + (item.row ? `（第 ${item.row} 行）` : '')).join('；');
    invalidate();
  }
  $('psd-excel-select').addEventListener('click', () => action(async () => {
    const path = await api.psdChooseExcel(); if (!path) return;
    state.excel = path; $('psd-excel-path').textContent = path; $('psd-sheet').replaceChildren(); await loadExcel();
  }));
  $('psd-sheet').addEventListener('change', () => action(loadExcel));
  $('psd-match').addEventListener('change', () => { invalidate(); if (state.excel) action(loadExcel); });
  $('psd-hidden').addEventListener('change', invalidate);
  for (const id of ['psd-format', 'psd-overflow', 'psd-min-size', 'psd-quality', 'psd-fonts', 'psd-rtl', 'psd-naming', 'psd-mac-app', 'psd-progid']) $(id).addEventListener('change', ready);
  $('psd-output-select').addEventListener('click', () => action(async () => {
    const folder = await api.psdChooseOutput(); if (folder) { state.output = folder; $('psd-output-path').textContent = folder; }
  }));
  function renderMatches() {
    const mapping = state.preview.mapping;
    const table = $('psd-matches'); table.tHead.replaceChildren(); table.tBodies[0].replaceChildren();
    const header = document.createElement('tr');
    for (const title of ['图层 / 原文', '匹配状态', ...state.book.languages.map(item => item.name)]) { const th = document.createElement('th'); th.textContent = title; header.append(th); }
    table.tHead.append(header);
    let matched = 0;
    for (const item of mapping.layers) {
      if (item.row) matched++;
      const tr = document.createElement('tr');
      const origin = document.createElement('td'); origin.textContent = `${item.layer.path}\n${item.layer.original}`;
      origin.title = `${item.file}\n字体 ${item.layer.fonts.names.join(', ')}\n字号 ${item.layer.font_size}\n组 ${item.layer.group}`;
      const stateCell = document.createElement('td');
      if ($('psd-match').value === 'manual') {
        const select = document.createElement('select'); select.className = 'psd-input'; select.append(new Option('未匹配', ''));
        for (const row of state.book.rows) select.append(new Option(`${row.row} · ${row.key || row.source}`, String(row.row)));
        select.value = item.row ? String(item.row.row) : '';
        select.addEventListener('change', () => {
          state.manual[item.file] ||= {}; state.manual[item.file][item.route] = select.value;
          item.row = state.book.rows.find(row => row.row === Number(select.value)) || null;
          renderMatches(); ready();
        });
        stateCell.append(select);
      } else { stateCell.textContent = item.row ? '✓ 已匹配' : '⚠ 未匹配'; }
      tr.append(origin, stateCell);
      for (const language of state.book.languages) { const cell = document.createElement('td'); cell.textContent = item.row?.translations[language.code] ?? '—'; tr.append(cell); }
      table.tBodies[0].append(tr);
    }
    const used = new Set(mapping.layers.filter(item => item.row).map(item => item.row.row));
    $('psd-unused').textContent = state.book.rows.filter(row => !used.has(row.row)).map(row => `第 ${row.row} 行 · ${row.key || row.source}`).join('\n') || '无';
    const failures = state.preview.documents.filter(document => !document.ok);
    $('psd-match-summary').textContent = `已匹配 ${matched} · 未匹配 ${mapping.layers.length - matched} · PSD 失败 ${failures.length}` + (failures.length ? '\n' + failures.map(file => file.name + ' · ' + file.error).join('\n') : '');
    $('psd-layer-tree').textContent = state.preview.documents.map(doc => doc.ok ? doc.name + '\n' + doc.tree.map(layer => `${layer.path} · ${layer.visible ? '可见' : '隐藏'} · ${layer.type}`).join('\n') : doc.name + ' · ' + doc.error).join('\n\n');
  }
  $('psd-preview').addEventListener('click', () => action(async () => {
    if (!state.files.length || !state.excel) throw new Error('请先选择 PSD 并导入 Excel');
    status('正在读取文字图层');
    state.preview = await api.psdRun({ operation: 'preview', files: state.files, excel: state.excel, settings: settings(), manual: state.manual });
    state.book = state.preview.book;
    if (!state.preview.mapping) throw new Error('请选择工作表');
    state.dirty = false; renderMatches(); status('匹配读取完成');
  }));
  $('psd-export').addEventListener('click', () => action(async () => {
    $('psd-progress').value = 0; $('psd-results').replaceChildren(); status('正在导出');
    const report = await api.psdRun({ operation: 'export', files: state.files, excel: state.excel, settings: settings(),
      manual: state.manual, languages: [...document.querySelectorAll('#psd-languages input:checked')].map(input => input.value),
      naming: $('psd-naming').value, output_dir: state.output });
    state.report = report;
    status(`${report.cancelled ? '已停止' : '导出完成'} · 成功 ${report.success_count} · 失败 ${report.failure_count}`, report.failure_count > 0);
    for (const result of report.results) {
      const row = document.createElement('div'); row.className = 'model-row glass';
      const warnings = result.photoshop?.layers.filter(layer => layer.overflow?.possible || ['missing_font', 'missing_glyphs', 'unknown_coverage'].includes(layer.status)) || [];
      row.classList.toggle('psd-warning', !result.ok || warnings.length > 0);
      row.textContent = `${result.ok ? '✓ 已导出' : '✕ 失败'} · ${result.language} · ${result.ok ? result.output : result.error}` + (warnings.length ? '\n' + warnings.map(layer => `${layer.path} · ${layer.overflow?.possible ? '⚠ 可能溢出' : '⚠ 字体跳过'}`).join('\n') : '');
      $('psd-results').append(row);
    }
    $('psd-open-output').disabled = false;
  }));
  $('psd-stop').addEventListener('click', async () => { await api.psdStop(); status('将在当前项完成后停止'); });
  $('psd-diagnose').addEventListener('click', () => action(async () => { await api.psdRun({ operation: 'diagnose', settings: settings() }); status('✓ Photoshop 调用通过'); }));
  $('psd-open-output').addEventListener('click', () => api.psdOpenOutput().catch(error => status(error.message, true)));
  $('psd-open-logs').addEventListener('click', () => api.psdOpenLogs().catch(error => status(error.message, true)));
  $('psd-export-logs').addEventListener('click', () => action(async () => { const result = await api.exportLogs(); if (result) status('日志已导出 · ' + result.path); }));
  api?.onPsdProgress?.(event => {
    if (event.event !== 'progress') return;
    if (event.total) { $('psd-progress').max = event.total; $('psd-progress').value = event.current; }
    status(`${event.step} ${event.current ?? ''}/${event.total ?? ''} ${event.language || ''}`);
  });
  if (api?.platform === 'darwin') {
    document.querySelector('.window-controls').hidden = true;
    document.querySelector('.window-chrome').style.paddingLeft = '88px';
  }
  ready();
})();
