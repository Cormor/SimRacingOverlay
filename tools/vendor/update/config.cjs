'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function plain(target) {
  const absolute = path.resolve(target);
  let component = path.parse(absolute).root;
  for (const name of absolute.slice(component.length).split(path.sep).filter(Boolean)) {
    component = path.join(component, name);
    try {
      if (fs.lstatSync(component).isSymbolicLink()) {
        throw new Error('路径不能包含符号链接或目录联接');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}

function appConfigDir(appId, {platform = process.platform, environment = process.env, home = os.homedir()} = {}) {
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(appId)) throw new Error('无效的应用配置标识');
  if (!path.isAbsolute(home)) throw new Error('无法定位用户主目录');
  if (platform === 'win32') return path.join(home, '.lixing', appId);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Lixing', appId);
  const config = environment.XDG_CONFIG_HOME;
  return path.join(config && path.isAbsolute(config) ? config : path.join(home, '.config'), 'Lixing', appId);
}

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('无效的配置迁移相对路径');
  }
  return plain(path.join(root, relative));
}

function stageCopy(source, destination, excluded) {
  const status = fs.lstatSync(source);
  if (status.isFile()) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return;
  }
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('配置迁移只接受普通文件和目录');
  fs.mkdirSync(destination);
  for (const entry of fs.readdirSync(source)) {
    if (!excluded.has(entry)) {
      stageCopy(plain(path.join(source, entry)), path.join(destination, entry), excluded);
    }
  }
}

function migrateConfigFiles({appId, legacyRoot, files, options}) {
  if (!path.isAbsolute(legacyRoot)) throw new Error('旧配置路径必须为绝对路径');
  const root = plain(appConfigDir(appId, options));
  for (const value of files) {
    const item = typeof value === 'string' ? {source: value, destination: value} : value;
    const source = inside(legacyRoot, item.source);
    const destination = inside(root, item.destination ?? item.source);
    if (fs.existsSync(destination) || !fs.existsSync(source)) continue;
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, {recursive: true});
    const transaction = fs.mkdtempSync(path.join(parent, '.migration-'));
    const staged = path.join(transaction, 'data');
    try {
      stageCopy(source, staged, new Set(item.exclude ?? []));
      plain(destination);
      if (fs.lstatSync(staged).isDirectory()) {
        if (!fs.existsSync(destination)) fs.renameSync(staged, destination);
      } else {
        fs.linkSync(staged, destination);
      }
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !fs.existsSync(destination)) throw error;
    } finally {
      fs.rmSync(transaction, {recursive: true, force: true});
    }
  }
  return root;
}

module.exports = {appConfigDir, migrateConfigFiles, plain};
