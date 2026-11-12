'use strict';

// The official DWM backdrop API starts at Windows 11 22H2, not build 22000.
function chooseMaterial({ platform, release, transparency = true, highContrast = false, enabled = true }) {
  const build = Number(String(release).split('.')[2]) || 0;
  if (!enabled || !transparency || highContrast) return { mode: 'fallback', build, reason: !enabled ? 'user-disabled' : highContrast ? 'high-contrast' : 'transparency-disabled' };
  if (platform === 'win32' && build >= 22621) return { mode: 'acrylic', build, reason: 'windows-11-22h2' };
  if (platform === 'darwin') return { mode: 'vibrancy', build: 0, reason: 'macos' };
  return { mode: 'fallback', build, reason: platform === 'win32' ? 'windows-build-unsupported' : 'platform-unsupported' };
}

function windowOptions({ appearance, preload, icon, smoke = false, platform = process.platform }) {
  return {
    width: 1360,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    show: false,
    frame: platform === 'darwin',
    ...(platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 14 } } : {}),
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: '图译工坊 PicLingo',
    icon,
    ...(appearance.mode === 'acrylic' ? { backgroundMaterial: 'acrylic' } : {}),
    ...(appearance.mode === 'vibrancy' ? { vibrancy: 'under-window', visualEffectState: 'followWindow' } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !smoke,
      backgroundThrottling: true,
      additionalArguments: [`--piclingo-material=${appearance.mode}`]
    }
  };
}
module.exports = { chooseMaterial, windowOptions };
