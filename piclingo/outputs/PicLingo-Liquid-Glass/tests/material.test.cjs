'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseMaterial, windowOptions } = require('../electron/material.cjs');
test('Win11 22H2+ uses actual Acrylic, Win10 and original Win11 fall back', () => {
  assert.equal(chooseMaterial({ platform: 'win32', release: '10.0.22621' }).mode, 'acrylic');
  assert.equal(chooseMaterial({ platform: 'win32', release: '10.0.26200' }).mode, 'acrylic');
  assert.equal(chooseMaterial({ platform: 'win32', release: '10.0.22000' }).mode, 'fallback');
  assert.equal(chooseMaterial({ platform: 'win32', release: '10.0.19045' }).mode, 'fallback');
  assert.equal(chooseMaterial({ platform: 'win32', release: 'unknown' }).mode, 'fallback');
});
test('system accessibility and user choices override material support', () => {
  const base = { platform: 'win32', release: '10.0.26200' };
  for (const flag of [{ highContrast: true }, { transparency: false }, { enabled: false }]) assert.equal(chooseMaterial({ ...base, ...flag }).mode, 'fallback');
});
test('macOS chooses vibrancy without using a Windows-only material', () => {
  const appearance = chooseMaterial({ platform: 'darwin', release: '25.0.0' });
  const options = windowOptions({ appearance, preload: '/preload.cjs', icon: '/icon.png' });
  assert.equal(options.vibrancy, 'under-window');
  assert.equal(options.backgroundMaterial, undefined);
});
test('window is transparent and frameless while renderer is isolated', () => {
  const options = windowOptions({ appearance: { mode: 'acrylic' }, preload: '/preload.cjs', icon: '/icon.png' });
  assert.equal(options.frame, false); assert.equal(options.transparent, true);
  assert.equal(options.backgroundColor, '#00000000'); assert.equal(options.backgroundMaterial, 'acrylic');
  assert.equal(options.webPreferences.contextIsolation, true); assert.equal(options.webPreferences.nodeIntegration, false); assert.equal(options.webPreferences.sandbox, true);
});
