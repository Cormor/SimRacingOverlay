'use strict';

// The transport and release history build on SimRacingOverlay by Cormor.
// See the applicable software license in the distribution.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {execFile} = require('node:child_process');
const {appConfigDir, plain} = require('./config.cjs');

const JSON_LIMIT = 12 * 1024 * 1024;
const SETUP_LIMIT = 768 * 1024 * 1024;
const MANIFEST_LIMIT = 256 * 1024;
const MANIFEST = 'lixing-update-manifest.json';
const SIGNATURE = 'lixing-update-manifest.sig';
const CERTIFICATE_SHA256 = '18433d307b60c6962508c20e35e36206851bf69e2683a24fa43b2ec689ae69ca';
const textMatches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));

// The supplied request is Electron's system-proxy transport. Redirects are checked here.
function fetchAsset(url,{request,allowUrl,api,userAgent,limit=JSON_LIMIT,file,progress}={}){
 return new Promise((resolve,reject)=>{
  let done=false,req,res,hop=0,fd=null,bytes=0;const chunks=[],deadline=Date.now()+(file?180000:30000);
  if(file){plain(file);fs.mkdirSync(path.dirname(file),{recursive:true});fd=fs.openSync(file,'wx',0o600);}
  const hash=crypto.createHash('sha256');
  const finish=(error)=>{
   if(done)return;done=true;clearTimeout(timer);if(fd!==null){try{if(!error)fs.fsyncSync(fd);}catch(failure){error=error||failure;}finally{fs.closeSync(fd);fd=null;}}
   if(error){res?.destroy();req?.destroy();if(file)try{fs.unlinkSync(file);}catch{}reject(error);}
   else resolve({bytes:file?null:Buffer.concat(chunks,bytes),sha256:hash.digest('hex'),size:bytes,file});
  };
  const timer=setTimeout(()=>finish(Error('更新下载超时，请重试')),file?180000:30000);
  function visit(value,count){
   let u;try{u=allowUrl(value,count===0);}catch(error){finish(error);return;}
   const current=++hop,fail=error=>{if(current===hop)finish(error);};
   try{req=request(u,{headers:{'User-Agent':userAgent,'Accept':u.href===api?'application/vnd.github+json':'application/octet-stream'},timeout:Math.max(1,deadline-Date.now())},incoming=>{
    if(done||current!==hop){incoming.destroy();return;}res=incoming;res.on('error',fail);
    if([301,302,303,307,308].includes(res.statusCode)){
     if(count>=4||!res.headers.location){finish(Error('更新下载重定向无效'));return;}
     let next;try{next=allowUrl(new URL(res.headers.location,u).href).href;}catch(error){finish(error);return;}
     hop++;res.destroy();visit(next,count+1);return;
    }
    if(res.statusCode!==200){finish(Error('无法获取更新（HTTP '+res.statusCode+'）'));return;}
    const length=res.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>limit)){finish(Error('更新资产大小超出允许范围'));return;}
    res.on('data',chunk=>{if(done||current!==hop)return;try{const b=Buffer.from(chunk);bytes+=b.length;if(bytes>limit)throw Error('更新资产大小超出允许范围');hash.update(b);if(fd!==null){let offset=0;while(offset<b.length)offset+=fs.writeSync(fd,b,offset,b.length-offset);}else chunks.push(b);progress?.(bytes,length===undefined?null:Number(length));}catch(error){finish(error);}});
    res.on('end',()=>{if(done||current!==hop)return;if(length!==undefined&&bytes!==Number(length)){finish(Error('更新下载不完整'));return;}finish();});
    res.on('aborted',()=>fail(Error('更新下载中断')));
    res.on('close',()=>{if(!done&&!res.complete&&!res.readableEnded)fail(Error('更新连接已关闭'));});
   });req.on('error',fail);req.on('timeout',()=>fail(Error('更新下载超时，请重试')));}catch(error){finish(error);}
  }visit(url,0);
 });
}
function releaseHistory(input,installed,target){
 try{
  if(!Array.isArray(input))throw Error('此版本未提供跨版本更新日志');
  const seen=new Set(),entries=input.map(item=>{
   if(!item||typeof item!=='object')throw Error('更新日志格式无效');
   const key=version(item.version).join('.');
   if(seen.has(key)||compare(item.version,target)>0||typeof item.notes!=='string'||!item.notes.trim()||Buffer.byteLength(item.notes)>20000)throw Error('更新日志内容无效');
   seen.add(key);return {version:item.version,notes:item.notes};
  });
  if(compare(target,installed)>0&&!entries.some(item=>compare(item.version,target)===0))throw Error('更新日志缺少目标版本说明');
  entries.sort((a,b)=>compare(a.version,b.version));
  return {
   history:entries.filter(item=>compare(item.version,installed)>0),
   versionHistory:entries.toReversed(),
   notesStatus:'complete',notesError:null
  };
 }catch(error){return {history:[],versionHistory:[],notesStatus:'unavailable',notesError:error.message};}
}
function version(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.(?:0|[1-9]\d{0,5})){2}$/.test(value)) {
    throw new Error('版本号必须为三段数字');
  }
  return value.split('.').map(Number);
}

function compare(left, right) {
  const a = version(left);
  const b = version(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name)
    && !name.endsWith('.') && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
}

function validateManifest(input) {
  if (input?.schema !== 2
      || !textMatches(input.appId, /^[A-Za-z][A-Za-z0-9-]{0,63}$/)
      || !textMatches(input.repo, /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/)
      || !textMatches(input.platform, /^[a-z0-9-]{1,24}$/)
      || !textMatches(input.arch, /^[a-z0-9-]{1,24}$/)
      || !textMatches(input.channel, /^[a-z][a-z0-9-]{0,23}$/)) {
    throw new Error('更新清单标识无效');
  }
  version(input.version);
  if (!Array.isArray(input.artifacts) || !input.artifacts.length || input.artifacts.length > 30) {
    throw new Error('更新清单缺少有效资产');
  }
  const names = new Set();
  const kinds = new Set();
  for (const item of input.artifacts) {
    if (!textMatches(item?.kind, /^[a-z][a-z0-9-]{0,39}$/) || !validName(item.name)
        || !Number.isSafeInteger(item.size) || item.size < 1 || !textMatches(item.sha256, /^[a-f0-9]{64}$/)
        || names.has(item.name.toLowerCase()) || kinds.has(item.kind)) {
      throw new Error('更新清单资产绑定无效');
    }
    if (item.kind === 'hotfix') {
      if (!textMatches(item.hotfixKind, /^[a-z][a-z0-9-]{0,31}$/)) throw new Error('热更新类型无效');
      if (item.baseVersion !== undefined) version(item.baseVersion);
      if (item.moduleVersion !== undefined) version(item.moduleVersion);
    }
    names.add(item.name.toLowerCase());
    kinds.add(item.kind);
  }
  const history = releaseHistory(input.releaseNotes, '0.0.0', input.version);
  if (history.notesStatus !== 'complete' || !input.releaseNotes.some(item => item.version === input.version)) {
    throw new Error(history.notesError || '更新日志缺少目标版本说明');
  }
  return input;
}

function loadCertificate(certificate) {
  const cert = new crypto.X509Certificate(certificate);
  if (digest(cert.raw) !== CERTIFICATE_SHA256) throw new Error('发布证书与应用内置指纹不匹配');
  const key = cert.publicKey;
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072
      || cert.issuer !== cert.subject || !cert.verify(key)) throw new Error('发布证书信任锚无效');
  return cert;
}

function verifyManifest(bytes, signature, certificate, identity) {
  const cert = certificate instanceof crypto.X509Certificate ? certificate : loadCertificate(certificate);
  if (digest(cert.raw) !== CERTIFICATE_SHA256) throw new Error('发布证书与应用内置指纹不匹配');
  const now = Date.now();
  if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) throw new Error('发布证书已超出有效期');
  if (!crypto.verify('sha256', bytes, {key: cert.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING}, signature)) {
    throw new Error('更新清单签名校验失败');
  }
  const manifest = validateManifest(parse(bytes));
  for (const [field, expected] of Object.entries(identity)) {
    if (manifest[field] !== expected) throw new Error('签名清单与本应用或发布版本不匹配');
  }
  return manifest;
}

const windowsProxyCommand = Buffer.from(
  '$ErrorActionPreference = "Stop"; $target = [Uri]$env:LIXING_PROXY_TARGET; ' +
  '$route = [Net.WebRequest]::GetSystemWebProxy().GetProxy($target); ' +
  'if ($route -and $route -ne $target) { [Console]::Write($route.AbsoluteUri) }',
  'utf16le'
).toString('base64');

function systemProxy(url, signal) {
  const windowsRoot = process.env.SystemRoot;
  if (!windowsRoot || !path.isAbsolute(windowsRoot)) throw new Error('无法定位 Windows 系统代理入口');
  const powershell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', windowsProxyCommand], {
      env: {...process.env, LIXING_PROXY_TARGET: url.href},
      timeout: 6000,
      maxBuffer: 4096,
      windowsHide: true,
      signal
    }, (error, stdout) => {
      if (error) reject(new Error('读取 Windows 系统代理失败'));
      else resolve(stdout.trim());
    });
  });
}

function createNativeTransport(environment = process.env) {
  const configuredProxy = environment.https_proxy || environment.HTTPS_PROXY
    || environment.all_proxy || environment.ALL_PROXY;
  const noProxy = environment.no_proxy ?? environment.NO_PROXY;
  const directAgent = new https.Agent();
  let lastProxy;
  let proxyAgent;

  return (url, options, callback) => {
    const handle = new EventEmitter();
    const controller = new AbortController();
    let request;
    handle.destroy = () => {
      controller.abort();
      request?.destroy();
    };

    async function open() {
      const value = configuredProxy || (process.platform === 'win32' ? await systemProxy(url, controller.signal) : '');
      if (controller.signal.aborted) return;
      if (value && value !== lastProxy) {
        let proxy;
        try {
          proxy = new URL(value);
        } catch {
          throw new Error('更新网络代理地址无效');
        }
        if (!['http:', 'https:'].includes(proxy.protocol) || proxy.search || proxy.hash || proxy.pathname !== '/') {
          throw new Error('更新网络代理必须使用 HTTP 或 HTTPS');
        }
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < 22 || major === 22 && minor < 21 || major === 23 || major === 24 && minor < 5) {
          throw new Error('当前 Node.js 版本不支持更新代理');
        }
        // Native Agent applies NO_PROXY for the actual host on each checked redirect.
        proxyAgent = new https.Agent({proxyEnv: {HTTPS_PROXY: proxy.href, NO_PROXY: noProxy}});
        lastProxy = value;
      }
      const agent = value ? proxyAgent : directAgent;
      request = https.request(url, {...options, agent, rejectUnauthorized: true}, callback);
      request.on('error', error => handle.emit('error', error));
      request.end();
    }

    void open().catch(error => {
      if (!controller.signal.aborted) handle.emit('error', error);
    });
    return handle;
  };
}

function recordTrust(directory, release, bytes) {
  plain(directory);
  fs.mkdirSync(directory, {recursive: true});
  const entries = fs.readdirSync(directory).filter(name => /^\d{1,6}\.\d{1,6}\.\d{1,6}\.sha256$/.test(name));
  for (const name of entries) {
    if (compare(name.slice(0, -7), release) > 0) throw new Error('此签名版本早于已验证的发布版本');
  }
  const destination = plain(path.join(directory, release + '.sha256'));
  const signatureId = digest(bytes);
  const temporary = path.join(directory, crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, signatureId, {flag: 'wx', mode: 0o600, flush: true});
    try {
      fs.linkSync(temporary, destination);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (fs.readFileSync(destination, 'utf8') !== signatureId) {
        throw new Error('此版本与此前验证的清单不同，拒绝替换已发布版本');
      }
    }
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

function verifyArtifact(inputPath, spec) {
  const file = plain(inputPath);
  const descriptor = fs.openSync(file, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== spec.size) throw new Error('更新资产已变化，请重新下载');
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null))) {
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (hash.digest('hex') !== spec.sha256) throw new Error('更新资产已变化，请重新下载');
  return file;
}

function createReleaseChannel({
  appId, repo, currentVersion, platform = process.platform, arch = process.arch, channel = 'stable',
  certificate, downloadDir, request = createNativeTransport(), setupName = v => appId + '-' + v + '-x64-Setup.exe',
  hotfixKinds = [], tagPrefix = 'v', onDiscovery = () => {}
}) {
  version(currentVersion);
  const identity = {appId, repo, platform, arch, channel};
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)
      || !textMatches(platform, /^[a-z0-9-]{1,24}$/) || !textMatches(arch, /^[a-z0-9-]{1,24}$/)
      || channel !== 'stable' || !['v', ''].includes(tagPrefix)) {
    throw new Error('发布频道配置无效');
  }

  const configDir = appConfigDir(appId);
  const trust = plain(path.join(configDir, 'update-trust', platform + '-' + arch + '-' + channel));
  const root = plain(downloadDir ?? path.join(configDir, 'downloads'));
  const cert = loadCertificate(certificate);
  const api = 'https://api.github.com/repos/' + repo + '/releases/latest';
  const assetApi = 'https://api.github.com/repos/' + repo + '/releases/assets/';
  let trusted = null;
  let requestSequence = 0;

  function allowUrl(value, initial = false) {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port) {
      if (url.href === api || (url.href.startsWith(assetApi) && /^[1-9][0-9]*$/.test(url.href.slice(assetApi.length)))) {
        return url;
      }
      if (!initial && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
        return url;
      }
    }
    throw new Error('下载地址不属于配置的 GitHub Release');
  }

  function asset(release, name) {
    const matches = release.assets.filter(item => item.name === name);
    if (matches.length !== 1) throw new Error('Release 需要一个匹配资产：' + name);
    const candidate = matches[0];
    const expected = 'https://github.com/' + repo + '/releases/download/' + release.tag_name + '/' + encodeURIComponent(name);
    if (candidate.browser_download_url !== expected || !Number.isSafeInteger(candidate.id) || candidate.id < 1) {
      throw new Error('更新资产不属于此 Release');
    }
    if (!Number.isSafeInteger(candidate.size) || candidate.size < 1) throw new Error('Release 资产大小无效');
    return {url: assetApi + candidate.id, size: candidate.size};
  }

  const fetch = (url, opts) => fetchAsset(url, {request, allowUrl, api, userAgent: appId + '-updater', ...opts});

  async function discover(officialVersion = currentVersion) {
    version(officialVersion);
    trusted = null;
    const sequence = ++requestSequence;
    const response = await fetch(api, {limit: 2 * 1024 * 1024});
    const data = parse(response.bytes);
    if (data.draft !== false || data.prerelease !== false || typeof data.tag_name !== 'string'
        || !data.tag_name.startsWith(tagPrefix) || !Array.isArray(data.assets)) throw new Error('GitHub Release 格式无效');
    const target = data.tag_name.slice(tagPrefix.length);
    version(target);
    const available = compare(target, officialVersion) > 0;
    const release = {
      version: target,
      url: 'https://github.com/' + repo + '/releases/tag/' + data.tag_name,
      notes: '',
      githubNotes: String(data.body ?? '').slice(0, 20000),
      ...releaseHistory(undefined, currentVersion, target)
    };
    const result = {release, available, verified: false, canSetup: false, canHotfix: false, trustError: null};
    if (sequence === requestSequence) onDiscovery(result);
    try {
      if (compare(target, currentVersion) < 0) throw new Error('此发布版本早于已安装版本');
      const manifestAsset = asset(data, MANIFEST);
      const signatureAsset = asset(data, SIGNATURE);
      const [manifestFile, signatureFile] = await Promise.all([
        fetch(manifestAsset.url, {limit: MANIFEST_LIMIT}),
        fetch(signatureAsset.url, {limit: 4096})
      ]);
      const manifest = verifyManifest(manifestFile.bytes, signatureFile.bytes, cert, {...identity, version: target});
      const supported = new Map();
      for (const entry of manifest.artifacts) {
        const location = asset(data, entry.name);
        if (entry.size !== location.size) throw new Error('资产大小与签名清单不一致：' + entry.name);
        if (entry.kind === 'setup') {
          if (entry.name !== setupName(target) || entry.size > SETUP_LIMIT) throw new Error('安装文件不符合本应用约定');
          if (compare(target, currentVersion) > 0) supported.set('setup', {spec: entry, ...location});
        }
        if (entry.kind === 'hotfix' && available && hotfixKinds.includes(entry.hotfixKind)
            && (!entry.baseVersion || entry.baseVersion === currentVersion)) {
          if (entry.size > JSON_LIMIT) throw new Error('热更新资产超过允许大小');
          if (entry.hotfixKind === 'algorithm' && !entry.baseVersion) throw new Error('算法热更新缺少基础版本');
          if (entry.hotfixKind === 'components' && !entry.moduleVersion) throw new Error('组件热更新缺少组件版本');
          const spec = {...entry, kind: entry.hotfixKind};
          supported.set('hotfix', {spec, ...location});
        }
      }
      if (sequence !== requestSequence) throw new Error('发现较新的检查请求，请用最新结果');
      recordTrust(trust, target, manifestFile.bytes);
      trusted = {target, supported, bytes: manifestFile.bytes, signature: signatureFile.bytes};
      return {
        ...result,
        release: {
          ...release,
          notes: manifest.releaseNotes.find(row => row.version === target).notes,
          ...releaseHistory(manifest.releaseNotes, currentVersion, target)
        },
        verified: true,
        canSetup: supported.has('setup'),
        canHotfix: supported.has('hotfix')
      };
    } catch (error) {
      return {...result, trustError: error.message};
    }
  }

  const stagedItems = new WeakMap();

  async function download(kind, onProgress) {
    const verified = trusted;
    const entry = verified?.supported.get(kind);
    if (!entry) throw new Error('此 Release 没有受信任、兼容的更新资产');
    const {url, size, spec} = entry;
    const directory = kind === 'setup' ? fs.mkdtempSync(path.join(ensureDownloadDir(), 'package-')) : null;
    const file = directory && path.join(directory, spec.name);
    try {
      const item = await fetch(url, {limit: size, file, progress: (received, total) => onProgress?.(received, total ?? size)});
      if (item.sha256 !== spec.sha256 || item.size !== spec.size || trusted !== verified) {
        throw new Error('更新资产与签名清单不一致');
      }
      const staged = {...item, version: verified.target, spec: {...spec}};
      stagedItems.set(staged, {kind, verified, entry, file, bytes: item.bytes});
      return staged;
    } catch (error) {
      if (directory) fs.rmSync(directory, {recursive: true, force: true});
      throw error;
    }
  }

  function ensureDownloadDir() {
    fs.mkdirSync(root, {recursive: true});
    return plain(root);
  }

  function verifyStaged(staged, kind) {
    const item = stagedItems.get(staged);
    if (!item || item.kind !== kind || item.verified !== trusted) throw new Error('更新已失效，请重新检查和下载');
    const {target, bytes, signature} = item.verified;
    verifyManifest(bytes, signature, cert, {...identity, version: target});
    recordTrust(trust, target, bytes);
    return item;
  }

  function verifySetup(staged) {
    const item = verifyStaged(staged, 'setup');
    return verifyArtifact(item.file, item.entry.spec);
  }

  function verifyHotfix(staged) {
    const item = verifyStaged(staged, 'hotfix');
    if (item.bytes.length !== item.entry.size || digest(item.bytes) !== item.entry.spec.sha256) {
      throw new Error('热更新资产已变化，请重新下载');
    }
    return Buffer.from(item.bytes);
  }

  return {discover, download, verifySetup, verifyHotfix};
}

module.exports = {createReleaseChannel, compare, validateManifest, verifyManifest, verifyArtifact, MANIFEST, SIGNATURE};
