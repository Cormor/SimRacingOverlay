'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {MANIFEST, validateManifest} = require('./lixing-update.cjs');

async function describe(directory, {kind, file, hotfixKind, baseVersion, moduleVersion}) {
  const source = path.resolve(directory, file);
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error('Asset is not a regular file: ' + source);
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of fs.createReadStream(source)) {
    hash.update(bytes);
    size += bytes.length;
  }
  if (stat.size !== size || fs.statSync(source).mtimeMs !== stat.mtimeMs) {
    throw new Error('Asset changed while generating its manifest: ' + source);
  }
  return {
    kind, name: path.basename(source), size, sha256: hash.digest('hex'),
    ...(kind === 'hotfix' ? {hotfixKind, baseVersion, moduleVersion} : {})
  };
}

async function main() {
  const [, , configFlag, configFile, outputFlag, outputFile] = process.argv;
  if (configFlag !== '--config' || outputFlag !== '--output' || process.argv.length !== 6
      || path.basename(outputFile) !== MANIFEST) {
    throw new Error('Usage: build-manifest.cjs --config <release-build-input.json> --output <lixing-update-manifest.json>');
  }
  const input = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const {appId, repo, version, platform, arch, channel, artifacts, releaseNotes} = input;
  const directory = path.dirname(path.resolve(configFile));
  const entries = await Promise.all(artifacts.map(item => describe(directory, item)));
  const manifest = validateManifest({schema: 2, appId, repo, version, platform, arch, channel, artifacts: entries, releaseNotes});
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (bytes.length > 262144) throw new Error('The update manifest exceeds 256 KiB.');
  fs.writeFileSync(outputFile, bytes, {flag: 'wx'});
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
