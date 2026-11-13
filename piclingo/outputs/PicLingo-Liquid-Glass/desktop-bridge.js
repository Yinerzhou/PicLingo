'use strict';

// Expose named native operations from the host, never a generic IPC sender.
const nativeWindow = window.__TAURI__?.window?.getCurrentWindow?.();
const electronWindow = window.piclingo;
const windowApi = nativeWindow || electronWindow;
const notifyWindow = message => window.dispatchEvent(new CustomEvent('piclingo:notice', { detail: { message } }));
const materialNames = { acrylic: 'Windows Acrylic · 桌面实时模糊', vibrancy: 'macOS Vibrancy · 系统毛玻璃', fallback: '兼容背景 · 半透明浅色渐变' };
function applyAppearance(appearance) {
  const mode = ['acrylic', 'vibrancy'].includes(appearance?.mode) ? appearance.mode : 'fallback';
  document.documentElement.dataset.nativeMaterial = mode;
  document.documentElement.dataset.highContrast = String(Boolean(appearance?.highContrast));
  document.getElementById('transparent-switch').checked = mode !== 'fallback';
  document.getElementById('material-description').textContent = materialNames[mode];
  const reasons = { 'transparency-disabled': '系统透明效果已关闭；启用后可使用系统材质。', 'high-contrast': '高对比度模式下，已自动增强背景与文字对比。', 'user-disabled': '系统透明材质已关闭，正在使用兼容背景。', 'windows-build-unsupported': '当前 Windows 版本使用半透明兼容背景。', 'native-material-failed': '系统材质未能启用，已自动切换兼容背景。' };
  document.getElementById('material-status').textContent = mode === 'fallback' ? (reasons[appearance?.reason] || '当前使用兼容背景。') : '由系统合成桌面背景；前端不绘制壁纸。';
  if (appearance?.highContrast) setVeil(94);
  document.getElementById('veil-range').disabled = Boolean(appearance?.highContrast);
}
function setVeil(percent) {
  const value = Math.min(94, Math.max(70, Number(percent) || 94));
  document.documentElement.style.setProperty('--window-veil-opacity', String(value / 100));
  document.getElementById('veil-range').value = value;
  document.getElementById('veil-output').value = `${value}%`;
}
applyAppearance(electronWindow?.appearance);
if (typeof electronWindow?.getAppearance === 'function') electronWindow.getAppearance().then(applyAppearance).catch(() => applyAppearance({ mode: 'fallback' }));
document.querySelector('[data-open="settings-dialog"]').addEventListener('click', () => {
  if (typeof electronWindow?.getAppearance === 'function') electronWindow.getAppearance().then(applyAppearance).catch(() => {});
});
if (typeof electronWindow?.onAppearanceChanged === 'function') {
  const unsubscribe = electronWindow.onAppearanceChanged(applyAppearance);
  if (typeof unsubscribe === 'function') window.addEventListener('beforeunload', unsubscribe, { once: true });
}
document.getElementById('veil-range').addEventListener('input', event => setVeil(event.target.value));
document.querySelectorAll('[data-readability]').forEach(button => button.addEventListener('click', () => setVeil({ light: 70, dark: 82, busy: 88 }[button.dataset.readability])));
function showMaximized(maximized) {
  const button = document.getElementById('maximize-button');
  button.setAttribute('aria-label', maximized ? '还原窗口' : '最大化'); button.title = maximized ? '还原' : '最大化';
  const icon = document.getElementById('maximize-icon'); icon.replaceChildren();
  const shape = document.createElementNS('http://www.w3.org/2000/svg', maximized ? 'path' : 'rect');
  if (maximized) shape.setAttribute('d', 'M9 8V5h10v10h-3M5 9h10v10H5Z');
  else { shape.setAttribute('x', '6'); shape.setAttribute('y', '6'); shape.setAttribute('width', '12'); shape.setAttribute('height', '12'); shape.setAttribute('rx', '.5'); }
  icon.append(shape);
}
async function refreshMaximized() { if (typeof windowApi?.isMaximized === 'function') showMaximized(await windowApi.isMaximized()); }
async function windowAction(action) {
  try {
    if (typeof windowApi?.[action] !== 'function') { notifyWindow('窗口操作需要在桌面客户端中使用。'); return; }
    await windowApi[action](); if (action === 'toggleMaximize') await refreshMaximized();
  } catch { notifyWindow('窗口操作未完成，请重试。'); }
}
document.querySelectorAll('[data-window-action]').forEach(button => button.addEventListener('click', () => windowAction(button.dataset.windowAction)));
document.querySelector('.window-chrome').addEventListener('dblclick', event => { if (!event.target.closest('button, a, input, select')) windowAction('toggleMaximize'); });
if (nativeWindow) {
  document.querySelector('.window-chrome').addEventListener('mousedown', event => { if (event.button === 0 && event.detail === 1 && !event.target.closest('.window-controls')) nativeWindow.startDragging().catch(() => {}); });
  nativeWindow.onResized(() => refreshMaximized().catch(() => {})).then(unlisten => window.addEventListener('beforeunload', unlisten, { once: true })).catch(() => {});
} else if (typeof electronWindow?.onMaximizedChanged === 'function') {
  const unsubscribe = electronWindow.onMaximizedChanged(showMaximized);
  if (typeof unsubscribe === 'function') window.addEventListener('beforeunload', unsubscribe, { once: true });
}
refreshMaximized().catch(() => {});
const transparentSwitch = document.getElementById('transparent-switch');
transparentSwitch.disabled = typeof electronWindow?.setBackgroundMode !== 'function';
transparentSwitch.addEventListener('change', async () => {
  const mode = transparentSwitch.checked ? 'transparent' : 'fallback';
  const previous = document.documentElement.dataset.nativeMaterial; transparentSwitch.disabled = true;
  try {
    const appearance = await electronWindow.setBackgroundMode(mode);
    applyAppearance(appearance);
  } catch { transparentSwitch.checked = previous !== 'fallback'; notifyWindow('当前窗口环境未能切换背景模式。'); }
  finally { transparentSwitch.disabled = false; }
});

// 首次初始化使用最高默认值，滑块仍可在原范围内手动调整。
setVeil(94);
