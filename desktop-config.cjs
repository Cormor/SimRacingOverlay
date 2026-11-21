'use strict';

const fs = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {appConfigDir, migrateConfigFiles, plain} = require('./tools/vendor/update/config.cjs');

const APP_ID = 'SimRacingOverlay';
const files = [
  'settings.json',
  'assets/layout.json',
  'assets/wheel-packs',
  'assets/modules',
  'assets/components',
  'runtime/desktop.json',
  'runtime/integration.json',
  'runtime/autostart.paused',
  {
    source: 'runtime/desktop-profile',
    destination: 'runtime/desktop-profile',
    exclude: ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache',
      'DawnWebGPUCache', 'lockfile', 'SingletonCookie', 'SingletonLock', 'SingletonSocket'],
  },
];
const defaults = [
  'settings.json',
  {source: 'desktop.json', destination: 'runtime/desktop.json'},
  {source: 'layout.json', destination: 'assets/layout.json'},
];

function profileDirectory() {
  return appConfigDir(APP_ID);
}

function prepareProfile(applicationRoot, legacyRoots) {
  const dataRoot = plain(profileDirectory());
  const migrations = plain(path.join(dataRoot, '.migration-v1'));
  fs.mkdirSync(migrations, {recursive: true});
  for (const legacyRoot of legacyRoots) {
    if (!path.isAbsolute(legacyRoot)) throw Error('Legacy configuration must have an absolute path.');
    if (!fs.existsSync(legacyRoot)) continue;
    const canonical = fs.realpathSync.native(legacyRoot);
    const key = createHash('sha256')
      .update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
    const marker = plain(path.join(migrations, key));
    if (fs.existsSync(marker)) continue;
    migrateConfigFiles({appId: APP_ID, legacyRoot: canonical, files});
    try {
      fs.writeFileSync(marker, '', {flag: 'wx'});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  migrateConfigFiles({appId: APP_ID, legacyRoot: path.join(applicationRoot, 'defaults'), files: defaults});
  for (const relative of ['assets/wheel-packs', 'runtime/desktop-profile']) {
    fs.mkdirSync(plain(path.join(dataRoot, relative)), {recursive: true});
  }
  return dataRoot;
}

if (require.main === module) {
  const [applicationRoot, ...legacyRoots] = process.argv.slice(2);
  if (!applicationRoot || !path.isAbsolute(applicationRoot) || !legacyRoots.length) {
    throw Error('The application path and at least one legacy configuration path are required.');
  }
  prepareProfile(applicationRoot, legacyRoots);
}

module.exports = {APP_ID, profileDirectory, prepareProfile};
