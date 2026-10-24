// Run with the project's Electron runtime. Hidden windows, synthetic telemetry,
// ephemeral loopback server and a build-only browser profile; no device access.
const {app,BrowserWindow,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build','renderer-test');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
// A fixed test clock models high-refresh callbacks even when hidden windows are throttled.
app.commandLine.appendSwitch('no-proxy-server');
const baseline=new Map();
for(const file of fs.readdirSync(root).filter(f=>/\.(js|html)$/.test(f)))try{baseline.set(file,execFileSync('git',['show','HEAD:'+file],{cwd:root,stdio:['ignore','pipe','ignore']}));}catch{}
const renderHz=Number(process.argv.find(a=>a.startsWith('--hz='))?.split('=')[1]||144);
if(!(renderHz>=30&&renderHz<=360))throw Error('Invalid render cadence');
// Match the polling deadline in both versions so CPU compares equal input work.
const original=baseline.get('overlay.js').toString();
baseline.set('overlay.js',Buffer.from(original.replace('setTimeout(poll,16)','setTimeout(poll,Math.max(0,1000/60-(performance.now()-requestAt)))')));
const preload=path.join(out,'raf-preload.cjs');
fs.writeFileSync(preload,`window.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),1000/${renderHz});window.cancelAnimationFrame=clearTimeout;`);
let mode='baseline',fixture='native',start=Date.now(),refuseEvents=false,suspendEvents=false;const streams=new Set();
function state(){
 const t=Date.now()-start,packet=Math.floor(t/(1000/60));
 if(fixture==='body'){
  const s=JSON.parse(fs.readFileSync(path.join(root,'build','telemetry-tests','iracing.json')));
  s.game.packet=packet;s.game.sampleTime=t;return s;
 }
 const moving=process.argv.includes('--steady')?0:t;
 return {connected:true,leds:process.argv.includes('--steady')?{available:true,buttons:Array(20).fill('#5ca7b0')}:undefined,angle:Math.sin(moving/900)*40,brake:20,throttle:60,buttons:[],game:{available:true,packet,sampleTime:t,speedKmh:100,rpm:6000,source:'synthetic-native',gas:.6,brake:.2,localVelocity:[1,0,28],accGFrame:'body',accG:[.4,0,.1],wheels:Array.from({length:4},(_,i)=>({angle:.08+Math.sin(moving/800+i)*.02,ratio:.05,load:3000,fx:1200,fy:1800}))}};
}
const server=http.createServer((req,res)=>{
 const file=decodeURIComponent(req.url.split('?')[0]).slice(1)||'index.html';
 if(file==='events'){
  if(refuseEvents){res.writeHead(503);res.end();return;}streams.add(res);
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': ready\n\n');
  let next=performance.now(),timer,closed=false;const send=()=>{if(closed||res.writableEnded||res.destroyed)return;if(!suspendEvents)res.write('data: '+JSON.stringify(state())+'\n\n');next+=1000/60;if(performance.now()-next>50)next=performance.now();timer=setTimeout(send,Math.max(1,next-performance.now()));};send();req.on('close',()=>{closed=true;streams.delete(res);clearTimeout(timer);});return;
 }
 if(file==='state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state()));return;}
 if(file.includes('..')){res.writeHead(403);res.end();return;}
 let source=mode==='baseline'&&baseline.has(file)?baseline.get(file):fs.existsSync(path.join(root,file))?fs.readFileSync(path.join(root,file)):null;
 if(mode==='candidate'&&req.headers.referer?.includes('materials=reference')){
  if(file==='dashboard.js')source=baseline.get(file);
  if(file==='overlay.js')source=Buffer.from(source.toString().replace(/^const ledPaths=.*$/m,'const ledPaths=null;').replace('ctx.drawImage(wheelImage(),','ctx.drawImage(image,'));
 }
 if(!source){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(source);
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function measure(port,which){
 mode=which;start=Date.now();const errors=[];
 const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{backgroundThrottling:false,preload,contextIsolation:false}});
 win.webContents.on('console-message',(_event,...args)=>{const details=args[0];if(details?.level==='error')errors.push(details.message);});
 await (await net.fetch('http://127.0.0.1:'+port+'/')).arrayBuffer();
 await win.loadURL('http://127.0.0.1:'+port+'/');await pause(1200);
 const pid=win.webContents.getOSProcessId(),cpu=[];app.getAppMetrics();
 const before=await win.webContents.executeJavaScript('overlayDiagnostics.getPerformance()');
 if(process.argv.includes('--profile')){win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Profiler.enable');await win.webContents.debugger.sendCommand('Profiler.start');}
 for(let i=0;i<4;i++){await pause(1000);const row=app.getAppMetrics().find(x=>x.pid===pid);if(row)cpu.push(row.cpu.percentCPUUsage);}
 const after=await win.webContents.executeJavaScript('overlayDiagnostics.getPerformance()');
 const result={...after,consoleErrors:errors,measuredRenders:after.renders-before.renders,measuredPolls:after.polls-before.polls,rendererCpuPercent:cpu.reduce((a,b)=>a+b,0)/cpu.length};
 if(process.argv.includes('--profile')){const {profile}=await win.webContents.debugger.sendCommand('Profiler.stop');win.webContents.debugger.detach();fs.writeFileSync(path.join(out,which+'.cpuprofile'),JSON.stringify(profile));result.hotspots=profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,15).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url,hits:n.hitCount,line:n.callFrame.lineNumber}));}
 if(which==='candidate'){
  result.paint=await win.webContents.executeJavaScript('overlayDiagnostics.getPaint()');
  result.workerVerified=await win.webContents.executeJavaScript(`(async()=>{const client=new TelemetryProcessor.Client(()=>{throw Error('unexpected worker fallback')},()=>new Worker('telemetry-worker.js'),true);const result=await client.run(overlayDiagnostics.getState(),performance.now());client.worker.terminate();return result.mode==='worker'&&result.view.fresh;})()`);
  if(!result.workerVerified)throw Error('Real worker failed');
  if(!['main','worker'].includes(after.processingMode)||after.errors||errors.length)throw Error('Worker renderer failed: '+JSON.stringify(result));
  fixture='body';await pause(1200);
  const view=await win.webContents.executeJavaScript('overlayDiagnostics.getAssist()');
  if(!view.fresh||!view.grip.wheels.every(w=>w.directions.lateral.available&&w.directions.lateral.shared))throw Error('IRSDK fixture did not reach the four rendered rails');
  fs.writeFileSync(path.join(out,'body-sideslip.png'),(await win.webContents.capturePage()).toPNG());
 }
 win.destroy();return result;
}
async function pixels(port){
 mode='candidate';const windows=[];
 for(const variant of ['reference','full','retained']){
  const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{backgroundThrottling:false}});windows.push(win);
  await win.loadURL('http://127.0.0.1:'+port+'/?qa=1'+(variant==='retained'?'&retained=1':variant==='reference'?'&materials=reference':''));await win.webContents.executeJavaScript('image.decode()');
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(r))');
  await win.webContents.executeJavaScript("window.__clock=1000;Object.defineProperty(performance,'now',{value:()=>window.__clock});");
 }
 const images=[];
 for(let step=0;step<8;step++){
  const input=state();input.angle=step?35:0;input.game.packet=step+1;input.game.sampleTime=1000+step*20;input.brake=step?80:0;
  input.game.wheels[0].angle=step?.3:0;
  if(step===4)input.connected=false;if(step===5)input.game.paused=true;
  for(const win of windows){
   await win.webContents.executeJavaScript(`__clock=${1000+step*20};overlayDiagnostics.setTestState(${JSON.stringify(input)},__clock);${step===2?"{const l=OverlayLayout.get();l.controls.frontResponse.x+=100;l.controls.frontResponse.opacity=.45;l.controls.frontResponse.z=-1;OverlayLayout.set(l);}":step===6?"{const l=OverlayLayout.get();l.controls.frontResponse.sx=.2;l.controls.frontResponse.sy=.2;l.controls.gBall.sx=.2;l.controls.gBall.sy=.2;OverlayLayout.set(l);}":''}overlayDiagnostics.renderTest(__clock);`);
  }
  await Promise.all(windows.map(w=>w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')));
  const captures=await Promise.all(windows.map(w=>w.webContents.capturePage()));
  captures.forEach((image,i)=>fs.writeFileSync(path.join(out,`paint-${step}-${i}.png`),image.toPNG()));
  const bitmaps=captures.map(image=>image.toBitmap());
  let total=0,large=0,materialTotal=0,materialLarge=0;for(let i=0;i<bitmaps[0].length;i++){const delta=Math.abs(bitmaps[1][i]-bitmaps[2][i]);total+=delta;if(delta>16)large++;const material=Math.abs(bitmaps[0][i]-bitmaps[1][i]);materialTotal+=material;if(material>16)materialLarge++;}
  const result={step,meanChannelError:total/bitmaps[0].length,largeErrorFraction:large/bitmaps[0].length,materialMeanError:materialTotal/bitmaps[0].length,materialLargeFraction:materialLarge/bitmaps[0].length};images.push(result);
  if(result.materialMeanError>.5||result.materialLargeFraction>.01)throw Error('Material cache differs from vector/reference: '+JSON.stringify(result));
  if(result.meanChannelError>.02||result.largeErrorFraction>.00001)throw Error('Retained/full paint differ: '+JSON.stringify(result));
 }
 const win=windows[2],before=await win.webContents.executeJavaScript('({...overlayDiagnostics.getPaint()})');
 await win.webContents.executeJavaScript('overlayDiagnostics.renderTest(__clock)');
 const after=await win.webContents.executeJavaScript('overlayDiagnostics.getPaint()');
 if(after.paints!==before.paints||after.composites!==before.composites)throw Error('Unchanged frame repainted');
 for(const win of windows)win.destroy();return {images,before,after};
}
async function recovery(port){
 mode='candidate';fixture='native';start=Date.now();
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 const inspect=()=>win.webContents.executeJavaScript('({performance:overlayDiagnostics.getPerformance(),packet:overlayDiagnostics.getState().game?.packet,fresh:overlayDiagnostics.getAssist().fresh})');
 async function until(test){const deadline=Date.now()+4000;while(Date.now()<deadline){const value=await inspect();if(test(value))return value;await pause(30);}throw Error('Stream recovery timed out');}
 try{
  await win.loadURL('http://127.0.0.1:'+port+'/');const initial=await until(x=>x.performance.transport==='events'&&x.fresh);
  suspendEvents=true;const silent=await until(x=>x.performance.transport==='http'&&x.fresh&&x.packet>initial.packet);
  suspendEvents=false;const resumed=await until(x=>x.performance.transport==='events'&&x.fresh&&x.packet>silent.packet);
  refuseEvents=true;for(const response of streams)response.end();const fallback=await until(x=>x.performance.transport==='http'&&x.fresh&&x.packet>resumed.packet);
  refuseEvents=false;const reconnected=await until(x=>x.performance.transport==='events'&&x.fresh&&x.packet>fallback.packet);
  const requests=reconnected.performance.network.count;await pause(250);const stable=await inspect();if(stable.performance.network.count!==requests)throw Error('HTTP polling continued alongside events');
  return {initial:initial.packet,silentFallback:silent.packet,resumed:resumed.packet,disconnectFallback:fallback.packet,reconnected:reconnected.packet,httpSuspended:true};
 }finally{refuseEvents=false;suspendEvents=false;win.destroy();}
}
async function nativeStream(){
 const portFile=path.join(out,`events-port-${process.pid}-${Date.now()}.txt`),exe=path.join(root,'build','telemetry-tests','Events.exe');
 const child=spawn(exe,['--serve',portFile],{windowsHide:true,stdio:'ignore'});let spawnError;child.on('error',e=>spawnError=e);let win;
 try{
  const deadline=Date.now()+3000;while(!fs.existsSync(portFile)){if(spawnError)throw spawnError;if(child.exitCode!==null||Date.now()>deadline)throw Error('Native stream fixture did not start');await pause(20);}
  const port=Number(fs.readFileSync(portFile,'utf8'));if(!(port>0&&port<65536))throw Error('Invalid fixture port');
  win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+port+'/');
  const rows=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const events=new EventSource('/events'),rows=[],timer=setTimeout(()=>{events.close();reject(Error('Native SSE timeout'));},3000);events.onerror=()=>{clearTimeout(timer);events.close();reject(Error('Native SSE failed'));};events.onmessage=event=>{rows.push(JSON.parse(event.data));if(rows.length===5){clearTimeout(timer);events.close();resolve(rows);}};})`);
  if(!rows.every((r,i)=>r.connected===true&&Number.isInteger(r.n)&&(i===0||r.n>rows[i-1].n)))throw Error('Native SSE delivered invalid/stale frames');
  return {received:rows.length,first:rows[0].n,last:rows.at(-1).n};
 }finally{if(win&&!win.isDestroyed())win.destroy();if(child.pid&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}if(fs.existsSync(portFile))fs.unlinkSync(portFile);}
}
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,results=process.argv.includes('--pixels-only')||process.argv.includes('--native-only')||process.argv.includes('--recovery-only')?{}:process.argv.includes('--body-only')?{candidate:await measure(port,'candidate')}:{baseline:await measure(port,'baseline'),candidate:await measure(port,'candidate')};
 if(!process.argv.includes('--perf-only')&&!process.argv.includes('--body-only')&&!process.argv.includes('--native-only')&&!process.argv.includes('--recovery-only')){fixture='native';results.pixels=await pixels(port);}
 if(process.argv.includes('--recovery-only'))results.recovery=await recovery(port);
 if(process.argv.includes('--native-only'))results.nativeStream=await nativeStream();
 results.workload={renderHz,inputHz:60,scene:process.argv.includes('--steady')?'steady controls':'changing steering and wheel slip',baselinePoll:'matched 60 Hz deadline; original algorithm/render'};
 fs.writeFileSync(path.join(out,`results-${renderHz}-${process.argv.includes('--recovery-only')?'recovery':process.argv.includes('--native-only')?'native':process.argv.includes('--pixels-only')?'pixels':process.argv.includes('--body-only')?'body':process.argv.includes('--steady')?'steady':'dynamic'}.json`),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));server.close();app.quit();
}).catch(error=>{console.error(error);server.close();app.exit(1);});
