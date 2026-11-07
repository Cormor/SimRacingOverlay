'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createStore}=require('../wheel-store');
const URL='https://github.com/Cormor/SimRacingOverlay/releases/download/v1.3.0/round.wheel.json';
function png(width=1315,height=1197){const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12,'ascii');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return 'data:image/png;base64,'+bytes.toString('base64');}
const data={schemaVersion:1,id:'round',image:png(),controls:[]};
const encode=value=>Buffer.from(JSON.stringify(value)),digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(__dirname,'.wheel-store-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=options.bytes||encode(data),catalog=options.catalog||[{id:'round',name:'Round',url:URL,sha256:digest(bytes)}];
 let calls=0;
 const request=options.request||((_url,_options,callback)=>{
  calls++;const req=new EventEmitter();req.destroy=()=>{};
  setImmediate(()=>{const res=new PassThrough();res.statusCode=200;res.headers={'content-length':String(bytes.length)};res.complete=true;callback(res);res.end(bytes);});
  return req;
 });
 const validate=options.validate||(value=>{if(value.schemaVersion!==1||!Array.isArray(value.controls))throw Error('Invalid schema');return value;});
 const store=createStore({root,catalog,request,validate});
 return {root,store,bytes,catalog,calls:()=>calls,file:path.join(root,'assets','wheel-packs','round.json')};
}
function responseRequest(status,headers={},body=Buffer.alloc(0),after){
 return (_url,_options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};setImmediate(()=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;res.complete=true;callback(res);if(after)after(res,req);else res.end(body);});return req;};
}

test('download installs only a verified data pack; local read and offline restart keep it usable',async t=>{
 const f=fixture(t);
 assert.equal(f.store.list()[0].installed,false);
 assert.deepEqual(await f.store.install('round'),{ok:true,id:'round'});
 assert.deepEqual(f.store.read('round'),data);
 assert.equal(f.store.list()[0].installed,true);
 assert.deepEqual(fs.readFileSync(f.file),f.bytes);
 assert.deepEqual(await f.store.install('round'),{ok:true,id:'round'});
 assert.equal(f.calls(),1,'cached install does not use the network');
 const offline=createStore({root:f.root,catalog:f.catalog,validate:x=>x,request:()=>{throw Error('offline');}});
 assert.deepEqual(offline.read('round'),data);
 assert.deepEqual(await offline.install('round'),{ok:true,id:'round'});
});

test('same-id duplicate downloads share one promise and write one complete file',async t=>{
 const f=fixture(t),first=f.store.install('round'),second=f.store.install('round');
 assert.equal(first,second);
 await Promise.all([first,second]);assert.equal(f.calls(),1);
 assert.deepEqual(fs.readdirSync(path.dirname(f.file)),['round.json']);
});

test('hash failure leaves an existing file intact and produces no temporary file',async t=>{
 const expected=encode(data),bad=encode({...data,name:'tampered'});
 const f=fixture(t,{bytes:bad,catalog:[{id:'round',name:'Round',url:URL,sha256:digest(expected)}]});
 fs.mkdirSync(path.dirname(f.file),{recursive:true});fs.writeFileSync(f.file,'previous');
 await assert.rejects(f.store.install('round'),/校验失败/);
 assert.equal(fs.readFileSync(f.file,'utf8'),'previous');
 assert.deepEqual(fs.readdirSync(path.dirname(f.file)),['round.json']);
 assert.equal(f.store.read('round'),null);
});

test('catalog id, schema, PNG header, dimensions, UTF-8 and JSON all must validate',async t=>{
 for(const bytes of [encode({...data,id:'other'}),encode({...data,schemaVersion:2}),encode({...data,image:png(600,600)}),encode({...data,image:'data:image/svg+xml;base64,AAAA'}),Buffer.from([255]),Buffer.from('{bad')]){
  const f=fixture(t,{bytes});await assert.rejects(f.store.install('round'));
  assert.equal(fs.existsSync(f.file),false);
 }
});

test('large bounded PNG payload validates without a recursive base64 regular expression',async t=>{
 const image=Buffer.alloc(2*1024*1024);Buffer.from(png().slice('data:image/png;base64,'.length),'base64').copy(image);
 const bytes=encode({...data,image:'data:image/png;base64,'+image.toString('base64')});
 const f=fixture(t,{bytes});await f.store.install('round');assert.equal(f.store.list()[0].installed,true);
});

test('unknown ids and untrusted catalog locations cannot trigger network or path access',async t=>{
 const f=fixture(t);for(const id of ['../outside','default','round/other','other',null])await assert.rejects(f.store.install(id),/未找到/);
 assert.equal(f.calls(),0);
 for(const url of ['http://github.com/Cormor/SimRacingOverlay/releases/download/v1/pack','https://github.com/Other/Repo/releases/download/v1/pack','https://evil.test/pack','https://github.com:444/Cormor/SimRacingOverlay/releases/download/v1/pack','https://name@github.com/Cormor/SimRacingOverlay/releases/download/v1/pack'])assert.throws(()=>createStore({root:f.root,catalog:[{...f.catalog[0],url}],validate:x=>x}),/不受信任/);
});

test('both announced and streamed oversize responses fail before cache commit',async t=>{
 for(const request of [responseRequest(200,{'content-length':String(8*1024*1024+1)}),responseRequest(200,{},null,res=>res.end(Buffer.alloc(8*1024*1024+1)))]){
  const f=fixture(t,{request});await assert.rejects(f.store.install('round'),/超过 8 MiB/);assert.equal(fs.existsSync(f.file),false);
 }
});

test('HTTP errors and incomplete or aborted responses remain retryable',async t=>{
 for(const request of [responseRequest(404),responseRequest(200,{'content-length':'999'},Buffer.from('{}')),responseRequest(200,{},null,res=>res.emit('aborted'))]){
  const f=fixture(t,{request});await assert.rejects(f.store.install('round'));assert.equal(fs.existsSync(f.file),false);
 }
});

test('trusted CDN redirect succeeds and validates the final raw bytes',async t=>{
 const bytes=encode(data),visited=[];
 const request=(url,options,callback)=>{
  visited.push(url.href);
  return visited.length===1?responseRequest(302,{location:'https://release-assets.githubusercontent.com/github-production-release-asset/pack?signature=example'})(url,options,callback):responseRequest(200,{},bytes)(url,options,callback);
 };
 const f=fixture(t,{request});await f.store.install('round');
 assert.equal(visited.length,2);assert.equal(f.store.read('round').id,'round');
});

test('late errors and timeouts from a retired redirect hop cannot cancel its CDN successor',async t=>{
 const bytes=encode(data);let count=0;
 const request=(url,options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>{};const first=++count===1;
  setImmediate(()=>{
   const res=new PassThrough();res.statusCode=first?302:200;res.headers=first?{location:'https://release-assets.githubusercontent.com/pack'}:{};res.complete=true;
   callback(res);
   if(first)setImmediate(()=>{req.emit('error',Error('late request error'));req.emit('timeout');res.emit('error',Error('late response error'));res.emit('timeout');res.emit('aborted');});
   else setTimeout(()=>res.end(bytes),20);
  });
  return req;
 };
 const f=fixture(t,{request});await f.store.install('round');assert.equal(count,2);assert.equal(f.store.read('round').id,'round');
});

test('errors and timeouts on the active CDN hop still fail the current download',async t=>{
 for(const event of ['request-error','request-timeout','response-error']){
  let count=0;
  const request=(url,options,callback)=>{
   if(++count===1)return responseRequest(302,{location:'https://release-assets.githubusercontent.com/pack'})(url,options,callback);
   return responseRequest(200,{},null,(res,req)=>setImmediate(()=>event==='request-error'?req.emit('error',Error('active error')):event==='request-timeout'?req.emit('timeout'):res.emit('error',Error('active response error'))))(url,options,callback);
  };
  const f=fixture(t,{request});await assert.rejects(f.store.install('round'));assert.equal(fs.existsSync(f.file),false);
 }
});

test('redirects reject HTTP, arbitrary hosts, repository changes, missing locations and loops',async t=>{
 for(const location of ['http://release-assets.githubusercontent.com/pack','https://evil.test/pack','https://github.com/Other/Repo/releases/download/v1/pack',null,'https://objects.githubusercontent.com/loop']){
  let count=0;const request=(url,options,callback)=>{count++;return responseRequest(302,location?{location}:{})(url,options,callback);};
  const f=fixture(t,{request});await assert.rejects(f.store.install('round'));
  assert(count<=5,'at most the original request plus four redirects');assert.equal(fs.existsSync(f.file),false);
 }
});

test('request timeout and total deadline both reject without leaving pending installs',async t=>{
 const timeoutRequest=()=>{const req=new EventEmitter();req.destroy=()=>{};setImmediate(()=>req.emit('timeout'));return req;};
 const f=fixture(t,{request:timeoutRequest});await assert.rejects(f.store.install('round'),/超时/);await assert.rejects(f.store.install('round'),/超时/);
 const original=global.setTimeout;
 t.mock.method(global,'setTimeout',(callback,ms,...args)=>original(callback,ms===20000?10:ms,...args));
 const g=fixture(t,{request:()=>{const req=new EventEmitter();req.destroy=()=>{};return req;}});
 await assert.rejects(g.store.install('round'),/超时/);assert.equal(fs.existsSync(g.file),false);
});

test('symlinked directories and cache files cannot be read or overwritten',async t=>{
 const f=fixture(t),outside=fs.mkdtempSync(path.join(__dirname,'.wheel-store-outside-'));
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.mkdirSync(path.join(f.root,'assets'));fs.symlinkSync(outside,path.join(f.root,'assets','wheel-packs'),'junction');
 await assert.rejects(f.store.install('round'),/链接|联接/);assert.deepEqual(fs.readdirSync(outside),[]);assert.equal(f.store.read('round'),null);
 fs.unlinkSync(path.join(f.root,'assets','wheel-packs'));fs.mkdirSync(path.dirname(f.file));
 const original=path.join(outside,'original.json');fs.writeFileSync(original,f.bytes);fs.symlinkSync(original,f.file);
 assert.equal(f.store.read('round'),null);await assert.rejects(f.store.install('round'),/链接|联接/);assert.deepEqual(fs.readFileSync(original),f.bytes);
});

test('a failed atomic rename removes only this attempt temporary file',async t=>{
 const f=fixture(t);fs.mkdirSync(f.file,{recursive:true});
 await assert.rejects(f.store.install('round'));
 assert(fs.statSync(f.file).isDirectory());assert.deepEqual(fs.readdirSync(path.dirname(f.file)),['round.json']);
});

test('different ids can download independently without replacing each other',async t=>{
 const one=encode(data),two=encode({...data,id:'second'}),items=[{id:'round',name:'Round',url:URL,sha256:digest(one)},{id:'second',name:'Second',url:URL.replace('round.wheel','second.wheel'),sha256:digest(two)}];
 const request=(url,options,callback)=>responseRequest(200,{},url.pathname.includes('second')?two:one)(url,options,callback);
 const f=fixture(t,{catalog:items,request});await Promise.all([f.store.install('round'),f.store.install('second')]);
 assert.equal(f.store.read('round').id,'round');assert.equal(f.store.read('second').id,'second');assert(f.store.list().every(x=>x.installed));
});
