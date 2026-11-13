'use strict';
const fs = require('node:fs');
const path = require('node:path');

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(label + '格式无效');
  return value;
}
function bounded(value, label, maximum = 4096) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) throw new Error(label + '无效');
  return value;
}
function inspect(value, depth = 0, budget = { bytes: 0, nodes: 0 }) {
  if (++budget.nodes > 150000 || depth > 12) throw new Error('请求结构过大');
  if (typeof value === 'string') budget.bytes += value.length * 3;
  else if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length > 10000) throw new Error('请求数组过大');
      for (const item of value) inspect(item, depth + 1, budget);
    } else {
      object(value, '请求');
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('请求字段无效');
        budget.bytes += key.length * 3;
        inspect(item, depth + 1, budget);
      }
    }
  } else if (!['undefined', 'boolean', 'number'].includes(typeof value) && value !== null) throw new Error('请求值无效');
  if (budget.bytes > 8 * 1024 * 1024) throw new Error('请求超过 8MB');
}
const settingKeys = ['worksheet','header_row','match_by','hidden_layers','smart_objects','duplicates','empty_translation','unmatched','missing_font','output','overflow','font_fallbacks','rtl_enabled','photoshop','language_aliases','language_names','font_paths','key_headers','source_headers','source_language','text_normalization'];
function settings(value = {}) {
  object(value, '设置'); inspect(value);
  for (const key of Object.keys(value)) if (!settingKeys.includes(key)) throw new Error('未知设置字段 ' + key);
  if (value.photoshop) {
    object(value.photoshop, 'Photoshop 设置');
    const ps = value.photoshop;
    if (ps.windows_progid !== undefined && !/^Photoshop\.Application(?:\.\d+)?$/i.test(ps.windows_progid)) throw new Error('Photoshop COM 名称无效');
    if (ps.mac_application !== undefined && (typeof ps.mac_application !== 'string' || !/\/Adobe Photoshop[^/]*\.app$/i.test(ps.mac_application) || !path.posix.isAbsolute(ps.mac_application))) throw new Error('Photoshop 应用路径无效');
    for (const key of ['retry_delay_seconds','probe_timeout_seconds','task_timeout_seconds']) if (ps[key] !== undefined && (!Number.isInteger(ps[key]) || ps[key] < 1 || ps[key] > 3600)) throw new Error('Photoshop 超时配置无效');
  }
  return value;
}
class FileAccess {
  constructor() { this.files = new Map(); this.directories = new Map(); }
  authorize(value, kind) {
    bounded(value, '文件路径');
    if (!path.isAbsolute(value)) throw new Error('需要绝对路径');
    const real = fs.realpathSync(value);
    const stat = fs.statSync(real);
    if (kind === 'directory') {
      if (!stat.isDirectory()) throw new Error('需要文件夹');
      this.directories.set(real, real);
    } else {
      if (!stat.isFile() || path.extname(real).toLowerCase() !== '.' + kind) throw new Error('文件类型无效');
      if (stat.size > (kind === 'xlsx' ? 50 : 4096) * 1024 * 1024) throw new Error('文件过大');
      this.files.set(real, kind);
    }
    return real;
  }
  verify(value, kind) {
    bounded(value, '文件路径');
    const collection = kind === 'directory' ? this.directories : this.files;
    if (!collection.has(value) || (kind !== 'directory' && collection.get(value) !== kind) || fs.realpathSync(value) !== value) throw new Error('文件未经选择或路径已经变化');
    const stat = fs.statSync(value);
    if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error('文件类型已经变化');
  }
}
function request(value, access, internal = false) {
  object(value, 'PSD 请求'); inspect(value);
  const operations = { workbook: ['excel'], inspect: ['files'], preview: ['files','excel','manual'], export: ['files','excel','manual','languages','naming','output_dir','expected_hashes','excel_sha256'], diagnose: [], logs: ['destination'] };
  if (!Object.hasOwn(operations, value.operation) || (value.operation === 'logs' && !internal)) throw new Error('PSD 操作未授权');
  const allowed = ['operation','settings', ...operations[value.operation]];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('未知请求字段 ' + key);
  settings(value.settings);
  if (operations[value.operation].includes('files')) {
    if (!Array.isArray(value.files) || !value.files.length || value.files.length > 1000) throw new Error('请选择 1～1000 个 PSD');
    for (const file of value.files) access.verify(file, 'psd');
  }
  if (operations[value.operation].includes('excel')) access.verify(value.excel, 'xlsx');
  if (value.operation === 'export') {
    access.verify(value.output_dir, 'directory');
    if (!Array.isArray(value.languages) || !value.languages.length || value.languages.length > 100 || value.languages.some(code => typeof code !== 'string' || !/^[a-z]{2,4}(?:-[A-Za-z0-9]{2,8})*$/.test(code))) throw new Error('输出语言无效');
    if (value.naming !== undefined) bounded(value.naming, '命名规则', 240);
  }
  if (value.manual !== undefined) {
    object(value.manual, '手动匹配');
    for (const [file, mapping] of Object.entries(value.manual)) {
      access.verify(file, 'psd'); object(mapping, '手动匹配');
      for (const [route, row] of Object.entries(mapping)) if (!/^\d+(?:\/(?:contents|\d+))*$/.test(route) || !(row === '' || (/^\d+$/.test(String(row)) && Number(row) >= 2 && Number(row) <= 1048576))) throw new Error('手动匹配无效');
    }
  }
  if (value.operation === 'logs') bounded(value.destination, '日志保存路径');
  return value;
}
module.exports = { FileAccess, request, settings, object, inspect };

