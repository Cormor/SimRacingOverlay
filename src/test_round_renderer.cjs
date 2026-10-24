// Hidden Electron visual regression. Synthetic input only; no bridge/device access.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build','round-clock');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.commandLine.appendSwitch('no-proxy-server');
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(req.url.split('?')[0]).slice(1)||'index.html';
 if(relative.includes('..')){res.writeHead(403);res.end();return;}
 const file=path.join(root,relative);
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.png')?'image/png':relative.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
});
const windows=[],errors=[];
async function run(port){
 for(const retained of [false,true]){
  const win=new BrowserWindow({show:false,width:1000,height:850,transparent:true,backgroundColor:'#00000000',webPreferences:{backgroundThrottling:false}});windows.push(win);
  win.webContents.on('console-message',(_event,details)=>{if(details?.level==='error')errors.push(details.message);});
  await win.loadURL(`http://127.0.0.1:${port}/?qa=1${retained?'&retained=1':''}`);
  await win.webContents.executeJavaScript('image.decode()');
  await win.webContents.executeJavaScript("OverlayLayout.setDesktopStage({width:1000,height:850,originX:0,originY:0,scale:1});window.__clock=1000;Object.defineProperty(performance,'now',{value:()=>__clock});");
 }
 const geometry=[];
 // Inspect the actual rendered wheel, not the rectangular PNG container.
 for(let angle=0;angle<360;angle+=15){
  const row=await windows[0].webContents.executeJavaScript(`(()=>{
   const l=OverlayLayout.get();for(const c of Object.values(l.controls))c.opacity=0;l.controls.wheel.opacity=1;OverlayLayout.set(l);
   overlayDiagnostics.setTestState({connected:true,angle:${angle},buttons:[],leds:{available:true,buttons:Array(20).fill('#000000'),knobs:Array(4).fill('#000000')}},1000);
   overlayDiagnostics.renderTest(1000);
   const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let left=c.width,right=-1,top=c.height,bottom=-1;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>200){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   const sx=c.width/1000,sy=c.height/850;return {angle:${angle},left,right,top,bottom,width:(right-left+1)/sx,height:(bottom-top+1)/sy,cx:(left+right)/2/sx,cy:(top+bottom)/2/sy};
  })()`);geometry.push(row);
 }
 const diameters=geometry.flatMap(x=>[x.width,x.height]),centers=geometry.map(x=>Math.hypot(x.cx-500,x.cy-450));
 const roundness={minDiameter:Math.min(...diameters),maxDiameter:Math.max(...diameters),maxCenterOffset:Math.max(...centers)};
 fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({roundness,geometry},null,2));
 assert(roundness.maxDiameter-roundness.minDiameter<=1.5,JSON.stringify(roundness));
 assert(roundness.maxCenterOffset<1,JSON.stringify(roundness));
 const comparisons=[];
 for(let step=0;step<15;step++){
  for(const win of windows)await win.webContents.executeJavaScript(`{
   __clock=${2000+step*100};const l=OverlayLayout.get();for(const c of Object.values(l.controls))c.opacity=1;
   if(${step}===3){l.controls.wheel.opacity=.45;l.controls.wheel.z=-1;l.controls.frontResponse.x=100;}
   if(${step}===5){l.controls.wheel.sx=.2;l.controls.wheel.sy=.2;}
   if(${step}===6){l.controls.wheel.sx=1;l.controls.wheel.sy=1;l.controls.wheel.x=100;}
   if(${step}===9){l.controls.frontResponse.rotation=37;l.controls.brake.rotation=-15;}
   if(${step}===10){l.controls.brake.enabled=false;l.controls.frontResponse.enabled=false;}
   if(${step}===11){l.controls.brake.enabled=true;l.controls.frontResponse.enabled=true;}
   if(${step}===12){l.controls.flags.y=160;l.controls.flags.rotation=12;}
   if(${step}===14){l.controls.flags.enabled=false;}
   OverlayLayout.set(l);overlayDiagnostics.setTestState({connected:${step!==7},angle:${step*45},brake:${step*10},throttle:30,buttons:[19,26],knobPositions:[2,3,4,5],game:${step>=12?`{available:true,source:'iRacing-SDK',packet:${step},speedKmh:0,statuses:{sessionFlags:${step===13?'0':'8'}}}`:'{available:false}'}},__clock);overlayDiagnostics.renderTest(__clock);
  }`);
  await Promise.all(windows.map(w=>w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')));
  const captures=await Promise.all(windows.map(w=>w.webContents.capturePage()));
  const [a,b]=captures.map(c=>c.toBitmap());let total=0,large=0;assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;if(d>16)large++;}
  const row={step,meanChannelError:total/a.length,largeErrorFraction:large/a.length};comparisons.push(row);
  assert(row.meanChannelError<.05&&row.largeErrorFraction<.00005,JSON.stringify(row));
  if(step<4)fs.writeFileSync(path.join(out,`wheel-${step*45}.png`),captures[1].toPNG());
 }
 const before=await windows[1].webContents.executeJavaScript('overlayDiagnostics.getPaint()');
 await windows[1].webContents.executeJavaScript('overlayDiagnostics.paintTest();overlayDiagnostics.paintTest();');
 const after=await windows[1].webContents.executeJavaScript('overlayDiagnostics.getPaint()');
 assert.equal(after.composites,before.composites,'identical prepared scene retains pixels');
 assert.equal(errors.length,0,JSON.stringify(errors));
 const result={roundness,geometry,comparisons,static:{before,after},errors};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({roundness,comparisons,static:result.static,errors}));
}
app.whenReady().then(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));await run(server.address().port);}catch(e){console.error(e);process.exitCode=1;}finally{for(const w of windows)w.destroy();server.close();app.exit(process.exitCode||0);}});
