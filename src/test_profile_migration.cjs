'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepareProfile, profileDirectory} = require('../desktop-config.cjs');

const application = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sro-profile-'));
const keys = ['USERPROFILE', 'HOME', 'XDG_CONFIG_HOME'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.XDG_CONFIG_HOME = path.join(sandbox, 'config');

function put(root, relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, contents);
}

try {
  const profile = profileDirectory();
  assert.ok(profile.startsWith(sandbox + path.sep));
  if (process.platform === 'win32') {
    assert.equal(profile, path.join(sandbox, '.lixing', 'SimRacingOverlay'));
  }
  const old = path.join(sandbox, 'Previous installation');
  const alternate = path.join(sandbox, 'Explicit source');
  const preserved = {
    'settings.json': '{"httpPort":18767}',
    'assets/layout.json': '{"stage":{"marker":"old layout"}}',
    'assets/wheel-packs/face.json': 'wheel',
    'assets/modules/generation/algorithm.js': 'algorithm',
    'assets/components/generation/plugin.js': 'component',
    'runtime/desktop.json': '{"monitor":2}',
    'runtime/desktop-profile/Preferences': 'profile',
    'runtime/integration.json': '{"obsConfig":"selected"}',
    'runtime/autostart.paused': '{"paused":true}',
  };
  for (const [file, contents] of Object.entries(preserved)) put(old, file, contents);
  put(old, 'runtime/desktop-profile/GPUCache/entry', 'cache');
  put(old, 'runtime/desktop-status.json', 'process state');
  put(old, 'assets/support/alipay-code.png', 'bundled asset');
  put(alternate, 'settings.json', '{"httpPort":18768}');
  put(profile, 'assets/layout.json', '{"stage":{"marker":"current layout"}}');
  assert.equal(prepareProfile(application, [old, alternate]), profile);

  for (const [file, contents] of Object.entries(preserved)) {
    const actual = file === 'assets/layout.json' ? '{"stage":{"marker":"current layout"}}' : contents;
    assert.equal(fs.readFileSync(path.join(profile, file), 'utf8'), actual, file);
    assert.equal(fs.readFileSync(path.join(old, file), 'utf8'), contents, 'old: ' + file);
  }
  for (const file of ['runtime/desktop-status.json', 'runtime/desktop-profile/GPUCache', 'assets/support']) {
    assert.ok(!fs.existsSync(path.join(profile, file)), file);
  }
  fs.unlinkSync(path.join(profile, 'runtime/autostart.paused'));
  put(profile, 'settings.json', '{"httpPort":18769}');
  prepareProfile(application, [old, alternate]);
  assert.ok(!fs.existsSync(path.join(profile, 'runtime/autostart.paused')));
  assert.equal(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'), '{"httpPort":18769}');

  const fresh = path.join(sandbox, 'Fresh user');
  process.env.USERPROFILE = fresh;
  process.env.HOME = fresh;
  process.env.XDG_CONFIG_HOME = path.join(fresh, 'config');
  const seeded = prepareProfile(application, [path.join(sandbox, 'No prior installation')]);
  for (const [destination, source] of [
    ['settings.json', 'settings.json'], ['runtime/desktop.json', 'desktop.json'],
    ['assets/layout.json', 'layout.json'],
  ]) {
    assert.deepEqual(fs.readFileSync(path.join(seeded, destination)),
      fs.readFileSync(path.join(application, 'defaults', source)));
  }
  console.log('SRO migration: user files, conflicts, legacy retention, pause removal and fresh defaults passed.');
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  fs.rmSync(sandbox, {force: true, recursive: true});
}
