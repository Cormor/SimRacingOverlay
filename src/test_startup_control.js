'use strict';
// Targeted reproduction of the observed startup request failure. Execute the
// real desktop functions with delayed native creation and renderer readiness.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(require('node:path').join(__dirname,'../desktop-main.js'),'utf8');
const functions=source.slice(source.indexOf(' function waitPageLoaded('),source.indexOf(' app.whenReady().then'));
function fixture(){
 const errors=[],calls=[];
 function contents(loading=false,url='http://test/manager.html'){
  return Object.assign(new EventEmitter(),{loading,url,destroyed:false,isDestroyed(){return this.destroyed;},isLoadingMainFrame(){return this.loading;},getURL(){return this.url;},async executeJavaScript(){calls.push('navigate');return {ready:true,opened:true};}});
 }
 function window(loading=false){return {webContents:contents(loading),destroyed:false,minimized:false,isDestroyed(){return this.destroyed;},isMinimized(){return this.minimized;},restore(){this.minimized=false;calls.push('restore');},show(){calls.push('show');},focus(){calls.push('focus');}};}
 const hud=window();hud.webContents.url='http://test/';
 const context=vm.createContext({setTimeout,clearTimeout,Date,Error,Promise,manager:null,win:hud,managerUrl:'http://test/manager.html',directEditor:{active:false},reportError:e=>errors.push(e.message)});
 vm.runInContext(functions+';globalThis.open=openManager;',context);
 return {context,hud,window,calls,errors};
}
const pause=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const a=fixture();let create;
 a.hud.webContents.executeJavaScript=async()=>{create=()=>{a.context.manager=a.window(true);a.hud.webContents.emit('did-create-window',a.context.manager);};return true;};
 const opening=a.context.open('overview',Date.now()+1000);await pause();
 assert.equal(a.context.manager,null,'the open invocation can complete before native creation');
 create();await pause();assert.deepEqual(a.calls,[],'new management renderer must finish loading first');
 a.context.manager.webContents.loading=false;a.context.manager.webContents.emit('did-finish-load');
 assert.equal((await opening).opened,true);assert.deepEqual(a.calls,['navigate','show','focus']);
 const b=fixture();b.context.manager=b.window(true);b.context.manager.minimized=true;
 const existing=b.context.open('overview',Date.now()+1000);await pause();assert.deepEqual(b.calls,[]);
 b.context.manager.webContents.loading=false;b.context.manager.webContents.emit('did-finish-load');
 assert.equal((await existing).opened,true);assert.deepEqual(b.calls,['restore','navigate','show','focus']);
 const c=fixture();c.context.manager=c.window();c.context.manager.webContents.executeJavaScript=async()=>({ready:true,opened:false});
 assert.equal((await c.context.open('overview')).opened,false,'actual save/leave refusal remains a refusal');assert.deepEqual(c.calls,[]);
 const d=fixture();d.context.manager=d.window(true);const expired=d.context.open('overview',Date.now()+20);
 assert.equal((await expired).opened,false);assert.deepEqual(d.calls,[]);assert.match(d.errors[0],/expired/);
 const e=fixture();e.context.manager=e.window(true);const closed=e.context.open('overview',Date.now()+1000);e.context.manager.webContents.emit('destroyed');
 assert.equal((await closed).opened,false);assert.deepEqual(e.calls,[]);
 const f=fixture();f.context.manager=f.window();f.context.manager.webContents.executeJavaScript=async()=>({ready:false});
 assert.equal((await f.context.open('overview')).opened,false);assert.match(f.errors[0],/navigation endpoint/);
 console.log('PASS: delayed creation, loading existing/minimized manager, real refusal, expiry, close, missing endpoint');
})().catch(error=>{console.error(error);process.exitCode=1;});
