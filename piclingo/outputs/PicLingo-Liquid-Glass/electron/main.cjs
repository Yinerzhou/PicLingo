'use strict';
const { app, BrowserWindow, ipcMain, nativeTheme, dialog, protocol, shell } = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { chooseMaterial, windowOptions } = require('./material.cjs');
const { Backend } = require('./backend.cjs');
const { PsdController } = require('../modules/psd-export/electron.cjs');
const { Updates } = require('../modules/psd-export/packaging/updates.cjs');

const uiRoot = path.resolve(__dirname, '..');
const entryUrl = pathToFileURL(path.join(uiRoot, 'index.html')).href;
const testing = !app.isPackaged || fs.existsSync(path.join(process.resourcesPath, 'piclingo-test-build.json'));
const appSmokePath = testing && process.argv.find(arg => arg.startsWith('--app-smoke='))?.slice('--app-smoke='.length);
const psdSmokeInput = testing && process.argv.find(arg => arg.startsWith('--psd-smoke='))?.slice('--psd-smoke='.length);
const psdScenario = psdSmokeInput ? JSON.parse(fs.readFileSync(psdSmokeInput, 'utf8').replace(/^\uFEFF/, '')) : null;
const smokePath = appSmokePath || psdScenario?.result || (testing && process.argv.find(arg => arg.startsWith('--glass-smoke='))?.slice('--glass-smoke='.length));
let win;
let enabled = true;
let appearance;
let backend;
let psd;
let updates;
let quitting = false;
protocol.registerSchemesAsPrivileged([{ scheme: 'piclingo-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function rendererResult(result) {
  const { pngBytes, ...metadata } = result;
  return { ...metadata, imageUrl: `piclingo-media://result/${result.docId}?v=${Date.now()}` };
}
if (smokePath) app.setPath('userData', path.join(path.dirname(path.resolve(smokePath)), 'electron-test-profile'));
function getBackend() {
  if (!backend) {
    const workerName = process.platform === 'win32' ? 'PicLingoWorker.exe' : 'PicLingoWorker';
    const packaged = path.join(process.resourcesPath, 'backend', workerName);
    const workerPath = app.isPackaged ? packaged : path.resolve(uiRoot, '../../work/worker-dist/PicLingoWorker', workerName);
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    backend = new Backend({ workerPath, tempRoot: app.getPath('temp'), logFile: path.join(app.getPath('userData'), 'worker.log'), env: process.platform === 'darwin' ? { LOCALAPPDATA: app.getPath('appData') } : {}, onProgress: text => { if (win && !win.isDestroyed()) win.webContents.send('piclingo:progress', text); } });
  }
  return backend;
}

function getPsd() {
  if (!psd) psd = new PsdController({
    moduleRoot: app.isPackaged ? path.join(process.resourcesPath, 'psd') : path.resolve(uiRoot, '../../modules/psd-export'),
    stateRoot: path.join(app.getPath('userData'), 'psd'), packaged: app.isPackaged,
    send: value => { if (win && !win.isDestroyed()) win.webContents.send('psd:progress', value); }
  });
  return psd;
}
function getUpdates() {
  if (!updates) {
    let policy = {};
    try { policy = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'update-policy.json'), 'utf8')); } catch {}
    updates = new Updates({ directory: path.join(app.getPath('userData'), 'updates'), version: app.getVersion(), policy, packaged: app.isPackaged,
      send: value => { if (win && !win.isDestroyed()) win.webContents.send('release:state', value); },
      busy: () => Boolean(backend?.busy || psd?.busy),
      dispose: async () => { await Promise.all([backend?.dispose(), psd?.dispose()]); backend = null; psd = null; }
    });
  }
  return updates;
}

function systemTransparencyEnabled() {
  if (typeof nativeTheme.prefersReducedTransparency === 'boolean' && nativeTheme.prefersReducedTransparency) return false;
  if (process.platform !== 'win32') return true;
  // Read one system preference only; never alter the user's registry or wallpaper.
  const result = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'], { encoding: 'utf8', windowsHide: true, timeout: 2000 });
  const value = result.stdout?.match(/EnableTransparency\s+REG_DWORD\s+(0x[\da-f]+)/i)?.[1];
  return value ? Number.parseInt(value, 16) !== 0 : true;
}
function desiredAppearance() {
  return chooseMaterial({ platform: process.platform, release: os.release(), transparency: systemTransparencyEnabled(), highContrast: nativeTheme.shouldUseHighContrastColors, enabled });
}
function applyAppearance() {
  appearance = desiredAppearance();
  try {
    if (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621) win.setBackgroundMaterial(appearance.mode === 'acrylic' ? 'acrylic' : 'none');
    if (process.platform === 'darwin') win.setVibrancy(appearance.mode === 'vibrancy' ? 'under-window' : null);
    win.setBackgroundColor('#00000000');
  } catch (error) {
    appearance = { ...appearance, mode: 'fallback', reason: 'native-material-failed', error: error.message };
    if (process.platform === 'win32') { try { win.setBackgroundMaterial('none'); } catch {} }
    if (process.platform === 'darwin') { try { win.setVibrancy(null); } catch {} }
  }
  appearance = { ...appearance, highContrast: nativeTheme.shouldUseHighContrastColors, enabled };
  if (!win.webContents.isLoading()) win.webContents.send('piclingo:appearance-changed', appearance);
  return appearance;
}
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== entryUrl) throw new Error('Untrusted window request');
}
function registerIpc() {
  const handle = (name, handler) => ipcMain.handle(name, (event, ...args) => { trusted(event); return handler(...args); });
  handle('psd:choose-files', async () => (psdScenario ? psdScenario.files : (await dialog.showOpenDialog(win, { title: '选择 PSD', filters: [{ name: 'Photoshop', extensions: ['psd'] }], properties: ['openFile', 'multiSelections'] })).filePaths).map(file => getPsd().authorize(file, 'psd')));
  handle('psd:choose-excel', async () => { const file = psdScenario ? psdScenario.excel : (await dialog.showOpenDialog(win, { title: '导入 Excel', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] })).filePaths[0]; return file ? getPsd().authorize(file, 'xlsx') : null; });
  handle('psd:choose-output', async () => { const folder = psdScenario ? psdScenario.output : (await dialog.showOpenDialog(win, { title: '保存位置', properties: ['openDirectory', 'createDirectory'] })).filePaths[0]; if (!folder) return null; if (psdScenario) fs.mkdirSync(folder, { recursive: true }); return getPsd().authorize(folder, 'directory'); });
  ipcMain.on('psd:authorize-drop', (event, file) => { try { trusted(event); event.returnValue = { path: getPsd().authorize(file, 'psd') }; } catch (error) { event.returnValue = { error: error.message }; } });
  handle('psd:run', request => { if (updates?.installing) throw new Error('正在准备安装更新'); return getPsd().run(request); });
  handle('psd:stop', () => getPsd().stop());
  handle('psd:open-output', async () => { if (getPsd().lastOutput) { const error = await shell.openPath(getPsd().lastOutput); if (error) throw new Error(error); } });
  handle('psd:open-logs', async () => { const error = await shell.openPath(getPsd().stateRoot); if (error) throw new Error(error); });
  handle('psd:export-logs', async () => {
    const result = await dialog.showSaveDialog(win, { title: '导出诊断日志', defaultPath: 'PicLingo-日志.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    return getPsd().exportLogs(result.filePath);
  });
  handle('release:settings', () => getUpdates().settings());
  handle('release:configure', (repository, automatic) => getUpdates().configure(repository, automatic));
  handle('release:check', () => getUpdates().check());
  handle('release:install', () => getUpdates().install());
  handle('release:defer', () => getUpdates().defer());
  handle('release:state', () => getUpdates().state);
  handle('piclingo:window-minimize', () => win.minimize());
  handle('piclingo:window-maximize', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
  handle('piclingo:window-close', () => { setImmediate(() => win.close()); });
  handle('piclingo:window-is-maximized', () => win.isMaximized());
  handle('piclingo:appearance-get', () => applyAppearance());
  handle('piclingo:appearance-set', mode => {
    if (!['transparent', 'fallback'].includes(mode)) throw new Error('Invalid background mode');
    enabled = mode === 'transparent';
    return applyAppearance();
  });
  handle('piclingo:translate', async request => { if (updates?.installing) throw new Error('正在准备安装更新'); return rendererResult(await getBackend().translate(request)); });
  handle('piclingo:render', async request => { if (updates?.installing) throw new Error('正在准备安装更新'); return rendererResult(await getBackend().render(request)); });
  handle('piclingo:models', () => getBackend().models());
  handle('piclingo:install-model', target => { if (updates?.installing) throw new Error('正在准备安装更新'); return getBackend().install(target); });
  handle('piclingo:release', ids => getBackend().release(ids));
  handle('piclingo:save-image', async id => {
    const record = getBackend().record(id);
    const name = path.parse(record.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'image';
    const result = await dialog.showSaveDialog(win, { title: '保存翻译图片', defaultPath: path.join(app.getPath('pictures'), `${name}_${record.target}.png`), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.copyFile(record.path, result.filePath);
    return { canceled: false, path: result.filePath };
  });
  handle('piclingo:export-images', async ids => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error('请选择已翻译的图片');
    ids.forEach(id => getBackend().record(id));
    const result = await dialog.showOpenDialog(win, { title: '选择批量导出文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return { canceled: true };
    const files = await getBackend().exportDirectory(ids, result.filePaths[0]);
    return { canceled: false, count: files.length, folder: result.filePaths[0] };
  });
}

async function createWindow() {
  appearance = desiredAppearance();
  const options = windowOptions({ appearance, preload: path.join(__dirname, 'preload.cjs'), icon: path.join(uiRoot, 'assets/app.ico'), smoke: Boolean(smokePath) });
  options.webPreferences.devTools = testing && !smokePath;
  try { win = new BrowserWindow(options); }
  catch (error) {
    appearance = { ...appearance, mode: 'fallback', reason: 'window-material-failed', error: error.message };
    delete options.backgroundMaterial; delete options.vibrancy; delete options.visualEffectState;
    options.webPreferences.additionalArguments = ['--piclingo-material=fallback'];
    win = new BrowserWindow(options);
  }
  win.setMenuBarVisibility(false);
  applyAppearance();
  const publishMaximized = () => win.webContents.send('piclingo:window-maximized', win.isMaximized());
  win.on('maximize', publishMaximized);
  win.on('unmaximize', publishMaximized);
  let closeConfirmed = false;
  win.on('close', async event => {
    if (closeConfirmed || (!backend?.busy && !psd?.busy)) return;
    event.preventDefault();
    const answer = await dialog.showMessageBox(win, { type: 'question', title: '仍有任务正在处理', message: '退出会停止当前任务，确定退出吗？', buttons: ['继续处理', '停止并退出'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1 && win) { closeConfirmed = true; win.close(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== entryUrl) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) applyAppearance(); });
  win.on('closed', () => { win = null; });
  await win.loadFile(path.join(uiRoot, 'index.html'));
  if (process.platform === 'darwin') win.setWindowButtonVisibility(true);
  if (psdScenario) {
    const { runPsdSmoke } = require('../modules/psd-export/packaging/smoke.cjs');
    await runPsdSmoke(win, psdScenario);
    win.destroy(); app.quit(); return;
  }
  if (smokePath) {
    let workflow = null;
    if (appSmokePath) {
      const bytes = fs.readFileSync(path.join(uiRoot, 'assets/qa-zh.png')).toString('base64');
      await win.webContents.executeJavaScript(`(() => { const d=new DataTransfer(); d.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'安装测试.png',{type:'image/png'})); const i=document.getElementById('file-input');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('preview-button').click(); })()`);
      const deadline = Date.now() + 120000;
      let status;
      do { await new Promise(resolve => setTimeout(resolve, 250)); status = await win.webContents.executeJavaScript(`document.getElementById('app-status').textContent`); } while (!status.includes('处理完成') && Date.now() < deadline);
      if (!status.includes('成功 1')) throw new Error('安装后真实界面翻译失败：' + status);
      const decodedWidth = await win.webContents.executeJavaScript(`document.getElementById('translated-image').decode().then(() => document.getElementById('translated-image').naturalWidth)`);
      if (decodedWidth !== 1000) throw new Error('译图未能在客户端中显示');
      const docIds = [...getBackend().documents.keys()];
      const id = docIds[0], record = getBackend().record(id), before = fs.readFileSync(record.path);
      if (!record.blocks.some(block => /Welcome/.test(block.translated))) throw new Error('未识别到预期英文翻译');
      await win.webContents.executeJavaScript(`(() => {const e=document.querySelector('.translation-table textarea');e.value='Hello from PicLingo.';e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('apply-edits').click();})()`);
      const editDeadline = Date.now() + 30000;
      let edited;
      do { await new Promise(resolve => setTimeout(resolve, 200)); edited = record.blocks[0]?.translated; } while (edited !== 'Hello from PicLingo.' && Date.now() < editDeadline);
      if (edited !== 'Hello from PicLingo.' || before.equals(fs.readFileSync(record.path))) throw new Error('安装后译文重绘失败');
      const exportFolder = path.join(path.dirname(path.resolve(smokePath)), 'exports'); fs.mkdirSync(exportFolder, { recursive: true });
      const first = await getBackend().exportDirectory(docIds, exportFolder), second = await getBackend().exportDirectory(docIds, exportFolder);
      if (first[0] === second[0]) throw new Error('导出覆盖检查失败');
      workflow = { status, translation: record.blocks, editedImageChanged: true, exported: [first, second], modelCount: (await getBackend().models()).languages.length };
      await new Promise(resolve => setTimeout(resolve, 300));
      fs.writeFileSync(path.join(path.dirname(path.resolve(smokePath)), 'app-preview.png'), (await win.webContents.capturePage()).toPNG());
    }
    await new Promise(resolve => setTimeout(resolve, 400));
    const renderer = await win.webContents.executeJavaScript(`(() => ({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,root:getComputedStyle(document.querySelector('.app-window')).backgroundColor,veil:getComputedStyle(document.documentElement).getPropertyValue('--window-veil-opacity'),material:document.documentElement.dataset.nativeMaterial,wallpaperCount:document.querySelectorAll('.wallpaper').length,controls:document.querySelectorAll('[data-window-action]').length,bridge:!!window.piclingo}))()`);
    let dwm = null;
    if (process.platform === 'win32') {
      const buffer = win.getNativeWindowHandle();
      const hwnd = buffer.length === 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
      const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(uiRoot, 'tests/inspect-dwm.ps1'), '-HandleValue', hwnd], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      try { dwm = JSON.parse(probe.stdout.trim()); } catch { dwm = { error: probe.stderr || 'DWM query unavailable' }; }
    }
    fs.mkdirSync(path.dirname(path.resolve(smokePath)), { recursive: true });
    fs.writeFileSync(smokePath, JSON.stringify({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, os: os.release(), appearance, renderer, dwm, workflow, visible: win.isVisible(), note: 'Native hidden-window test; no screenshot of desktop or wallpaper modification.' }, null, 2));
    win.destroy(); app.quit(); return;
  }
  win.show(); getUpdates().start();
}
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('PicLingo.Desktop');
  nativeTheme.themeSource = 'light';
  protocol.handle('piclingo-media', async request => {
    try {
      const url = new URL(request.url), id = url.pathname.slice(1);
      if (url.hostname !== 'result' || !/^[a-f0-9]{32}$/.test(id)) return new Response('Not found', { status: 404 });
      const record = getBackend().record(id);
      return new Response(await fs.promises.readFile(record.path), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  registerIpc(); return createWindow();
}).catch(async error => { console.error(error); if (backend) await backend.dispose().catch(() => {}); if (psd) await psd.dispose().catch(() => {}); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => { updates?.stop(); if ((!backend && !psd) || quitting) return; event.preventDefault(); quitting = true; Promise.all([backend?.dispose(), psd?.dispose()]).catch(() => {}).finally(() => app.quit()); });

