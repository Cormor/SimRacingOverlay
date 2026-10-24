'use strict';
// Documentation-only renderer: seeded display fixtures, an offscreen Chromium
// surface and OffscreenCanvas PNG export. Never opens a device or live bridge.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs','images'),work=path.join(root,'build','readme-render');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(work,{recursive:true});
app.setPath('userData',path.join(work,'profile'));
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.commandLine.appendSwitch('no-proxy-server');
const requests=[],errors=[];
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(req.url.split('?')[0]).slice(1)||'index.html';requests.push(relative);
 if(relative==='favicon.ico'){res.writeHead(204);res.end();return;}
 if(relative==='state'||relative==='events'){res.writeHead(403);res.end();return;}
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
 res.setHeader('Content-Type',type+'; charset=utf-8');res.end(fs.readFileSync(file));
});
async function drawDocumentation(){
 const seed=0x52a6e120;let randomState=seed;
 const random=()=>{randomState|=0;randomState=randomState+0x6D2B79F5|0;let t=Math.imul(randomState^randomState>>>15,1|randomState);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
 const number=(a,b,d=2)=>Number((a+(b-a)*random()).toFixed(d)),integer=(a,b)=>Math.floor(number(a,b+.999,6));
 const colours=['#71e0b2','#72c9fa','#f4c46d','#f38cb4','#b9a6f8'];
 const stage={width:1100,height:1080,originX:25,originY:130,scale:1.05};
 OverlayLayout.setDesktopStage(stage);
 await image.decode();await document.fonts.ready;
 window.__readmeClock=10000;Object.defineProperty(performance,'now',{value:()=>__readmeClock});
 const mainData={};let renders=0;
 function fixture(options={}){
  __readmeClock+=300;const speed=number(128,186,1),rpm=integer(6150,7850),maxRpm=8500;
  const ratios=[-number(.18,.36),-number(.31,.54),number(.16,.28),number(.29,.45)];
  const wheels=ratios.map((ratio,i)=>({key:['FL','FR','RL','RR'][i],ratio,angle:(i<2?1:-1)*number(.035,.12,4),load:number(2100,3900,0),fx:number(-1800,1200,0),fy:number(-2600,2600,0),omega:speed/3.6/.31,pressurePsi:number(26,31),temperatureC:number(76,99),contactPoint:[i%2?.8:-.8,0,i<2?1.3:-1.3],contactNormal:[0,1,0],contactHeading:[.02,0,1]}));
  if(options.lock)Object.assign(wheels[0],{ratio:-number(.96,1,3),omega:number(.1,.4)});
  const state={connected:true,angle:number(-18,18),brake:options.lock?number(78,94):number(34,57),throttle:number(45,72),handbrake:options.handbrake?number(47,81):0,buttons:[19,32,26],knobPositions:Array.from({length:4},()=>integer(1,10)),paddleMode:'combined',leftPaddle:number(0,35),rightPaddle:number(0,35),ledSource:'offline-display-fixture',leds:{available:true,buttons:Array.from({length:8},()=>colours[integer(0,4)]),knobs:colours.slice(0,4),rpm:Array.from({length:16},(_,i)=>i<14?colours[Math.floor(i/4)]: '#11171e')},game:{available:true,source:'iRacing-SDK',packet:++renders,sampleTime:__readmeClock,carModel:'Offline documentation fixture',paused:false,inMenu:false,speedKmh:speed,rpm,maxRpm,rpmPercent:rpm/maxRpm*100,gear:integer(3,5),gas:.64,brake:.53,clutch:number(0,.08),steeringWheelAngle:.24,yawRate:.24,localVelocity:[.8,0,speed/3.6],accGFrame:'body',accG:[.72,1,-.61],wheels,statuses:{absActive:true,tcActive:true,escActive:true,sessionFlags:options.flag??0x100},shiftLights:{firstRpm:5200,shiftRpm:8000,lastRpm:8300,blinkRpm:8450}}};
  overlayDiagnostics.setTestState(state,__readmeClock);
  const axle=(left,right,air=false)=>({available:true,support:2,reason:'offline-display-fixture',reserve:{value:Math.min(left,right),low:.1,high:.95},currentReserve:{value:Math.min(left,right)},unloadedSides:[false,air],sides:[left,right].map((value,i)=>({available:true,value,current:value,unloaded:air&&i===1,directions:{lateral:{available:true,current:value,danger:1-value,estimate:{value:Math.max(.04,value-.12),evidence:.78}}}}))});
  const severity=number(.42,.86),front=axle(number(.18,.42),number(.32,.62),!!options.air),rear=axle(number(.55,.78),number(.68,.92));
  assistView={fresh:true,processedAt:__readmeClock,unloaded:[false,!!options.air,false,false],steering:{mode:'dynamic'},lateral:options.estimated?{front:null,rear:null}:{front:number(4.5,10.5),rear:-number(3.1,8.4)},drive:{severity:number(.37,.68)},brake:{severity:number(.28,.54)},decel:number(.65,1.24),handling:{state:options.handling||'understeer',severity},grip:{available:true,needle:.42,steeringState:{front:.68,rear:.32},axles:{front,rear},vehicleResponse:{slipAngleFront:number(4.5,9.4),slipAngleRear:-number(2.6,6.1)}}};
  const lateral=number(.55,.91),longitudinal=-number(.38,.72);
  gBallView={scale:1.8,current:{lateral,longitudinal,magnitude:Math.hypot(lateral,longitudinal)},trail:Array.from({length:96},(_,i)=>({lateral:Math.sin(i*.11)*(.4+i*.006),longitudinal:Math.cos(i*.075)*.7-.15})),peakOutline:Array.from({length:40},(_,i)=>{const a=i*Math.PI/20,r=1.1+.18*Math.sin(i*1.7);return {x:Math.cos(a)*r,y:Math.sin(a)*r};})};
  const value=OverlayLayout.clean({version:3,controls:OverlayLayout.preset().controls});
  const only=options.flagsOnly?['flags']:options.only;
  if(only)for(const id of Object.keys(value.controls))value.controls[id].enabled=only.includes(id);
  OverlayLayout.set(value);presentation=null;presentationAt=null;
  for(const lock of lockState){lock.since=0;lock.until=0;}
  overlayDiagnostics.renderTest(__readmeClock);
  if(options.lock){__readmeClock+=100;assistView.processedAt=__readmeClock;overlayDiagnostics.renderTest(__readmeClock);if(!(lockState[0].until>__readmeClock))throw Error('Lock fixture did not reach actual warning state');}
  if(!options.flagsOnly)for(const [id,value] of Object.entries({speed:state.game.speedKmh,rpm:state.game.rpm,gear:state.game.gear,brake:state.brake,throttle:state.throttle,decel:assistView.decel,gForce:gBallView.current.magnitude}))if(!Number.isFinite(value))throw Error('Missing fixture value '+id);
  if(options.main)Object.assign(mainData,{state,display:{handling:assistView.handling,lateral:assistView.lateral,decel:assistView.decel,axles:assistView.grip.axles,gForce:gBallView}});
 }
 const font='"Segoe UI","Microsoft YaHei UI",sans-serif';
 function sheet(width,height,title,subtitle){const surface=new OffscreenCanvas(width,height),c=surface.getContext('2d');const gradient=c.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#101c2b');gradient.addColorStop(1,'#080f19');c.fillStyle=gradient;c.fillRect(0,0,width,height);c.textBaseline='middle';c.fillStyle='#eef6ff';c.font=`600 40px ${font}`;c.fillText(title,38,49);c.fillStyle='#9fb3c9';c.font=`22px ${font}`;c.fillText(subtitle,40,91);return {surface,c};}
 function world(c,box,rect){const rx=canvas.width/stage.width,ry=canvas.height/stage.height;c.drawImage(canvas,(stage.originX+box.x*stage.scale)*rx,(stage.originY+box.y*stage.scale)*ry,box.w*stage.scale*rx,box.h*stage.scale*ry,rect.x,rect.y,rect.w,rect.h);}
 function card(c,x,y,w,h,title,desc){c.fillStyle='#142132';c.strokeStyle='#2d435b';c.lineWidth=1;c.beginPath();c.roundRect(x,y,w,h,16);c.fill();c.stroke();c.fillStyle='#e5f2ff';c.font=`600 28px ${font}`;c.fillText(title,x+22,y+32);c.fillStyle='#9fb3c9';c.font=`19px ${font}`;c.fillText(desc,x+22,y+65);}
 async function encode(surface){const blob=await surface.convertToBlob({type:'image/png'});return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});}
 const hero=sheet(1200,1260,'SimRacingOverlay','离线模拟数据 · 仪表、输入、四轮反馈与驾驶状态');
 fixture({main:true,flag:0x100,handling:'understeer'});hero.c.drawImage(canvas,50,126,1100,1080);hero.c.fillStyle='#879eb6';hero.c.font=`20px ${font}`;hero.c.fillText('模拟数值组合展示不同数据源支持的组件与状态',40,1225);
 const overview=await encode(hero.surface);
 const states=sheet(1680,950,'驾驶状态示例','独立场景离屏渲染 · 转向状态、轮胎异常与辅助触发');
 const width=(1680-56-36)/3;
 const handlingCases=[['四轮侧滑','前后轴共同滑移 · 红旗','both',0x10],['转向过度','甩尾提示 · 蓝旗让车','oversteer',0x20],['车身侧摆','侧摆提示 · 维修旗','sway',0x100000]];
 handlingCases.forEach(([title,desc,handling,flag],i)=>{const x=28+i*(width+18);card(states.c,x,120,width,294,title,desc);fixture({handling,flag,estimated:true,only:['frontResponse','rearResponse','frontLateral','handling','flags']});world(states.c,{x:30,y:-105,w:940,h:270},{x:x+18,y:220,w:width-36,h:(width-36)*270/940});});
 const detailCases=[['车轮锁死','持续锁死的红色整轮警示',{lock:true,only:['slip0']},{x:100,y:163,w:230,h:284}],['车轮离地','轮胎卸载后的白色空框',{air:true,only:['slip1']},{x:680,y:160,w:230,h:300}],['手刹与电子辅助','手刹、减速度、ABS / TC / ESC',{handbrake:true,only:['handbrake','decel','statuses']},{x:255,y:490,w:490,h:365}]];
 detailCases.forEach(([title,desc,options,box],i)=>{const x=28+i*(width+18);card(states.c,x,432,width,454,title,desc);fixture(options);const scale=Math.min((width-42)/box.w,340/box.h);world(states.c,box,{x:x+(width-box.w*scale)/2,y:525,w:box.w*scale,h:box.h*scale});});
 states.c.fillStyle='#879eb6';states.c.font=`20px ${font}`;states.c.fillText('数值采用固定随机种子；状态分别触发，便于查看不同提示',38,922);
 const statePng=await encode(states.surface);
 const flags=sheet(1680,620,'旗语与行动提示','12 种独立旗语状态 · 使用真实中文映射与优先级');
 const flagCases=Flags.DEF.slice();
 flagCases.forEach((flag,i)=>{const x=28+(i%4)*410,y=125+Math.floor(i/4)*154;flags.c.fillStyle='#142132';flags.c.beginPath();flags.c.roundRect(x,y,394,138,14);flags.c.fill();fixture({flagsOnly:true,flag:flag.bits});world(flags.c,{x:365,y:-94,w:270,h:74},{x:x+22,y:y+25,w:350,h:350*74/270});});
 const flagsPng=await encode(flags.surface);
 return {images:{'overview.png':overview,'states.png':statePng,'flags.png':flagsPng},metadata:{seed:'0x'+seed.toString(16),method:'offscreen BrowserWindow + actual application renderer + OffscreenCanvas.convertToBlob',liveBridgeAccess:false,dimensions:{'overview.png':[1200,1260],'states.png':[1680,950],'flags.png':[1680,620]},stateCases:['understeer','both','oversteer','sway','wheel-lock','airborne','handbrake','ABS','TC','ESC'],flagCases:flagCases.map(f=>f.name),mainFixture:mainData}};
}
let win;
app.whenReady().then(async()=>{
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  win=new BrowserWindow({show:false,frame:false,width:1100,height:1080,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  win.webContents.session.webRequest.onBeforeRequest((details,done)=>done({cancel:!details.url.startsWith(origin+'/')&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
  await win.loadURL(origin+'/?qa=1');
  const result=await win.webContents.executeJavaScript(`(${drawDocumentation.toString()})()`,true);
  assert(!requests.includes('state')&&!requests.includes('events'),'offline render must never contact a live bridge');
  assert.equal(errors.length,0,JSON.stringify(errors));
  for(const [name,data] of Object.entries(result.images)){const bytes=Buffer.from(data,'base64');assert(bytes.length>12000,name);assert.equal(bytes.subarray(1,4).toString(),'PNG');fs.writeFileSync(path.join(out,name),bytes);}
  fs.writeFileSync(path.join(work,'render-data.json'),JSON.stringify({...result.metadata,requests,errors},null,2)+'\n');
  console.log(JSON.stringify({images:Object.keys(result.images),dimensions:result.metadata.dimensions,states:result.metadata.stateCases,flags:result.metadata.flagCases.length,errors}));
 }catch(error){console.error(error);process.exitCode=1;}
 finally{win?.destroy();server.close();app.exit(process.exitCode||0);}
});
