'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { windowOptions } = require('../../../outputs/PicLingo-Liquid-Glass/electron/material.cjs');
test('Mac 原生标题栏按钮、Windows 自绘按钮分别配置', () => {
  const mac = windowOptions({ appearance: { mode: 'vibrancy' }, platform: 'darwin' });
  assert.equal(mac.titleBarStyle, 'hidden');
  assert.deepEqual(mac.trafficLightPosition, { x: 16, y: 14 });
  assert.equal(mac.vibrancy, 'under-window');
  const windows = windowOptions({ appearance: { mode: 'acrylic' }, platform: 'win32' });
  assert.equal(windows.frame, false); assert.equal(windows.titleBarStyle, undefined);
});
test('蒙层默认94，原滑块范围保留', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../../outputs/PicLingo-Liquid-Glass/index.html'), 'utf8');
  assert.match(html, /id="veil-range"[^>]*min="70" max="94" value="94"/);
});
