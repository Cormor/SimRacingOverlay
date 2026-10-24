'use strict';
const canvas=document.getElementById('overlay'),nativeContext=canvas.getContext('2d');
let ctx=typeof OpacityPaint!=='undefined'?OpacityPaint.wrap(nativeContext,kind=>layout.drawOpacity?.(kind)??1):nativeContext;
const image=new Image();image.src='assets/wheel.png';
let roundWheelBitmap=null;
function wheelImage(){
 if(roundWheelBitmap||!image.complete||!image.naturalWidth)return roundWheelBitmap||image;
 // Keep the leather photograph and hub. Trim its irregular outer contour to an
 // exact circle after the calibrated X correction; cache once, not per frame.
 if(typeof document.createElement!=='function')return image;
 const bitmap=document.createElement('canvas');bitmap.width=image.naturalWidth;bitmap.height=image.naturalHeight;
 const paint=bitmap.getContext('2d');paint.beginPath();paint.ellipse(655,602.5,562*1158/1139,562,0,0,Math.PI*2);paint.clip();paint.drawImage(image,0,0);
 roundWheelBitmap=bitmap;return bitmap;
}

let wheelFaceBitmap=null,wheelFaceKey=null,wheelFaceDensity=0;
const wheelFaceStats={builds:0,reuses:0};
function paintWheelFace(key,draw){
 const t=ctx.getTransform?.();
 if(!t||typeof document.createElement!=='function'){draw();return;}
 const density=Math.ceil((Math.max(Math.hypot(t.a,t.b),Math.hypot(t.c,t.d))-1e-6)*4)/4;
 const w=Math.ceil(1315*density),h=Math.ceil(1197*density);
 if(!(density>0)||w*h>8*1024*1024){draw();return;}
 const style=layout.drawOpacity?.('image')+':'+layout.drawOpacity?.('text');
 key=key+':'+style;
 if(!wheelFaceBitmap||wheelFaceKey!==key||wheelFaceDensity!==density){
  if(!wheelFaceBitmap)wheelFaceBitmap=document.createElement('canvas');
  wheelFaceBitmap.width=w;wheelFaceBitmap.height=h;
  const native=wheelFaceBitmap.getContext('2d');native.setTransform(w/1315,0,0,h/1197,0,0);
  const previous=ctx;ctx=typeof OpacityPaint!=='undefined'?OpacityPaint.wrap(native,kind=>layout.drawOpacity?.(kind)??1):native;
  try{draw();}finally{ctx=previous;}
  wheelFaceKey=key;wheelFaceDensity=density;wheelFaceStats.builds++;
 }else wheelFaceStats.reuses++;
 // Component opacity is already applied while baking its text/image commands.
 nativeContext.drawImage(wheelFaceBitmap,0,0,1315,1197);
}
const params=new URLSearchParams(location.search),demo=params.get('demo')==='1',qa=params.get('qa')==='1';
let paintScale=1;
let state={connected:false},lastGood=0,angle=0,qaClock=null;
let paintAngle=0,displayLastAt=null,lastPaintSignature=null;
const visualSteering={from:0,to:0,at:null,duration:0};
function steeringAt(now){const v=visualSteering;if(v.at===null)return angle;const f=v.duration>0?Math.max(0,Math.min(1,(now-v.at)/v.duration)):1;return v.from+(v.to-v.from)*f;}
function observeSteering(s,now){
 const target=s?.connected&&Number.isFinite(s.angle)?s.angle:0,v=visualSteering;
 const gap=v.at===null?Infinity:now-v.at;
 v.from=gap>100||gap<0?target:steeringAt(now);v.to=target;v.at=now;v.duration=gap>100||gap<=0?0:Math.min(30,Math.max(4,gap));
}
const UI=typeof OverlayTheme!=='undefined'?OverlayTheme:{font:'Consolas,"Microsoft YaHei UI",monospace',colors:{text:'#edf5ff',muted:'#a4b7cc',track:'#1c2938',border:'#73879d',panel:'#111923',accent:'#62d9ff',brake:'#ff5673',throttle:'#65e3ad',warning:'#ffc75a',danger:'#ff365d',estimateFront:'#83d7f2',estimateRear:'#f6bd84'},sizes:{caption:16,label:20,value:32,secondary:24,primary:28,headline:40,wheelKnob:29,wheelButton:23,flagTitle:28,flagHint:18}};
const uiInfo={version:'ue-editor-v1',ambientKnobs:false,ambientButtons:false,waiting:false};
const assistModel=new DrivingAssist.Model({storage:qa||typeof localStorage==='undefined'?null:localStorage});let assistView={fresh:false,unloaded:[false,false,false,false]};
const processor=!qa&&!demo&&typeof TelemetryProcessor!=='undefined'?new TelemetryProcessor.Client((s,now)=>assistModel.update(s,now)):null;
// Fixed-size counters, no per-frame logging. Recording derives rates from counter deltas.
const runtimePerf={startedAt:performance.now(),polls:0,errors:0,renders:0,uniquePackets:0,lastPacket:null,algorithm:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)},network:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)}};
const costBounds=[.1,.25,.5,1,2,4,8,16,32,64,Infinity];
function observeCost(kind,ms){const c=runtimePerf[kind];c.count++;c.totalMs+=ms;c.maxMs=Math.max(c.maxMs,ms);c.buckets[costBounds.findIndex(b=>ms<=b)]++;}
function getPerformance(){const elapsedMs=performance.now()-runtimePerf.startedAt;const cost=c=>({count:c.count,totalMs:c.totalMs,maxMs:c.maxMs,buckets:c.buckets.slice()});return {elapsedMs,polls:runtimePerf.polls,errors:runtimePerf.errors,renders:runtimePerf.renders,displayFrames:runtimePerf.displayFrames||0,displayElapsed:runtimePerf.displayElapsed||0,slowDisplayFrames:runtimePerf.slowDisplayFrames||0,prepares:runtimePerf.prepares||0,uniquePackets:runtimePerf.uniquePackets,processingMode:runtimePerf.processingMode||'main',transport:streaming?'events':'http',streamFrames:runtimePerf.streamFrames||0,coalescedFrames:runtimePerf.coalescedFrames||0,algorithm:cost(runtimePerf.algorithm),network:cost(runtimePerf.network),bucketUpperMs:costBounds.map(b=>Number.isFinite(b)?b:null)};}
const gBallModel=typeof GBall!=='undefined'?new GBall.Model(qa?null:window.sessionStorage):null;let gBallView=null;
const layout=typeof OverlayLayout!=='undefined'?OverlayLayout:{begin(){},group(id,draw){draw();},flush(){}};
if(params.has('stage')&&typeof OverlayLayout!=='undefined'){try{OverlayLayout.setDesktopStage(JSON.parse(params.get('stage')));}catch{}}
const latch={};
const lockState=[{},{},{},{}];
const knobPositions=[null,null,null,null];
const controls=[
 {x:400,y:381,r:26,b:[19],led:0},{x:430,y:711,r:26,b:[20],led:1},
 {x:493,y:747,r:26,b:[21],led:2},{x:526,y:807,r:26,b:[22],led:3},
 {x:784,y:807,r:26,b:[35],led:4},{x:820,y:747,r:26,b:[34],led:5},
 {x:883,y:711,r:26,b:[33],led:6},{x:913,y:381,r:26,b:[32],led:7},
 {x:441,y:435,r:18,b:[1,5,6,7,8]},{x:871,y:435,r:18,b:[2,9,10,11,12]},
 {x:328,y:443,r:18,b:[24,45,46]},{x:985,y:443,r:18,b:[37,47,48]},
 {x:236,y:503,r:20,b:[13]},{x:1078,y:503,r:20,b:[14]},
 {x:247,y:748,r:24,b:[15],axis:'leftPaddle'},{x:1066,y:748,r:24,b:[16],axis:'rightPaddle'},
 {x:306,y:361,r:13,b:[17,23]},{x:1006,y:361,r:13,b:[18,36]}
];
const encoders=[{x:359,y:766,b:[26,27],first:53,led:8},{x:476,y:878,b:[39,40],first:89,led:9},{x:837,y:878,b:[30,31],first:77,led:10},{x:954,y:766,b:[28,29],first:65,led:11}];
const ledShapes=[{"led": 0, "points": [[481, 338], [482, 337], [492, 331], [496, 329], [498, 331], [498, 348], [497, 349], [495, 349], [492, 347], [482, 340], [481, 339]]}, {"led": 1, "points": [[475, 344], [476, 343], [477, 343], [492, 354], [496, 357], [496, 358], [495, 359], [476, 359], [475, 358]]}, {"led": 2, "points": [[481, 366], [483, 365], [496, 365], [498, 367], [498, 384], [496, 386], [491, 381], [481, 368]]}, {"led": 3, "points": [[533, 319], [535, 317], [542, 316], [552, 315], [554, 315], [555, 316], [555, 318], [551, 326], [549, 328], [541, 328], [536, 323]]}, {"led": 4, "points": [[559, 324], [563, 316], [565, 314], [575, 314], [577, 316], [581, 322], [581, 324], [580, 325], [576, 326], [564, 327], [560, 327], [559, 326]]}, {"led": 5, "points": [[583, 314], [584, 313], [593, 312], [604, 312], [605, 313], [600, 323], [599, 324], [592, 325], [591, 325], [588, 322], [585, 318], [583, 315]]}, {"led": 6, "points": [[608, 322], [609, 320], [613, 313], [614, 312], [623, 311], [626, 314], [630, 320], [630, 323], [609, 323]]}, {"led": 7, "points": [[633, 312], [634, 311], [652, 311], [653, 312], [653, 313], [652, 322], [651, 323], [650, 323], [640, 322], [637, 319], [634, 315], [633, 313]]}, {"led": 8, "points": [[660, 311], [679, 311], [680, 312], [680, 313], [676, 319], [672, 323], [662, 323], [660, 322]]}, {"led": 9, "points": [[682, 322], [683, 320], [687, 314], [690, 311], [695, 311], [699, 312], [700, 313], [703, 318], [705, 322], [705, 323], [703, 324], [683, 323]]}, {"led": 10, "points": [[708, 313], [709, 312], [720, 312], [729, 313], [729, 316], [724, 323], [723, 324], [714, 324], [713, 323], [708, 314]]}, {"led": 11, "points": [[732, 323], [733, 321], [737, 315], [738, 314], [744, 314], [749, 315], [750, 316], [754, 324], [754, 326], [753, 327], [750, 327], [738, 326], [732, 325]]}, {"led": 12, "points": [[757, 317], [758, 316], [766, 316], [777, 317], [779, 319], [778, 321], [774, 326], [772, 328], [764, 328], [762, 327]]}, {"led": 13, "points": [[815, 330], [816, 329], [817, 329], [819, 330], [826, 334], [831, 337], [832, 338], [829, 341], [819, 348], [817, 349], [815, 349]]}, {"led": 14, "points": [[817, 357], [819, 355], [834, 344], [836, 343], [837, 343], [838, 344], [838, 358], [837, 359], [819, 359], [817, 358]]}, {"led": 15, "points": [[815, 366], [816, 365], [820, 365], [831, 366], [831, 368], [830, 370], [827, 374], [820, 383], [817, 386], [816, 386], [815, 385]]}];
function text(s,x,y,size=UI.sizes.primary,color=UI.colors.text){ctx.font=`600 ${size}px ${UI.font}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=Math.max(2,size*.09);ctx.strokeStyle=UI.colors.panel;ctx.strokeText(s,x,y);ctx.fillStyle=color;ctx.fillText(s,x,y);}
function circle(x,y,r,fill,stroke='#151820',width=5){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
function emittedColor(v){return typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)&&v.toLowerCase()!=='#000000'?v:null;}
// Dusty rose -> apricot -> sage -> teal -> blue -> lilac: no saturated RGB bands.
const ambientPalette=UI.palettes?.ambient||['#e5a0b0','#e6b184','#e0cd83','#aed498','#8bd3bc','#91bfe6','#b4aae6','#d5a4df'];
function shiftLightColors(game,now){
 if(!game?.available)return null;
 const shift=game.shiftLights,rpm=game.rpm,start=shift?.firstRpm,end=shift?.lastRpm;
 const fraction=Number.isFinite(shift?.indicator)?Math.max(0,Math.min(1,shift.indicator)):Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Number.isFinite(rpm)?Math.max(0,Math.min(1,(rpm-start)/(end-start))):null;
 if(fraction===null)return null;
 const blink=Number.isFinite(shift?.blinkRpm)&&Number.isFinite(rpm)&&rpm>=shift.blinkRpm;
 return {source:Number.isFinite(shift?.indicator)?'game-shift-indicator':'game-shift-thresholds',colors:ledShapes.map((_,i)=>i<Math.ceil(fraction*ledShapes.length)?(blink?(Math.floor(now/100)%2?'#ff314d':'#28050b'):i>=13?'#d39ce0':i>=9?'#ebc777':'#8dcdb8'):'#11171e')};
}
function buttonLightsAvailable(led){return led?.available===true&&Array.isArray(led.buttons)&&led.buttons.some(v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v));}
function ambientButtonColor(c,now,alert=false){
 const phase=((now/6500+(c.x-200)/1200+(c.y-300)/1500)%1+1)%1*ambientPalette.length;
 const i=Math.floor(phase),t=phase-i,smooth=t*t*(3-2*t);
 const color=rgbMix(ambientPalette[i],ambientPalette[(i+1)%ambientPalette.length],smooth);
 return rgbMix('#35414d',color,1-.4*Math.max(0,Math.min(1,Number(alert)||0)));
}
// Pending is a GAME STREAM condition, never a lighting or input-device condition.
let telemetryPresence={packet:null,key:null,lastAdvance:null};
function telemetryWaiting(g,now){
 if(telemetryPresence.lastAdvance!==null&&now<telemetryPresence.lastAdvance)telemetryPresence={packet:null,key:null,lastAdvance:null};
 if(g?.available===true&&Number.isInteger(g.packet)){
  const key=String(g.source||'')+':'+String(g.carModel||'');
  if(g.packet!==telemetryPresence.packet||key!==telemetryPresence.key){telemetryPresence={packet:g.packet,key,lastAdvance:now};}
 }
 uiInfo.telemetryAgeMs=telemetryPresence.lastAdvance===null?null:Math.max(0,now-telemetryPresence.lastAdvance);
 return telemetryPresence.lastAdvance===null||now-telemetryPresence.lastAdvance>1500;
}
function waitingBadge(waiting){
 if(!waiting)return;
 ctx.save();ctx.fillStyle='#14202ee8';ctx.strokeStyle='#91a2b6';ctx.lineWidth=1.5;
 ctx.beginPath();ctx.roundRect(446,268,108,30,9);ctx.fill();ctx.stroke();ctx.restore();
 text('待数据',500,283,UI.sizes.secondary,'#d9e4ef');
}
function buttonCap(c,color,ambient=false){
 const glow=emittedColor(color),base=ctx.createRadialGradient(c.x-8,c.y-10,2,c.x,c.y,c.r);base.addColorStop(0,'#38434f');base.addColorStop(1,'#121922');
 circle(c.x,c.y,c.r+2,'#090d12','#536170',2);circle(c.x,c.y,c.r,base,'#0a0e14',3);
 if(glow){ctx.save();ctx.shadowColor=glow;ctx.shadowBlur=(ambient?16:8)*paintScale;circle(c.x,c.y,c.r-3,glow,'#ffffff44',1.5);ctx.restore();}
 else{ctx.beginPath();ctx.arc(c.x,c.y,c.r-4,Math.PI*1.12,Math.PI*1.82);ctx.strokeStyle='#6d798777';ctx.lineWidth=2;ctx.stroke();}
}
function bar(x,value,color,label,online){online=online&&Number.isFinite(value);const y=230,h=440,w=38;ctx.lineJoin='round';ctx.lineWidth=6;ctx.strokeStyle='#07090d';ctx.fillStyle='#20252de0';ctx.beginPath();ctx.roundRect(x-w/2,y,w,h,12);ctx.fill();ctx.stroke();if(online){ctx.save();ctx.beginPath();ctx.roundRect(x-w/2+5,y+5,w-10,h-10,8);ctx.clip();ctx.fillStyle=color;const fill=(h-10)*Math.max(0,Math.min(100,value))/100;if(fill>0){ctx.beginPath();ctx.roundRect(x-w/2+5,y+h-5-fill,w-10,fill,Math.min(8,fill/2));ctx.fill();}ctx.restore();}text(label,x,y-43,UI.sizes.value||32);text(online?`${Math.round(value).toString().padStart(3,' ')}%`:'—',x,y+h+40,UI.sizes.value);}
function statuses(s,online,advance=true){
 const st={...(s.game?.statuses||{})},now=performance.now();
 for(const key of ['absActive','tcActive','escActive']){if(advance&&online&&st[key]===true)latch[key]=now+220;if(online&&now<(latch[key]||0))st[key]=true;}
 const active=online&&s.game?.available&&s.game.paused!==true&&s.game.inMenu!==true?[
  ['ABS',st.absActive],['TC',st.tcActive===true],['ESC',st.escActive],['水温',st.waterTempWarning],['油压',st.oilPressureWarning],['油路',st.fuelPressureWarning],['熄火',st.engineStalled],['限速',st.pitLimiterActive],['离轨',st.trackSurface===0]
 ].filter(x=>x[1]===true).slice(0,3).map(x=>x[0]):[];
 for(let i=0;i<active.length;i++){const label=active[i],x=500+(i-(active.length-1)/2)*156,y=826,color='#ffda56';ctx.fillStyle='#473c13f0';ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(x-73,y-21,146,42,11);ctx.fill();ctx.stroke();
  ctx.save();ctx.translate(x-45,y);ctx.strokeStyle=color;ctx.lineWidth=2.5;
  if(label==='ABS'){ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,0,17,-1.1,1.1);ctx.stroke();ctx.beginPath();ctx.arc(0,0,17,Math.PI-1.1,Math.PI+1.1);ctx.stroke();text('!',0,0,18,color);}
  else{ctx.strokeRect(-10,-11,20,15);ctx.beginPath();ctx.moveTo(-6,5);ctx.bezierCurveTo(-18,8,-1,11,-14,15);ctx.moveTo(9,5);ctx.bezierCurveTo(-4,8,14,11,2,15);ctx.stroke();}ctx.restore();text(label,x+18,y,UI.sizes.secondary,color);
 }
}
// Percentage is always raw slip ratio × 100. Colour is a visual scale, not an optimum-grip target.
const slipPalettes=UI.palettes?.slip||{
 drive:[[0,'#6ef4df'],[.10,'#65f3b2'],[.25,'#c9f45b'],[.50,'#ffe15b'],[.75,'#ffac45'],[1,'#ff6ac7'],[1.5,'#dc74ff'],[2.5,'#aa87ff'],[4,'#7bb8ff']],
 brake:[[0,'#6ef4df'],[.10,'#66d9ff'],[.25,'#8fafff'],[.50,'#c48aff'],[.75,'#e575ec'],[1,'#ff70bb'],[1.5,'#d276ff'],[2.5,'#9b8cff'],[4,'#73c1ff']]
};
const LOCK_RED='#ff1024';
function slipColor(magnitude,braking){
 const stops=slipPalettes[braking?'brake':'drive'],v=Math.max(0,magnitude);
 for(let i=1;i<stops.length;i++)if(v<=stops[i][0]){
  const a=stops[i-1],b=stops[i],t=(v-a[0])/(b[0]-a[0]),smooth=t*t*(3-2*t);
  const rgb=hex=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
  const ca=rgb(a[1]),cb=rgb(b[1]);return '#'+ca.map((c,n)=>Math.round(c+(cb[n]-c)*smooth).toString(16).padStart(2,'0')).join('');
 }
 return stops[stops.length-1][1];
}
function slipLength(magnitude){
 // Power scale keeps small slips readable; reserve 10% of the length for >100%.
 return 105*(.9*Math.pow(Math.min(1,Math.max(0,magnitude)),.32)+.1*(1-Math.exp(-Math.max(0,magnitude-1)/1.5)));
}
function lockSurround(bx,tx,zero){
 // One whole wheel-position indicator, including BOTH directions, value and open corner marks.
 const left=Math.min(bx-20,tx-59),right=Math.max(bx+20,tx+59),top=zero-115,bottom=zero+115;
 const halo=ctx.createRadialGradient((left+right)/2,zero,10,(left+right)/2,zero,135);
 halo.addColorStop(0,'#ff102420');halo.addColorStop(.65,'#ff10240c');halo.addColorStop(1,'#ff102400');
 ctx.fillStyle=halo;ctx.fillRect(left-30,top-20,right-left+60,bottom-top+40);
 ctx.strokeStyle=LOCK_RED;ctx.lineWidth=4;ctx.lineCap='round';ctx.shadowColor=LOCK_RED;ctx.shadowBlur=(18)*paintScale;
 ctx.beginPath();for(const x of [left,right])for(const y of [top,bottom]){const dx=x===left?1:-1,dy=y===top?1:-1;ctx.moveTo(x,y+dy*19);ctx.lineTo(x,y);ctx.lineTo(x+dx*17,y);}ctx.stroke();
}
function advanceWheelLock(s,online,a,i,now){
 const w=s.game?.wheels?.[i],nativeRatio=Number.isFinite(w?.ratio),valid=online&&s.game?.available&&s.game.paused!==true&&s.game.inMenu!==true&&nativeRatio;
 const airborne=a.fresh&&a.unloaded?.[i];
 if(airborne){lockState[i].since=0;lockState[i].until=0;}
 const stoppedRolling=Number.isFinite(w?.omega)?Math.abs(w.omega)<2.5:Number.isFinite(w?.speedMs)&&Math.abs(w.speedMs)<.75;
 const candidate=valid&&!airborne&&Math.abs(s.game.speedKmh)>=10&&s.game.brake>.15&&w.ratio<=-.8&&stoppedRolling;
 if(candidate){if(!lockState[i].since)lockState[i].since=now;if(now-lockState[i].since>=80)lockState[i].until=now+300;}else lockState[i].since=0;
}
function wheelSlip(s,online,a=assistView,only=null,advance=true){
 const wheels=s.game?.wheels||[],now=performance.now();
 for(let i=0;i<4;i++){
  if(only!==null&&i!==only)continue;
  const w=wheels[i],nativeRatio=Number.isFinite(w?.ratio),reported=nativeRatio?w.ratio:w?.slipFeedback,valid=online&&s.game?.available&&s.game.paused!==true&&s.game.inMenu!==true&&Number.isFinite(reported),ratio=valid?reported:0,zero=i<2?295:645;
  const airborne=a.fresh&&a.unloaded[i];
  if(advance)advanceWheelLock(s,online,a,i,now);
  const isLocked=valid&&now<(lockState[i].until||0),magnitude=Math.abs(ratio),braking=ratio<0;
  const color=isLocked?LOCK_RED:!valid?'#8591a4':slipColor(magnitude,braking);
  const bx=i%2?842:158,tx=i%2?758:242,extent=105,width=24,fill=slipLength(magnitude);
  ctx.save();
  if(airborne){
   // No fill, zero line or percentage: a whole empty white outline has priority over wheelspin/lock.
   ctx.strokeStyle='#f5fbff';ctx.lineWidth=4;ctx.shadowColor='#e8f6ff';ctx.shadowBlur=(20)*paintScale;
   ctx.beginPath();ctx.roundRect(bx-width/2,zero-extent,width,extent*2,10);ctx.stroke();ctx.restore();continue;
  }
  if(isLocked)lockSurround(bx,tx,zero);
  ctx.lineCap='round';ctx.strokeStyle='#07101b';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(bx,zero-extent);ctx.lineTo(bx,zero+extent);ctx.stroke();
  ctx.strokeStyle=isLocked?LOCK_RED:'#536d86';ctx.lineWidth=isLocked?5:3;ctx.stroke();
  if(valid&&(magnitude>=.005||isLocked)){
   // A single, high-visibility state colour covers the WHOLE filled segment.
   // Only the hue changes smoothly with current magnitude; no spatial rainbow.
   ctx.fillStyle=color;
   ctx.shadowColor=color;ctx.shadowBlur=(isLocked?22:magnitude>=.12?15:5)*paintScale;
   ctx.beginPath();ctx.roundRect(bx-width/2,isLocked?zero-extent:braking?zero:zero-fill,width,isLocked?extent*2:fill,Math.min(10,isLocked?10:fill/2));ctx.fill();
   // Distinct overflow cap; raw percentage continues beyond 100, not a second full bar.
   if(!isLocked&&magnitude>1){const tip=zero+(braking?fill:-fill);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(bx-17,tip);ctx.lineTo(bx+17,tip);ctx.stroke();}
  }
  ctx.shadowBlur=(isLocked?15:0)*paintScale;ctx.beginPath();ctx.moveTo(bx-15,zero);ctx.lineTo(bx+15,zero);ctx.strokeStyle=isLocked?LOCK_RED:'#aabace';ctx.lineWidth=isLocked?5:3;ctx.stroke();
  if(isLocked){ctx.shadowColor=LOCK_RED;ctx.shadowBlur=(18)*paintScale;}
  if(valid&&nativeRatio&&(magnitude>=.005||isLocked))text((braking?'-':'+')+Math.min(999,magnitude*100).toFixed(0)+'%',tx,zero-5,UI.sizes.value,isLocked?'#fff1f2':color);
  ctx.restore();
 }
}
function lateralBar(x,y,width,value,range=20,label='',barColor=null,angle=false){
 const valid=Number.isFinite(value),half=width/2,color=barColor||(valid?slipColor(Math.abs(value)/range,false):'#a2b0be');
 ctx.save();
 // Match the four longitudinal rails: no white backing, only a quiet track and an active coloured extent.
 ctx.strokeStyle=UI.colors.border;ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-half,y);ctx.lineTo(x+half,y);ctx.stroke();
 if(valid){
  const distance=Math.min(1,Math.abs(value)/range)*half,sign=Math.sign(value),end=x+sign*distance;
  if(distance>.5){ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=(8)*paintScale;ctx.beginPath();ctx.roundRect(value<0?end:x,y-10,distance,20,Math.min(9,distance/2));ctx.fill();ctx.shadowBlur=(0)*paintScale;}
  if(Math.abs(value)>=range*.8){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.shadowColor=color;ctx.shadowBlur=(17)*paintScale;ctx.beginPath();ctx.roundRect(value<0?x-half:x,y-12,half,24,10);ctx.stroke();ctx.shadowBlur=(0)*paintScale;}
  // The filled width is the primary magnitude cue; a small end cap merely marks its measured endpoint.
  ctx.fillStyle=color;ctx.strokeStyle='#07111d';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(end-4,y-13,8,26,3);ctx.fill();ctx.stroke();
 }else{ctx.setLineDash([3,3]);ctx.strokeStyle='#738399';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x-4,y-13,8,26,3);ctx.stroke();ctx.setLineDash([]);}
 // Centre survives coloured fills: dark separator with a short white head above/below the rail.
 ctx.strokeStyle='#132334';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();ctx.strokeStyle='#f7fbff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-15);ctx.lineTo(x,y-11);ctx.moveTo(x,y+11);ctx.lineTo(x,y+15);ctx.stroke();
 if(label)text(label,x-half-16,y,16,'#c7d6e3');
 if(valid&&angle)text((value>0?'+':'')+value.toFixed(1)+'°',x+half+26,y,16,color);else if(!valid)text('—',x+half+24,y,16,'#8fa3b6');
 ctx.restore();
}
function rgbMix(a,b,t){const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));const x=hex(a),y=hex(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,'0')).join('');}
// Whole rail hue reflects the current state; trend chevrons never command pedal movement.
function responseColor(value){
 const stops=UI.palettes?.response||[[0,'#ff183c'],[.15,'#ff623f'],[.4,'#ffc34e'],[.7,'#beed65'],[1,'#66f0c3']],v=Math.max(0,Math.min(1,value));
 for(let i=1;i<stops.length;i++)if(v<=stops[i][0])return rgbMix(stops[i-1][1],stops[i][1],(v-stops[i-1][0])/(stops[i][0]-stops[i-1][0]));
 return stops.at(-1)[1];
}
function pedalAssist(x,cue){
 if(!cue||!(cue.severity>0))return;
 // One signal only. Real pedal fill is bottom-up; release reference blooms TOP -> DOWN on its border.
 const strength=Math.max(0,Math.min(1,cue.severity)),l=x-19,r=x+19,top=230,end=top+440*strength,corner=Math.min(12,440*strength),opacity=Math.sqrt(strength),color=rgbMix('#ffdc7a','#ff244f',strength);
 const path=()=>{ctx.beginPath();ctx.moveTo(l,end);ctx.lineTo(l,top+corner);ctx.quadraticCurveTo(l,top,l+corner,top);ctx.lineTo(r-corner,top);ctx.quadraticCurveTo(r,top,r,top+corner);ctx.lineTo(r,end);};
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.shadowColor=color;
 ctx.globalAlpha=.28*opacity;ctx.lineWidth=8+strength*5;ctx.shadowBlur=(22+strength*20)*paintScale;path();ctx.stroke();
 ctx.globalAlpha=opacity;ctx.lineWidth=2+strength*5;ctx.shadowBlur=(12+strength*12)*paintScale;path();ctx.stroke();ctx.restore();
}
// Two long lateral rails on each side: FRONT above REAR, both fill toward the wheel centre.
// Longitudinal information lives only at the actual throttle/brake borders.
function wheelLateral(cx,cy,part,unloaded,valid,side){
 const d=part?.directions?.lateral,known=valid&&d?.available&&Number.isFinite(d.current);
 const value=known?Math.max(0,Math.min(1,d.current)):0;
 const width=190,height=18,left=cx-width/2,warning=known?d.danger||0:0;
 const shape=()=>{ctx.beginPath();ctx.roundRect(left,cy-height/2,width,height,6);};
 ctx.save();ctx.lineJoin='round';ctx.shadowBlur=0;shape();ctx.fillStyle=UI.colors.track;ctx.fill();
 if(unloaded){ctx.strokeStyle='#f5fcff';ctx.lineWidth=3;ctx.shadowColor='#e8f7ff';ctx.shadowBlur=14*paintScale;ctx.stroke();ctx.restore();return;}
 if(known){
  ctx.save();shape();ctx.clip();ctx.fillStyle=responseColor(value);
  ctx.fillRect(side===0?left:left+width*(1-value),cy-height/2,width*value,height);ctx.restore();
 }
 const secondary=known&&Number.isFinite(d.estimate?.value)?Math.max(0,Math.min(1,d.estimate.value)):value;
 const evidence=d?.estimate?.evidence||0,richness=.5+.5*Math.max(evidence,warning);
 shape();ctx.strokeStyle=known?rgbMix('#9cb3c7',responseColor(secondary),richness):'#738497';ctx.lineWidth=2+warning*2;
 ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=Math.pow(warning,1.5)*18*paintScale;ctx.stroke();ctx.restore();
}
function flagBanner(g){
 if(typeof Flags==='undefined')return;
 const f=Flags.forGame(g,!uiInfo.waiting);if(!f)return;
 ctx.save();
 ctx.translate(0,-89);
 ctx.fillStyle=UI.colors.panel+'f2';ctx.strokeStyle=f.color;ctx.lineWidth=3;
 ctx.beginPath();ctx.roundRect(370,0,260,64,12);ctx.fill();ctx.stroke();
 ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.font=`700 ${UI.sizes.flagTitle}px ${UI.font}`;
 ctx.fillStyle=f.color;ctx.fillText(f.name,500,19);
 ctx.font=`600 ${UI.sizes.flagHint}px ${UI.font}`;
 ctx.fillStyle=UI.colors.text;ctx.fillText(f.short,500,46);
 ctx.restore();
}
function sideLateral(online,a,side,x){
 for(let row=0;row<2;row++){
  const grip=online&&a.fresh?a.grip?.axles?.[row?'rear':'front']:null;
  const part=grip?.sides?.[side],valid=!!part?.available;
  wheelLateral(x,row?60:34,part,!!grip?.unloadedSides?.[side],valid,side);
 }
}
function handlingColor(kind,level){
 const palettes=UI.palettes?.handling||{understeer:['#edfaff','#6ce6dd','#e2ef69','#ffb147','#ff653d','#ff2047'],oversteer:['#edfaff','#87cbff','#a89dff','#df77e0','#ff558e','#ff234d'],both:['#edfaff','#aee893','#f0e56b','#ffac48','#ff5e42','#ff1749']};
 const stops=[0,.2,.45,.7,.9,1],colors=palettes[kind]||palettes.understeer,v=Math.sqrt(Math.max(0,Math.min(1,level)));
 for(let i=1;i<stops.length;i++)if(v<=stops[i])return rgbMix(colors[i-1],colors[i],(v-stops[i-1])/(stops[i]-stops[i-1]));return colors.at(-1);
}
function steeringNeedle(s,online,a){
 const grip=online&&a.fresh?a.grip:null;
 if(!grip?.available||a.steering?.mode==='static'||a.steering?.mode==='low_speed'||a.steering?.mode==='reverse')return;
 const handling=a.handling,level=Math.max(0,Math.min(1,handling?.severity||0)),kind=handling?.state;
 if(!['understeer','oversteer','both','sway'].includes(kind))return;
 const label=kind==='sway'?'侧摆':kind==='understeer'?'推头':kind==='oversteer'?'甩尾':'四轮侧滑';
 const color=handlingColor(kind,level),width=kind==='both'?206:140;
 ctx.save();ctx.fillStyle=UI.colors.panel+'e6';ctx.strokeStyle=color;ctx.lineWidth=2+level*2;ctx.shadowColor=color;ctx.shadowBlur=(5+level*13)*paintScale;
 ctx.beginPath();ctx.roundRect(500-width/2,39,width,65,15);ctx.fill();ctx.stroke();
 text(label,500,72,UI.sizes.headline||40,color);ctx.restore();
}
// Presentation only: raw diagnostic/recorded values are never filtered or fed back into estimation.
let presentation=null,presentationAt=null;
function presentationView(a,now){
 if(!a.fresh){presentation=null;presentationAt=null;return a;}
 const dt=presentationAt===null?Infinity:now-presentationAt,old=presentation;presentationAt=now;
 const blend=(prev,value)=>Number.isFinite(prev)&&dt>0&&dt<100?prev+(value-prev)*(1-Math.exp(-dt/25)):value;
 const g=a.grip;if(!g)return a;
 const axles={};
 for(const key of ['front','rear']){const x=g.axles?.[key];if(!x)continue;
  const hard=x.reason==='unloaded'||x.reason==='low-speed'||x.support!==old?.grip?.axles?.[key]?.support;
  const value=hard?x.reserve.value:blend(old?.grip?.axles?.[key]?.reserve?.value,x.reserve.value);
  const currentValue=hard?(x.currentReserve?.value??value):blend(old?.grip?.axles?.[key]?.currentReserve?.value,x.currentReserve?.value??value);
  const sides=x.sides?.map((side,i)=>{const prior=old?.grip?.axles?.[key]?.sides?.[i],direct=hard||side.unloaded||prior?.unloaded!==side.unloaded;return {...side,value:direct?side.value:blend(prior?.value,side.value),current:direct?side.current:blend(prior?.current,side.current)};});
  axles[key]={...x,sides,currentReserve:{value:Math.max(value,currentValue)},reserve:{...x.reserve,value,low:Math.min(x.reserve.low,value),high:Math.max(x.reserve.high,value)}};
 }
 const cue=(key)=>a[key]?{...a[key],severity:blend(old?.[key]?.severity,a[key].severity)}:null;
 const needle=Math.sign(old?.grip?.needle)!==Math.sign(g.needle)?g.needle:blend(old?.grip?.needle,g.needle);
 presentation={...a,grip:{...g,axles,needle},drive:cue('drive'),brake:cue('brake')};return presentation;
}
function drivingUi(s,online,a){
 const nativeF=online&&a.fresh?a.lateral?.front:null;
 const nativeR=online&&a.fresh?a.lateral?.rear:null;
 const slipF=online&&a.fresh?a.grip?.vehicleResponse?.slipAngleFront:null;
 const slipR=online&&a.fresh?a.grip?.vehicleResponse?.slipAngleRear:null;
 const useF=Number.isFinite(nativeF),useR=Number.isFinite(nativeR);
 layout.group('frontLateral',()=>lateralBar(500,119,480,useF?nativeF:slipF,useF?20:15,useF?'':'F',useF?null:UI.colors.estimateFront,!useF));
 layout.group('handling',()=>steeringNeedle(s,online,a));
 layout.group('frontResponse',()=>sideLateral(online,a,0,245));
 layout.group('rearResponse',()=>sideLateral(online,a,1,755));
 layout.group('rearLateral',()=>lateralBar(500,787,480,useR?nativeR:slipR,useR?20:15,useR?'':'R',useR?null:UI.colors.estimateRear,!useR));
 if(!online||!a.fresh)return;
 // Pedal input and its release outline are one inseparable editable control.
 layout.group('decel',()=>{if(Number.isFinite(a.decel)){
  const value=Math.abs(a.decel)<.005?0:a.decel;text('实际减速',500,658,UI.sizes.label,'#c1ccd9');text((value<0?'−':'')+Math.abs(value).toFixed(2)+' g',500,691,UI.sizes.value,'#f5f9ff');
 }});
}
function drawGBall(v){
 const x=500,y=423,r=60,scale=v?.scale||.4,c=v?.current,position=p=>{const length=Math.hypot(p.x,p.y),f=(r-4)/Math.max(scale,length);return {x:x+p.x*f,y:y+p.y*f};};
 ctx.save();ctx.lineWidth=.85;ctx.strokeStyle='#90a8b69c';ctx.fillStyle='#081521c4';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
 ctx.strokeStyle='#7b99a633';ctx.lineWidth=.55;ctx.beginPath();ctx.arc(x,y,r/2,0,Math.PI*2);ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);ctx.stroke();
 ctx.save();ctx.beginPath();ctx.arc(x,y,r-1,0,Math.PI*2);ctx.clip();
 // A closed polar envelope joins measured sector peaks; no invented radius in unseen directions.
 ctx.save();ctx.strokeStyle='#96e7ee99';ctx.lineWidth=1.05;ctx.lineJoin='round';ctx.shadowBlur=0;ctx.beginPath();
 for(let i=0;i<((v?.peakOutline||v?.peakHull)?.length||0);i++){const p=position((v.peakOutline||v.peakHull)[i]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}
 ctx.closePath();ctx.stroke();ctx.restore();
 // One fine continuous trace, not overlapping filled dots that build up into a thick band.
 const trail=v?.trail||[];ctx.strokeStyle='#96e7ee';ctx.lineWidth=1.05;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=.48;ctx.beginPath();
 for(let i=0;i<trail.length;i++){const p=position({x:trail[i].lateral,y:trail[i].longitudinal});i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}if(trail.length>1)ctx.stroke();ctx.globalAlpha=1;
 if(c){const color='#d9ffff';ctx.shadowColor=color;ctx.shadowBlur=(3)*paintScale;const p=position({x:c.lateral,y:c.longitudinal});circle(p.x,p.y,3,color,'#f2ffff',1.2);if(c.magnitude>scale){ctx.strokeStyle='#f2b68b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,r-3,Math.atan2(p.y-y,p.x-x)-.18,Math.atan2(p.y-y,p.x-x)+.18);ctx.stroke();}ctx.shadowBlur=(0)*paintScale;}
 ctx.restore();
 // History is a shape, not a second data list. Mark its largest direction on the rim.
 const peakPoint=(v?.peakOutline||v?.peakHull||[]).reduce((a,p)=>!a||Math.hypot(p.x,p.y)>Math.hypot(a.x,a.y)?p:a,null);
 if(peakPoint&&Math.hypot(peakPoint.x,peakPoint.y)>.005){const a=Math.atan2(peakPoint.y,peakPoint.x);ctx.strokeStyle='#b3eef3';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(x,y,r-1,a-.07,a+.07);ctx.stroke();}
 text(scale.toFixed(1)+'g',x+r+6,y-4,16,'#d8e7f5');
 text(c?c.magnitude.toFixed(2)+'g':'—g',x,y+27,UI.sizes.label,c?'#f3ffff':'#9aaebe');ctx.restore();
}
function centreStripe(){
 // Physical yellow leather centre band, not an emissive LED.
 ctx.save();ctx.beginPath();ctx.moveTo(639,33);ctx.bezierCurveTo(648,30,666,30,675,33);ctx.lineTo(675,144);ctx.bezierCurveTo(666,146,648,146,639,144);ctx.closePath();ctx.clip();
 const yellow=ctx.createLinearGradient(639,0,675,0);yellow.addColorStop(0,'#ae8506');yellow.addColorStop(.12,'#f0c408');yellow.addColorStop(.38,'#ffe02a');yellow.addColorStop(.72,'#ffd510');yellow.addColorStop(.94,'#e9b80a');yellow.addColorStop(1,'#9d7405');
 ctx.globalCompositeOperation='source-atop';ctx.fillStyle=yellow;ctx.fillRect(638,29,39,119);
 ctx.globalCompositeOperation='luminosity';ctx.globalAlpha=.18;ctx.drawImage(image,0,0);ctx.restore();
}
const componentPaint=(!qa||params.get('retained')==='1')&&typeof ComponentPaint!=='undefined'?new ComponentPaint.Components():null;
function componentKey(id,s,online,p,now){
 const g=s.game,a=assistView;
 if(id==='wheel')return [online,angle,image.complete,s.buttons,s.knobPositions,s.inputProfile,s.leds,g?.shiftLights,s.handbrake,s.paddleMode,s.leftPaddle,s.rightPaddle,g?.available,g?.gear,g?.rpm,g?.maxRpm,g?.rpmPercent,g?.speedKmh,a.grip?.steeringState,g?.wheels?.map(w=>w.ratio),uiInfo.waiting,buttonLightsAvailable(s.leds)&&!uiInfo.ambientKnobs?(g?.shiftLights?.blinkRpm>0&&g.rpm>=g.shiftLights.blinkRpm?Math.floor(now/100):0):Math.floor(now/33)];
 if(id==='brake'||id==='throttle')return [online,p.fresh,id==='brake'?[s.brake,p.brake]:[s.throttle,p.drive]];
 if(id.startsWith('slip')&&!id.startsWith('slipAngle')){const i=Number(id.slice(4)),w=g?.wheels?.[i];return [online,g?.available,g?.paused,g?.inMenu,g?.speedKmh,g?.brake,w,a.fresh,a.unloaded?.[i],w?.ratio<-.65||(lockState[i].until||0)>now?Math.floor(now/20):0];}
 if(id==='frontResponse'||id==='rearResponse')return [online,a.fresh,a.grip?.axles];
 if(id==='frontLateral'||id==='rearLateral')return [online,a.fresh,a.lateral,a.grip?.vehicleResponse?.slipAngleFront,a.grip?.vehicleResponse?.slipAngleRear];
 if(id==='handling')return [online,a.fresh,a.steering?.mode,a.handling];
 if(id==='decel')return [online,a.fresh,a.decel];
 if(id==='handbrake')return [online,s.handbrake];
 if(id==='statuses')return [online,g?.available,g?.paused,g?.inMenu,g?.statuses,['absActive','tcActive','escActive'].map(k=>g?.statuses?.[k]===true||performance.now()<(latch[k]||0))];
 if(id==='gBall')return gBallView;
 if(id==='flags')return [online,uiInfo.waiting,g?.available,g?.source,g?.paused,g?.inMenu,g?.statuses?.sessionFlags];
 return now;
}
function prepareScene(now){
 runtimePerf.prepares=(runtimePerf.prepares||0)+1;
 const stage=layout.stage?.()||{width:1000,height:850,originX:0,originY:0,scale:1};
 const raster=layout.raster?.(stage,window.devicePixelRatio||1,window.innerWidth,window.innerHeight,params.has('stage'))||{width:stage.width,height:stage.height,ratio:1};
 paintScale=stage.scale*raster.ratio;uiInfo.raster=raster;

 let s=state;const live=s.connected&&(qa||Date.now()-lastGood<1000);
 const online=demo||live;angle=online?s.angle:0;
 if(!online){visualSteering.from=0;visualSteering.to=0;visualSteering.duration=0;}
 if(!online||performance.now()-assistView.processedAt>400)assistView={fresh:false,unloaded:[false,false,false,false]};
 layout.begin();
 uiInfo.waiting=!demo&&telemetryWaiting(s.game,now);
 for(const key of ['absActive','tcActive','escActive'])if(online&&s.game?.statuses?.[key]===true)latch[key]=now+220;
 for(let i=0;i<4;i++)advanceWheelLock(s,online,assistView,i,now);
 const presented=presentationView(assistView,now);
 const retained=params.get('edit')==='1'?null:componentPaint;
 layout.group('brake',()=>{bar(70,online?s.brake:0,UI.colors.brake,'刹车',online);if(online&&presented.fresh)pedalAssist(70,presented.brake);});
 layout.group('throttle',()=>{bar(930,online?s.throttle:0,UI.colors.throttle,'油门',online);if(online&&presented.fresh)pedalAssist(930,presented.drive);});
 const map=s.inputProfile?.buttonMap;if(Array.isArray(map)&&map.length)controls.forEach((c,i)=>{if(Number.isInteger(map[i]))c.b=[map[i]];});
 const pressed=new Set(online?s.buttons:[]);let led=s.leds||{};const liveButtonLights=online&&buttonLightsAvailable(led);
 uiInfo.ambientButtons=!liveButtonLights;
 const tendency=assistView.grip?.steeringState;
 const ambientAlert=Math.max(0,Math.min(tendency?.front||0,tendency?.rear||0),...Object.values(assistView.grip?.axles||{}).map(x=>x.overrun||0),...(s.game?.speedKmh>10?s.game?.wheels||[]:[]).map(w=>Math.max(0,Math.min(1,(-(w.ratio||0)-.65)/.35))));
 // Screen-only fallback: game-reported shift thresholds, not a hardware LED acknowledgement.
 if(!(online&&led.available===true&&Array.isArray(led.rpm)&&led.rpm.some(v=>typeof v==='string'))&&online&&s.game?.available){
  const lights=shiftLightColors(s.game,now);
  if(lights){led={...led,rpm:lights.colors};uiInfo.rpmLightSource=lights.source;}else uiInfo.rpmLightSource='unavailable';
 }else uiInfo.rpmLightSource=led.available===true?'observed-device':'unavailable';
 const knobPaint=encoders.map(e=>{
  const n=e.led-8,rawColor=(led.knobs||[])[n],ambient=!(online&&led.available===true&&typeof rawColor==='string'&&/^#[0-9a-f]{6}$/i.test(rawColor));
  const color=ambient?ambientButtonColor(e,now,ambientAlert):emittedColor(rawColor);
  if(Array.isArray(s.knobPositions))knobPositions[n]=s.knobPositions[n]??null;
  else for(let i=0;i<12;i++)if(pressed.has(e.first+i))knobPositions[n]=i;
  return {e,n,color,ambient};
 });
 uiInfo.ambientKnobs=knobPaint.some(x=>x.ambient);
 const dashboardState={...s,angle};
 const faceKey=JSON.stringify([dashboardState,led,knobPositions,ambientAlert,Math.floor(now/33)]);
 const drawFace=()=>{
 if(image.complete&&image.naturalWidth){ctx.shadowColor='#03050b';ctx.shadowBlur=(3)*paintScale;ctx.shadowOffsetX=(2)*paintScale;ctx.drawImage(wheelImage(),0,0);ctx.shadowBlur=(0)*paintScale;ctx.shadowOffsetX=(0)*paintScale;}
 if(image.complete&&image.naturalWidth)centreStripe();
 if(window.DashRenderer)ctx.drawImage(DashRenderer.render(dashboardState,Number(params.get('page')||1)),529,344,256,81.4);
 // Shapes measured from the original wheel image: 3 brow + 10 centre + 3 brow.
 for(const shape of ledShapes){const points=shape.points,light=emittedColor((led.rpm||[])[shape.led]);ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.lineJoin='round';ctx.lineWidth=7;ctx.strokeStyle='#171b20';ctx.fillStyle='#11171e';ctx.stroke();ctx.fill();
  if(light){ctx.fillStyle=light;ctx.fill();}ctx.lineWidth=1.3;ctx.strokeStyle=light?'#d9e5eb55':'#53617088';ctx.stroke();
 }
 for(const c of controls){if(c.led!==undefined)buttonCap(c,liveButtonLights?(led.buttons||[])[c.led]:ambientButtonColor(c,now,ambientAlert),!liveButtonLights);const axisValue=c.axis&&online?(s.paddleMode==='combined'?s.handbrake:s[c.axis])||0:0;if(c.b.some(b=>pressed.has(b))||axisValue>1){circle(c.x,c.y,c.r+10,'#ffffff22','#fff',5);circle(c.x,c.y,c.r+16,'#ffffff00','#ffdc48',4);}}
 for(const {e,n,color,ambient} of knobPaint){
  // Concentric graphite bezel, fine detent marks and one selected sector.
  circle(e.x,e.y,69,'#0b1017','#778493',2);circle(e.x,e.y,64,'#202a36','#05090e',3);
  for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2,selected=i===knobPositions[n];ctx.beginPath();ctx.arc(e.x,e.y,53,a+.045,a+Math.PI/6-.045);ctx.lineWidth=selected?17:10;ctx.strokeStyle=selected?(color||'#d8e5ee'):'#344150';ctx.stroke();
   ctx.beginPath();ctx.moveTo(e.x+60*Math.cos(a),e.y+60*Math.sin(a));ctx.lineTo(e.x+65*Math.cos(a),e.y+65*Math.sin(a));ctx.strokeStyle=selected?'#edf8ff':'#81909f';ctx.lineWidth=2;ctx.stroke();
  }
  if(color){ctx.save();ctx.shadowColor=color;ctx.shadowBlur=(ambient?15:0)*paintScale;ctx.beginPath();ctx.arc(e.x,e.y,65,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=ambient?4:3;ctx.stroke();ctx.restore();}
  const cap=ctx.createRadialGradient(e.x-10,e.y-12,2,e.x,e.y,38);cap.addColorStop(0,'#404c58');cap.addColorStop(1,'#141c26');circle(e.x,e.y,37,cap,'#080e16',3);
  for(let j=0;j<20;j++){const a=j*Math.PI/10;ctx.beginPath();ctx.moveTo(e.x+33*Math.cos(a),e.y+33*Math.sin(a));ctx.lineTo(e.x+37*Math.cos(a),e.y+37*Math.sin(a));ctx.strokeStyle='#76839166';ctx.lineWidth=1.5;ctx.stroke();}
  text(knobPositions[n]===null?'—':String(knobPositions[n]+1),e.x,e.y,UI.sizes.wheelKnob,'#f1f7ff');
  if(e.b.some(b=>pressed.has(b)))circle(e.x,e.y,73,'#ffffff00','#ffdc48',4);
 }
 for(const c of controls){const active=c.b.filter(b=>pressed.has(b));if(active.length)text(active.join('·'),c.x,c.y,c.r<20?18:23,'#eafaff');}
 const extra=[...pressed].filter(n=>!controls.some(c=>c.b.includes(n)));
 if(extra.length)text(extra.slice(0,8).join(' · '),657,680,27,'#eafaff');
 };
 layout.group('wheel',()=>{
 ctx.save();ctx.translate(500,450);ctx.rotate(paintAngle*Math.PI/180);ctx.scale(740/1315,740/1315);
 // Calibrated opaque rim: x=76..1234, y=33..1172. Correct the original
 // photograph before rotation; all buttons and the dashboard share this transform.
 ctx.scale(1139/1158,1);ctx.translate(-655,-602.5);
 paintWheelFace(faceKey,drawFace);
 ctx.restore();
 waitingBadge(uiInfo.waiting);
 });
 for(let i=0;i<4;i++)layout.group('slip'+i,()=>wheelSlip(s,online,assistView,i,false));
 drivingUi(s,online,presented);
 layout.group('handbrake',()=>{if(online&&(s.handbrake||0)>.5){ctx.fillStyle='#101720ec';ctx.strokeStyle='#ffdc48';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(440,505,120,95,15);ctx.fill();ctx.stroke();text('手刹',500,526,UI.sizes.secondary,'#ffdc48');text(Math.round(s.handbrake||0)+'%',500,569,UI.sizes.value,'#fff');}
 });
 layout.group('statuses',()=>statuses(s,online,false));

 layout.group('gBall',()=>drawGBall(gBallView));
 layout.group('flags',()=>{if(online)flagBanner(s.game);});
 finishScene(stage,raster,retained,s,online,presented,now);
}

// Three independent clocks: telemetry owns estimation; this 30 Hz fallback owns
// decoration/deadlines; requestAnimationFrame only submits the newest prepared scene.
let preparedScene=null,paintPending=false,sceneTimer=null,sceneSignature=null;
function finishScene(stage,raster,retained,s,online,presented,now){
 const jobs=layout.capture?.();
 const keys=Object.fromEntries((jobs||[]).map(j=>[j.id,JSON.stringify(componentKey(j.id,s,online,presented,now))]));
 preparedScene={stage,raster,retained,jobs,keys,game:s.game};
 const signature=JSON.stringify([stage,raster,jobs?.map(j=>[j.id,j.c]),keys,layout.selection?.()]);
 if(signature===sceneSignature)return;sceneSignature=signature;
 if(!qa&&!paintPending){paintPending=true;requestAnimationFrame(render);}
}
function render(at=performance.now()){
 if(!qa){paintPending=true;requestAnimationFrame(render);}else paintPending=false;
 runtimePerf.displayFrames=(runtimePerf.displayFrames||0)+1;
 if(displayLastAt!==null){const dt=at-displayLastAt;runtimePerf.displayElapsed=(runtimePerf.displayElapsed||0)+dt;runtimePerf.slowDisplayFrames=(runtimePerf.slowDisplayFrames||0)+(dt>20?1:0);}displayLastAt=at;
 if(!preparedScene)return;
 paintAngle=qa?angle:steeringAt(at);
 const paintSignature=sceneSignature+'@'+paintAngle;
 if(!qa&&paintSignature===lastPaintSignature)return;lastPaintSignature=paintSignature;
 const {stage,raster,retained,jobs,keys,game}=preparedScene;
 runtimePerf.renders++;
 if(canvas.width!==raster.width||canvas.height!==raster.height){canvas.width=raster.width;canvas.height=raster.height;}
 ctx.setTransform(1,0,0,1,0,0);
 if(!retained)ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.setTransform(stage.scale*raster.width/stage.width,0,0,stage.scale*raster.height/stage.height,stage.originX*raster.width/stage.width,stage.originY*raster.height/stage.height);
 retained?.begin(canvas,stage,raster,id=>id==='wheel'?keys[id]+'@'+paintAngle:keys[id]);
 layout.flush(ctx,retained,jobs);
 if(demo)text('演示数据',500,839,16,'#ffdc48');
}
function queueScene(now=performance.now()){
 prepareScene(now);
 if(!qa&&typeof clearTimeout==='function'){
  clearTimeout(sceneTimer);
  sceneTimer=setTimeout(()=>{
   // No new telemetry: age displayed state without re-running the physical model.
   if(performance.now()-lastInputAt>400&&gBallModel)gBallView=gBallModel.age(performance.now());
   queueScene(performance.now());
  },1000/30);
 }
}
let lastInputAt=-Infinity;
function startSceneClock(){
 image.onload=()=>queueScene(performance.now());
 layout.onChange?.(()=>queueScene(performance.now()));
 if(typeof addEventListener==='function')addEventListener('resize',()=>queueScene(performance.now()));
 if(typeof window!=='undefined')window.addEventListener('overlay-refresh',()=>{if(componentPaint)componentPaint.invalidate();sceneSignature=null;queueScene(performance.now());});
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(componentPaint)componentPaint.invalidate();sceneSignature=null;queueScene(performance.now());}});
 if(demo){
  const sample=()=>{const now=performance.now();state={connected:true,angle:35*Math.sin(now/1800),brake:Math.max(0,Math.sin(now/1300))*100,throttle:Math.max(0,Math.cos(now/1700))*100,buttons:[17,26,54],leds:{buttons:['#56f7fc','#ff3165','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc'],knobs:['#ff3366','#2ee973','#315aff','#ff651c'],rpm:Array.from({length:16},(_,i)=>i<11?'#45f7c0':'#111')},ledSource:'demo'};
   observeSteering(state,now);lastInputAt=now;lastGood=Date.now();assistView=assistModel.update(state,now);gBallView=gBallModel?.update(null,now);
   queueScene(now);setTimeout(sample,1000/60);
  };sample();
 }else if(!qa)queueScene(performance.now());
}
function testState(s,at){
 if(!qa)return;state=s;observeSteering(state,performance.now());lastGood=Date.now();lastInputAt=performance.now();
 qaClock=Number.isFinite(at)?at:qaClock===null?performance.now():qaClock+20;
 assistView=assistModel.update(s,qaClock);gBallView=gBallModel?.update(s.connected?s.game:null,qaClock);
}

let stream=null,streaming=false,streamLast=0,feedEpoch=0,pendingFrame=null,processing=false;
async function consume(incoming,receivedAt){
 if(pendingFrame)runtimePerf.coalescedFrames=(runtimePerf.coalescedFrames||0)+1;
 pendingFrame={incoming,receivedAt};if(processing)return;
 processing=true;
 try{while(pendingFrame){
  const frame=pendingFrame;pendingFrame=null;
  const processAt=performance.now(),result=processor?await processor.run(frame.incoming,frame.receivedAt):{view:assistModel.update(frame.incoming,frame.receivedAt),costMs:performance.now()-processAt,mode:'main'};
  state=frame.incoming;observeSteering(state,performance.now());assistView=result.view;lastGood=Date.now();lastInputAt=performance.now();runtimePerf.processingMode=result.mode;
  observeCost('algorithm',result.costMs);runtimePerf.polls++;
  if(state.game?.packet!==runtimePerf.lastPacket){runtimePerf.uniquePackets++;runtimePerf.lastPacket=state.game?.packet;}
  gBallView=gBallModel?.update(state.connected?state.game:null,frame.receivedAt);queueScene(performance.now());
 }}finally{processing=false;}
}
function loseStream(source){
 if(source!==stream)return;source.close();stream=null;streaming=false;feedEpoch++;setTimeout(openStream,1000);
}
function openStream(){
 if(stream||typeof EventSource==='undefined')return;
 try{
  const source=new EventSource('/events');stream=source;
  source.onmessage=event=>{
   if(source!==stream)return;
   try{const incoming=JSON.parse(event.data);if(!incoming||typeof incoming!=='object'||Array.isArray(incoming)||typeof incoming.connected!=='boolean')throw Error('Invalid snapshot');
    if(!streaming)feedEpoch++;streamLast=performance.now();streaming=true;runtimePerf.streamFrames=(runtimePerf.streamFrames||0)+1;
    consume(incoming,streamLast).catch(()=>loseStream(source));
   }catch{loseStream(source);}
  };
  source.onerror=()=>loseStream(source);
 }catch{stream=null;setTimeout(openStream,1000);}
}
async function poll(){
 const requestAt=performance.now();
 if(streaming&&requestAt-streamLast>400)loseStream(stream);
 if(streaming){setTimeout(poll,100);return;}
 const epoch=feedEpoch,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1500);
 try{
  const r=await fetch('/state',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error(r.status);
  const incoming=await r.json();
  // An in-flight fallback response cannot overwrite a newer streaming frame.
  if(!streaming&&epoch===feedEpoch){observeCost('network',performance.now()-requestAt);await consume(incoming,performance.now());}
 }catch(e){if(!streaming&&epoch===feedEpoch){runtimePerf.errors++;state={connected:false,error:'输入服务已断开'};assistView={fresh:false,unloaded:[false,false,false,false]};gBallView=gBallModel?.update(null,performance.now());queueScene(performance.now());}}
 finally{clearTimeout(timeout);}
 setTimeout(poll,Math.max(0,1000/60-(performance.now()-requestAt)));
}
if(!demo&&!qa){openStream();poll();}startSceneClock();
window.overlayDiagnostics={controls,encoders,getPerformance,getGBall:()=>gBallView,resetGPeak:()=>gBallModel?.clearPeak(),getUi:()=>({...uiInfo}),getState:()=>state,getAssist:()=>assistView,getPresentation:()=>presentation,getPaint:()=>componentPaint?.stats,getWheelFace:()=>({...wheelFaceStats}),renderTest:at=>{if(qa){prepareScene(at??performance.now());render();}},paintTest:()=>{if(qa)render();},setTestState:testState};
