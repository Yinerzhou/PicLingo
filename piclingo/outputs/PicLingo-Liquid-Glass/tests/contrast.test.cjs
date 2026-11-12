'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lum = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
function contrast(a, b) { const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y); return (hi + .05) / (lo + .05); }
function veil(rgb, alpha) { return rgb.map(n => Math.floor(255 * alpha + n * (1 - alpha))); }
test('all text remains AA even on pure black at the minimum allowed veil', () => {
  const background = veil([0, 0, 0], .70);
  assert.ok(contrast([68, 68, 74], background) >= 4.5);
  assert.ok(contrast([29, 29, 31], background) >= 4.5);
  assert.ok(contrast([255, 255, 255], [40, 102, 202]) >= 4.5);
  assert.ok(contrast([33, 87, 184], background) >= 3);
});
test('light, dark and busy presets keep dark text readable', () => {
  for (const [alpha, wallpaper] of [[.70, [242, 245, 248]], [.82, [16, 18, 26]], [.88, [0, 0, 0]]]) assert.ok(contrast([68, 68, 74], veil(wallpaper, alpha)) >= 4.5);
});
module.exports = { contrast, veil };
