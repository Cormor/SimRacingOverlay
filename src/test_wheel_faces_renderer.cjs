// Windows Electron acceptance using synthetic input; never starts the device bridge.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const packFile=path.resolve(process.argv[3]||path.join(root,'wheel-packs/simagic-gt-pro-round/profile.json'));
const out=path.resolve(process.argv[4]||path.join(root,'build','wheel-faces-qa'));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('no-proxy-server');
const pack=fs.readFileSync(packFile),catalog=JSON.parse(fs.readFileSync(path.join(root,'assets/wheel-catalog.json'))),id=catalog[0].id;
const cache=fs.mkdtempSync(path.join(out,'cache-'));
const {createStore}=require(path.join(root,'wheel-store'));
let failDownload=true,downloads=0,listDelay=0;
const store=createStore({root:cache,catalog,validate:require(path.join(root,'wheel-profile')).validate,request:(_url,_options,callback)=>{
 const request=new EventEmitter();request.destroy=()=>{};setTimeout(()=>{const response=new PassThrough();response.statusCode=failDownload?503:200;response.headers={};callback(response);if(!failDownload){downloads++;response.end(pack);}},30);return request;
}});
const layoutFile=path.join(out,'layout.json'),preload=path.join(out,'qa-preload.cjs');
fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('desktopOverlay',{onScene:()=>{},saveLayout:v=>ipcRenderer.invoke('qa-save',v),saveLayoutNow:v=>ipcRenderer.sendSync('qa-save-sync',v),listWheelFaces:()=>ipcRenderer.invoke('qa-list'),downloadWheelFace:id=>ipcRenderer.invoke('qa-download',id),finishEditing:()=>{}});`);
function save(value){fs.writeFileSync(layoutFile,JSON.stringify(require(path.join(root,'layout')).clean(value)));return {ok:true};}
ipcMain.handle('qa-save',(_event,value)=>save(value));ipcMain.on('qa-save-sync',(event,value)=>{event.returnValue=save(value);});
ipcMain.handle('qa-list',async()=>{if(listDelay)await new Promise(r=>setTimeout(r,listDelay));return {ok:true,faces:store.list()};});ipcMain.handle('qa-download',async(_event,id)=>{try{return await store.install(id);}catch(e){return {ok:false,error:e.message};}});
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(req.url.split('?')[0]).slice(1)||'index.html';if(relative.includes('..')){res.writeHead(403);res.end();return;}
 const file=relative.startsWith('assets/wheel-packs/')?path.join(cache,relative):path.join(root,relative);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.png')?'image/png':relative.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
});
let win,obs;const errors=[],checks=[];let roundness=null;
async function until(test,message){for(let i=0;i<150;i++){if(await test())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+message);}
const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(e){console.error('Renderer command:',code);throw e;}};
async function capture(name){win.showInactive();await js('overlayDiagnostics.renderTest(performance.now())');await new Promise(r=>setTimeout(r,80));fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(await js('({face:WheelFaces.get().id,status:document.querySelector("#wheelStatus")?.textContent,image:image.src.slice(0,40),layout:OverlayLayout.get().wheel})')));fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function run(port){
 win=new BrowserWindow({show:true,skipTaskbar:true,width:1440,height:1000,backgroundColor:'#18212a',webPreferences:{preload,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(event.level==='error'){console.error('Renderer:',event.message);if(!event.message.includes('503'))errors.push(event.message);}});
 await win.loadURL(`http://127.0.0.1:${port}/?qa=1&edit=1`);await js('image.decode()');
 await until(()=>js('document.querySelectorAll("#wheelFace option").length===2'),'catalog');
 assert.equal(await js('WheelFaces.get().id'),'default');assert.equal(await js('OverlayLayout.get().controls.dashboard.enabled'),false);
 await js("OverlayLayout.setDesktopStage({width:1440,height:1000,originX:120,originY:120,scale:.85});var v=OverlayLayout.get();v.controls.wheel.x=17;v.controls.wheel.rotation=9;OverlayLayout.set(v);");
 const oldWheel=await js('OverlayLayout.get().controls.wheel');await capture('01-default-editor');
 await js(`document.querySelector('#wheelFace').value='${id}';document.querySelector('#wheelFace').dispatchEvent(new Event('change'));document.querySelector('#downloadFace').click()`);
 await until(()=>js('document.querySelector("#wheelStatus").textContent.includes("下载失败")'),'visible failed download');
 assert.equal(await js('WheelFaces.get().id'),'default');assert.equal(store.list()[0].installed,false);checks.push('failed download preserves selected wheel and reports retry');
 failDownload=false;await js('document.querySelector("#downloadFace").click()');
 await until(()=>js(`WheelFaces.get().id==='${id}'&&!overlayEditor.getStatus().dirty&&document.querySelector('#wheelStatus').textContent.includes('已选择')`),'download, decode, choose and save');
 assert.equal(downloads,1);assert.equal(store.list()[0].installed,true);assert.deepEqual(await js('OverlayLayout.get().controls.wheel'),oldWheel);
 assert.equal(await js('WheelFaces.get().dashboard'),null);assert.equal(await js('OverlayLayout.get().controls.dashboard.enabled'),false);
 await capture('02-downloaded-editor');checks.push('one verified optional pack, no embedded dash, existing wheel geometry preserved');
 // Learn from a fresh button edge, including renderer input-path verification.
 await js("document.querySelector('#buttonMaps button').click();overlayDiagnostics.setTestState({connected:true,angle:0,buttons:[42],game:{available:true,packet:1,source:'qa',rpm:7900,maxRpm:8000,gear:'4',speedKmh:173}},1000);overlayDiagnostics.renderTest(1000)");
 await until(()=>js('OverlayLayout.get().wheel.buttonMaps[WheelFaces.get().id]?.["button-1"]?.[0]===42'),'learned button');
 await js('overlayDiagnostics.renderTest(1100)');assert.deepEqual(await js('overlayDiagnostics.controls[0].b'),[42]);assert.deepEqual(await js('overlayDiagnostics.controls[1].b'),JSON.parse(pack).controls[1].b);
 assert.equal(await js('ledShapes.length'),9);assert.equal(await js('overlayDiagnostics.getUi().rpmLightSource'),'game-rpm-ratio');
 await capture('03-pressed-rpm');checks.push('learned key uses this face coordinates; 9 LEDs follow valid RPM ratio');
 await js("document.querySelector('#dashboardMode').value='separate';document.querySelector('#dashboardMode').dispatchEvent(new Event('change'));");
 assert.equal(await js('OverlayLayout.get().controls.dashboard.enabled'),true);
 await js("document.querySelector('[data-id=dashboard] input').click();var v=OverlayLayout.get();v.controls.dashboard.x=55;v.controls.dashboard.y=-30;OverlayLayout.set(v);overlayEditor.flushSaveNow()");
 assert.equal(JSON.parse(fs.readFileSync(layoutFile)).controls.dashboard.x,55);await capture('04-separate-dashboard');
 await js("document.querySelector('[data-id=dashboard] [data-action=enabled]').click()");assert.equal(await js('OverlayLayout.get().wheel.dashboardMode'),'auto');assert.equal(await js('OverlayLayout.get().controls.dashboard.enabled'),false);
 await js("document.querySelector('#undo').click()");assert.equal(await js('OverlayLayout.get().wheel.dashboardMode'),'separate');assert.equal(await js('OverlayLayout.get().controls.dashboard.enabled'),true);
 checks.push('independent dash positioning saves; module visibility and undo restore matching mode');
 await js("document.querySelector('#wheelFace').value='default';document.querySelector('#wheelFace').dispatchEvent(new Event('change'))");await until(()=>js("WheelFaces.get().id==='default'"),'return original');
 await js("document.querySelector('#undo').click()");await until(()=>js(`WheelFaces.get().id==='${id}'`),'undo wheel choice');await js('overlayEditor.flushSaveNow()');
 const saved=JSON.parse(fs.readFileSync(layoutFile));assert.equal(saved.wheel.faceId,id);assert.deepEqual(saved.wheel.buttonMaps[id]['button-1'],[42]);
 // A separate browser/OBS page reads the same saved settings and cached face.
 obs=new BrowserWindow({show:false,width:1440,height:1000,transparent:true,webPreferences:{backgroundThrottling:false}});await obs.loadURL(`http://127.0.0.1:${port}/?qa=1`);
 await obs.webContents.executeJavaScript(`OverlayLayout.set(${JSON.stringify(saved)})`);await until(()=>obs.webContents.executeJavaScript(`WheelFaces.get().id==='${id}'`),'OBS selects cached face');
 assert.deepEqual(await obs.webContents.executeJavaScript('OverlayLayout.get().wheel'),saved.wheel);
 assert.equal(createStore({root:cache,catalog,validate:require(path.join(root,'wheel-profile')).validate,request:()=>{throw Error('offline');}}).list()[0].installed,true);
 checks.push('undo selection, per-face key mapping, OBS page and offline restart restore the same cached pack');
 await obs.webContents.executeJavaScript("overlayDiagnostics.setTestState({connected:true,angle:0,buttons:[],game:{available:true,packet:2,source:'qa',rpm:7900,maxRpm:8000,gear:'4',speedKmh:173}},1000);overlayDiagnostics.renderTest(1000)");
 obs.showInactive();await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(out,'05-obs-separate.png'),(await obs.webContents.capturePage()).toPNG());
 for(const state of [{available:true,packet:3,source:'qa',paused:true,rpm:8000,maxRpm:8000},{available:false}]){await js(`overlayDiagnostics.setTestState({connected:true,buttons:[],game:${JSON.stringify(state)}},1500);overlayDiagnostics.renderTest(1500)`);assert.equal(await js('overlayDiagnostics.getUi().rpmLightSource'),'unavailable');}
 checks.push('paused and absent telemetry do not generate RPM lights');
 // Delayed layout response bodies cannot overwrite a later edit.
 await js("window.qaOldLayout=OverlayLayout.get();window.qaFetch=fetch;window.qaReleaseBody=null;fetch=(url,...args)=>url==='assets/layout.json'?Promise.resolve({ok:true,json:()=>new Promise(resolve=>qaReleaseBody=resolve)}):qaFetch(url,...args);overlayEditor.reloadLayout();void 0");
 await until(()=>js('qaReleaseBody!==null'),'delayed layout body');
 await js("document.querySelector('#dashboardMode').value='hidden';document.querySelector('#dashboardMode').dispatchEvent(new Event('change'));qaReleaseBody(qaOldLayout);fetch=qaFetch;void 0");
 await new Promise(r=>setTimeout(r,40));assert.equal(await js('OverlayLayout.get().wheel.dashboardMode'),'hidden');
 checks.push('late old layout body cannot overwrite a newer edit');
 // A previous image decode cannot replace a newly selected undownloaded option.
 await js("window.qaDecode=Image.prototype.decode;window.qaReleaseDecode=null;Image.prototype.decode=function(){return new Promise(resolve=>qaReleaseDecode=resolve)};document.querySelector('#wheelFace').value='default';document.querySelector('#wheelFace').dispatchEvent(new Event('change'));");
 await until(()=>js('qaReleaseDecode!==null'),'delayed decode');win.show();win.focus();const duringDecode=await js('OverlayLayout.get()');const dragPoint=await js("(()=>{const s=OverlayLayout.stage(),r=canvas.getBoundingClientRect(),fit=Math.min(r.width/s.width,r.height/s.height);return {x:Math.round(r.x+(r.width-s.width*fit)/2+(s.originX+930*s.scale)*fit),y:Math.round(r.y+(r.height-s.height*fit)/2+(s.originY+450*s.scale)*fit)}})()");win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...dragPoint});win.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x+40,y:dragPoint.y+20,movementX:40,movementY:20});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:dragPoint.x+40,y:dragPoint.y+20});await new Promise(r=>setTimeout(r,40));assert.deepEqual(await js('OverlayLayout.get()'),duringDecode);checks.push('in-flight face decode cannot create an old drag snapshot');assert.equal(await js('overlayEditor.flushSaveNow().ok'),false);await js('document.querySelector("#finish").click()');assert.equal(await js('document.querySelector("#notice").textContent.includes("盘面正在")'),true);checks.push('finish and synchronous save refuse to exit during image loading');
 await js("var option=document.createElement('option');option.value='other-download';option.textContent='尚未下载';document.querySelector('#wheelFace').append(option);document.querySelector('#wheelFace').value='other-download';document.querySelector('#wheelFace').dispatchEvent(new Event('change'));qaReleaseDecode();Image.prototype.decode=qaDecode;void 0");
 await new Promise(r=>setTimeout(r,40));assert.equal(await js('WheelFaces.get().id'),id);assert.equal(await js('document.querySelector("#wheelFace").value'),'other-download');
 checks.push('undownloaded selection cancels an older in-flight image decode');
 // Actual pointer input, followed by Escape and pointer cancellation, restores the complete layout.
 win.show();win.focus();
 for(const cancel of ['escape','pointercancel','undo']){
  const before=await js('OverlayLayout.get()');const point=await js("(()=>{const s=OverlayLayout.stage(),r=canvas.getBoundingClientRect(),fit=Math.min(r.width/s.width,r.height/s.height);return {x:Math.round(r.x+(r.width-s.width*fit)/2+(s.originX+930*s.scale)*fit),y:Math.round(r.y+(r.height-s.height*fit)/2+(s.originY+450*s.scale)*fit)}})()");
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseMove',x:point.x+40,y:point.y+20,movementX:40,movementY:20});
  await until(async()=>JSON.stringify(await js('OverlayLayout.get().controls'))!==JSON.stringify(before.controls),'pointer drag changes geometry');
  if(cancel==='undo')await js('document.querySelector("#undo").click()');else if(cancel==='escape')win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});else await js('canvas.onpointercancel({pointerId:1})');
  await until(async()=>JSON.stringify(await js('OverlayLayout.get()'))===JSON.stringify(before),'cancel restores layout');win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x+40,y:point.y+20});
 }
 checks.push('real pointer drag Escape, pointercancel and undo preserve complete nondefault layout');
 // Persisted new face may load before the first asynchronous catalog arrives.
 listDelay=600;await win.loadURL(`http://127.0.0.1:${port}/?qa=1&edit=1&restart=1`);await js(`OverlayLayout.set(${JSON.stringify(saved)})`);
 await until(()=>js(`WheelFaces.get().id==='${id}'&&document.querySelector('#wheelFace').value==='${id}'`),'late catalog reflects restored face').catch(async e=>{console.error('Startup state:',await js('({face:WheelFaces.get(),layout:OverlayLayout.get().wheel,options:[...document.querySelector("#wheelFace").options].map(o=>o.value),value:document.querySelector("#wheelFace").value,status:document.querySelector("#wheelStatus").textContent})'));throw e;});checks.push('late initial catalog agrees with restored downloaded face');
 obs.hide();win.setAlwaysOnTop(true,'screen-saver');win.show();win.moveTop();win.focus();await new Promise(r=>setTimeout(r,200));
 await js('overlayDiagnostics.renderTest(performance.now())');await win.webContents.capturePage();
 const choiceBefore=await js('document.querySelector("#wheelFace").value');
 const selectRect=await js("(()=>{const r=document.querySelector('#wheelFace').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...selectRect});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...selectRect});await new Promise(r=>setTimeout(r,200));
 const handle=win.getNativeWindowHandle(),handleValue=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
 require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/capture_own_window.ps1'),'-WindowHandle',handleValue,'-OutputPath',path.join(out,'06-native-picker.png')],{windowsHide:true,timeout:10000});
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await new Promise(r=>setTimeout(r,50));assert.equal(await js('document.querySelector("#wheelFace").value'),choiceBefore);
 await js('document.querySelector("#buttonMaps").closest("details").open=true;document.querySelectorAll(".wheelMapping")[8].scrollIntoView({block:"start"})');await capture('06b-real-mapping');win.setAlwaysOnTop(false);checks.push('native selector expanded and cancelled in the actual Windows window');
 // Read actual alpha bounds, independent of DOM/state success labels.
 const geometry=[];
 for(const angle of [0,90,180,270]){const row=await obs.webContents.executeJavaScript(`(()=>{const v=OverlayLayout.get();for(const c of Object.values(v.controls))c.opacity=0;Object.assign(v.controls.wheel,{opacity:1,x:0,y:0,sx:1,sy:1,rotation:0});v.wheel.dashboardMode='auto';OverlayLayout.setDesktopStage({width:1000,height:850,originX:0,originY:0,scale:1});OverlayLayout.set(v);overlayDiagnostics.setTestState({connected:true,angle:${angle},buttons:[],leds:{available:false}},1000);overlayDiagnostics.renderTest(1000);const canvas=document.querySelector('canvas'),d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let l=canvas.width,r=-1,t=canvas.height,b=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(d[(y*canvas.width+x)*4+3]>200){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}const stage=OverlayLayout.stage(),sx=canvas.width/stage.width,sy=canvas.height/stage.height;return {angle:${angle},w:(r-l+1)/sx,h:(b-t+1)/sy,cx:(l+r)/2/sx,cy:(t+b)/2/sy}})()`);geometry.push(row);}
 obs.showInactive();await new Promise(r=>setTimeout(r,50));fs.writeFileSync(path.join(out,'07-wheel-rotated.png'),(await obs.webContents.capturePage()).toPNG());
 const diameters=geometry.flatMap(v=>[v.w,v.h]);roundness={geometry,diameterSpread:Math.max(...diameters)-Math.min(...diameters),centerOffset:Math.max(...geometry.map(v=>Math.hypot(v.cx-500,v.cy-450)))};assert(roundness.diameterSpread<=1.5,JSON.stringify(roundness));assert(roundness.centerOffset<1,JSON.stringify(roundness));checks.push('actual wheel alpha stays circular and centered at four quarter-turn angles');

 const lightBoundary=await obs.webContents.executeJavaScript(`(()=>{const probe=document.createElement('canvas');probe.width=1315;probe.height=1197;const pc=probe.getContext('2d');pc.drawImage(image,0,0);const mask=pc.getImageData(0,0,1315,1197).data,rendered=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,s=OverlayLayout.stage(),rx=canvas.width/s.width,ry=canvas.height/s.height;let probes=0,leaks=0;for(const c of WheelFaces.get().controls.filter(c=>c.led!==undefined))for(let y=Math.ceil(c.y-c.r-25);y<=c.y+c.r+25;y++)for(let x=Math.ceil(c.x-c.r-25);x<=c.x+c.r+25;x++){const d=Math.hypot(x-c.x,y-c.y);if(d<c.r+8||d>c.r+25)continue;let transparent=true;for(const dy of [-2,0,2])for(const dx of [-2,0,2])if(mask[((y+dy)*1315+x+dx)*4+3]>0)transparent=false;if(!transparent)continue;probes++;const tx=Math.round((500+(y-602.5)*740/1315)*rx),ty=Math.round((450-(x-655)*740/1315)*ry),i=(ty*canvas.width+tx)*4;if(rendered[i+3]>10&&Math.max(...rendered.slice(i,i+3))>60)leaks++;}return {probes,leaks};})()`);
 assert(lightBoundary.probes>100,JSON.stringify(lightBoundary));assert.equal(lightBoundary.leaks,0,JSON.stringify(lightBoundary));fs.writeFileSync(path.join(out,'button-light-boundary.json'),JSON.stringify(lightBoundary));checks.push('button lighting stays within real bezels beside the transparent hub cutouts');
 const inputEvidence=await obs.webContents.executeJavaScript(`(()=>{const v=OverlayLayout.get();delete v.wheel.buttonMaps['${id}'];OverlayLayout.set(v);const face=WheelFaces.get(),targets=[...face.controls,...face.encoders],canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),stage=OverlayLayout.stage(),rx=canvas.width/stage.width,ry=canvas.height/stage.height,rows=[];
 for(const c of targets){const sample=buttons=>{overlayDiagnostics.setTestState({connected:true,angle:0,buttons,leds:{available:false}},2000);overlayDiagnostics.renderTest(2000);const x=Math.round((500+(c.x-655)*740/1315)*rx),y=Math.round((450+(c.y-602.5)*740/1315)*ry),r=Math.ceil((c.r+22)*740/1315*Math.max(rx,ry));return ctx.getImageData(x-r,y-r,2*r,2*r).data;};const off=sample([]),on=sample([c.b[0]]);let changed=0;for(let i=0;i<off.length;i+=4)if(off[i]!==on[i]||off[i+1]!==on[i+1]||off[i+2]!==on[i+2]||off[i+3]!==on[i+3])changed++;rows.push({id:c.id,button:c.b[0],changed});}return rows;})()`);
 assert.equal(inputEvidence.length,16);for(const row of inputEvidence)assert(row.changed>10,JSON.stringify(row));fs.writeFileSync(path.join(out,'factory-inputs.json'),JSON.stringify(inputEvidence,null,2));checks.push('all 16 physical controls respond to their sourced factory input at their actual image coordinates');



 const report={root,checks,downloads,errors,saved,roundness};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,downloads,errors}));
}
app.whenReady().then(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));await run(server.address().port);}catch(error){console.error(error);fs.writeFileSync(path.join(out,'failure.txt'),String(error.stack));process.exitCode=1;}finally{win?.destroy();obs?.destroy();server.close();app.exit(process.exitCode||0);}});
