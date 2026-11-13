'use strict';
const path = require('node:path');
const { build } = require('electron-builder');
const root = path.resolve(__dirname, '../../..');
const version = require(path.join(root, 'outputs/PicLingo-Liquid-Glass/package.json')).version;
const signed = Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK);
build({ projectDir: __dirname, targets: require('electron-builder').Platform.WINDOWS.createTarget('nsis', require('electron-builder').Arch.x64), config: {
  appId: 'com.piclingo.desktop', productName: 'PicLingo', asar: true, forceCodeSigning: signed,
  directories: { app: path.join(root, 'outputs/PicLingo-Liquid-Glass'), output: path.join(root, `outputs/windows${process.env.PICLINGO_TEST_BUILD === '1' ? '-qa' : ''}-${version}`) },
  files: ['index.html','styles.css','app.js','desktop-bridge.js','package.json','assets/**','electron/**','modules/**','node_modules/**','tests/inspect-dwm.ps1'],
  asarUnpack: ['**/verify-signature.ps1'],
  extraResources: [
    { from: path.join(root, 'work/worker-dist/PicLingoWorker'), to: 'backend' },
    { from: path.join(__dirname, '../release/worker-dist/PicLingoPSD'), to: 'psd' },
    { from: path.join(root, 'work/licenses'), to: 'licenses' },
    { from: path.join(__dirname, 'licenses'), to: 'licenses/psd' }
  ],
  afterPack: path.join(__dirname, 'after-pack.cjs'),
  win: { icon: path.join(root, 'work/assets/app.ico'), artifactName: 'PicLingo-Setup-${version}.exe', verifyUpdateCodeSignature: true, signtoolOptions: { publisherName: process.env.PICLINGO_PUBLISHER || undefined } },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: 'PicLingo 图译工坊', menuCategory: 'PicLingo 图译工坊', deleteAppDataOnUninstall: false, runAfterFinish: false, include: path.join(__dirname, 'migration.nsh') },
  publish: [{ provider: 'generic', url: process.env.PICLINGO_UPDATE_URL || 'https://updates.example.com/piclingo/win-x64/' }],
  electronVersion: '45.3.1',
  releaseInfo: { releaseNotesFile: path.join(__dirname, 'release-notes.md') }
}, publish: 'never' }).catch(error => { console.error(error); process.exitCode = 1; });

