'use strict';
const canvas=document.getElementById('overlay'),nativeContext=canvas.getContext('2d');
const ctx=typeof OpacityPaint!=='undefined'?OpacityPaint.wrap(nativeContext,kind=>layout.drawOpacity?.(kind)??1):nativeContext;
const image=new Image();image.src='assets/wheel.svg';
const params=new URLSearchParams(location.search),demo=params.get('demo')==='1',qa=params.get('qa')==='1';
let paintScale=1;
let state={connected:false},lastGood=0,angle=0,qaClock=null;
const uiInfo={version:'1.0.0',ambientKnobs:false,ambientButtons:false,waiting:false};
const assistModel=new DrivingAssist.Model({storage:qa||typeof localStorage==='undefined'?null:localStorage});let assistView={fresh:false,unloaded:[false,false,false,false]};
// Fixed-size counters, no per-frame logging. Recording derives rates from counter deltas.
const runtimePerf={startedAt:performance.now(),polls:0,errors:0,renders:0,uniquePackets:0,lastPacket:null,algorithm:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)},network:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)}};
const costBounds=[.1,.25,.5,1,2,4,8,16,32,64,Infinity];
function observeCost(kind,ms){const c=runtimePerf[kind];c.count++;c.totalMs+=ms;c.maxMs=Math.max(c.maxMs,ms);c.buckets[costBounds.findIndex(b=>ms<=b)]++;}
function getPerformance(){const elapsedMs=performance.now()-runtimePerf.startedAt;const cost=c=>({count:c.count,totalMs:c.totalMs,maxMs:c.maxMs,buckets:c.buckets.slice()});return {elapsedMs,polls:runtimePerf.polls,errors:runtimePerf.errors,renders:runtimePerf.renders,uniquePackets:runtimePerf.uniquePackets,algorithm:cost(runtimePerf.algorithm),network:cost(runtimePerf.network),bucketUpperMs:costBounds.map(b=>Number.isFinite(b)?b:null)};}
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
const encoders=[];
controls.forEach((c,i)=>{c.b=[i+1];c.led=i;c.axis=undefined;});
const ledShapes=[{"led": 0, "points": [[481, 338], [482, 337], [492, 331], [496, 329], [498, 331], [498, 348], [497, 349], [495, 349], [492, 347], [482, 340], [481, 339]]}, {"led": 1, "points": [[475, 344], [476, 343], [477, 343], [492, 354], [496, 357], [496, 358], [495, 359], [476, 359], [475, 358]]}, {"led": 2, "points": [[481, 366], [483, 365], [496, 365], [498, 367], [498, 384], [496, 386], [491, 381], [481, 368]]}, {"led": 3, "points": [[533, 319], [535, 317], [542, 316], [552, 315], [554, 315], [555, 316], [555, 318], [551, 326], [549, 328], [541, 328], [536, 323]]}, {"led": 4, "points": [[559, 324], [563, 316], [565, 314], [575, 314], [577, 316], [581, 322], [581, 324], [580, 325], [576, 326], [564, 327], [560, 327], [559, 326]]}, {"led": 5, "points": [[583, 314], [584, 313], [593, 312], [604, 312], [605, 313], [600, 323], [599, 324], [592, 325], [591, 325], [588, 322], [585, 318], [583, 315]]}, {"led": 6, "points": [[608, 322], [609, 320], [613, 313], [614, 312], [623, 311], [626, 314], [630, 320], [630, 323], [609, 323]]}, {"led": 7, "points": [[633, 312], [634, 311], [652, 311], [653, 312], [653, 313], [652, 322], [651, 323], [650, 323], [640, 322], [637, 319], [634, 315], [633, 313]]}, {"led": 8, "points": [[660, 311], [679, 311], [680, 312], [680, 313], [676, 319], [672, 323], [662, 323], [660, 322]]}, {"led": 9, "points": [[682, 322], [683, 320], [687, 314], [690, 311], [695, 311], [699, 312], [700, 313], [703, 318], [705, 322], [705, 323], [703, 324], [683, 323]]}, {"led": 10, "points": [[708, 313], [709, 312], [720, 312], [729, 313], [729, 316], [724, 323], [723, 324], [714, 324], [713, 323], [708, 314]]}, {"led": 11, "points": [[732, 323], [733, 321], [737, 315], [738, 314], [744, 314], [749, 315], [750, 316], [754, 324], [754, 326], [753, 327], [750, 327], [738, 326], [732, 325]]}, {"led": 12, "points": [[757, 317], [758, 316], [766, 316], [777, 317], [779, 319], [778, 321], [774, 326], [772, 328], [764, 328], [762, 327]]}, {"led": 13, "points": [[815, 330], [816, 329], [817, 329], [819, 330], [826, 334], [831, 337], [832, 338], [829, 341], [819, 348], [817, 349], [815, 349]]}, {"led": 14, "points": [[817, 357], [819, 355], [834, 344], [836, 343], [837, 343], [838, 344], [838, 358], [837, 359], [819, 359], [817, 358]]}, {"led": 15, "points": [[815, 366], [816, 365], [820, 365], [831, 366], [831, 368], [830, 370], [827, 374], [820, 383], [817, 386], [816, 386], [815, 385]]}];
function text(s,x,y,size=28,color='#fff'){ctx.font=`700 ${size}px Consolas,"Cascadia Mono","Microsoft YaHei UI",monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=Math.max(5,size*.15);ctx.strokeStyle='#090b10';ctx.strokeText(s,x,y);ctx.fillStyle=color;ctx.fillText(s,x,y);}
function circle(x,y,r,fill,stroke='#151820',width=5){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
function emittedColor(v){return typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)&&v.toLowerCase()!=='#000000'?v:null;}
// Dusty rose -> apricot -> sage -> teal -> blue -> lilac: no saturated RGB bands.
const ambientPalette=['#e5a0b0','#e6b184','#e0cd83','#aed498','#8bd3bc','#91bfe6','#b4aae6','#d5a4df'];
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
 text('待数据',500,283,23,'#d9e4ef');
}
function buttonCap(c,color,ambient=false){
 const glow=emittedColor(color),base=ctx.createRadialGradient(c.x-8,c.y-10,2,c.x,c.y,c.r);base.addColorStop(0,'#38434f');base.addColorStop(1,'#121922');
 circle(c.x,c.y,c.r+2,'#090d12','#536170',2);circle(c.x,c.y,c.r,base,'#0a0e14',3);
 if(glow){ctx.save();ctx.shadowColor=glow;ctx.shadowBlur=(ambient?16:8)*paintScale;circle(c.x,c.y,c.r-3,glow,'#ffffff44',1.5);ctx.restore();}
 else{ctx.beginPath();ctx.arc(c.x,c.y,c.r-4,Math.PI*1.12,Math.PI*1.82);ctx.strokeStyle='#6d798777';ctx.lineWidth=2;ctx.stroke();}
}
function bar(x,value,color,label,online){const y=230,h=440,w=38;ctx.lineJoin='round';ctx.lineWidth=6;ctx.strokeStyle='#07090d';ctx.fillStyle='#20252de0';ctx.beginPath();ctx.roundRect(x-w/2,y,w,h,12);ctx.fill();ctx.stroke();if(online){ctx.save();ctx.beginPath();ctx.roundRect(x-w/2+5,y+5,w-10,h-10,8);ctx.clip();ctx.fillStyle=color;const fill=(h-10)*Math.max(0,Math.min(100,value))/100;if(fill>0){ctx.beginPath();ctx.roundRect(x-w/2+5,y+h-5-fill,w-10,fill,Math.min(8,fill/2));ctx.fill();}ctx.restore();}text(label,x,y-43,32);text(online?`${Math.round(value).toString().padStart(3,' ')}%`:'—',x,y+h+40,34);}
function statuses(s,online){
 const st={...(s.game?.statuses||{})},now=performance.now();
 for(const key of ['absActive','tcActive','escActive']){if(online&&st[key]===true)latch[key]=now+220;if(online&&now<(latch[key]||0))st[key]=true;}
 const active=online&&s.game?.available&&s.game.paused!==true&&s.game.inMenu!==true?['ABS','TC','ESC'].filter(label=>st[label.toLowerCase()+'Active']===true):[];
 for(let i=0;i<active.length;i++){const label=active[i],x=500+(i-(active.length-1)/2)*156,y=826,color='#ffda56';ctx.fillStyle='#473c13f0';ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(x-73,y-21,146,42,11);ctx.fill();ctx.stroke();
  ctx.save();ctx.translate(x-45,y);ctx.strokeStyle=color;ctx.lineWidth=2.5;
  if(label==='ABS'){ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,0,17,-1.1,1.1);ctx.stroke();ctx.beginPath();ctx.arc(0,0,17,Math.PI-1.1,Math.PI+1.1);ctx.stroke();text('!',0,0,18,color);}
  else{ctx.strokeRect(-10,-11,20,15);ctx.beginPath();ctx.moveTo(-6,5);ctx.bezierCurveTo(-18,8,-1,11,-14,15);ctx.moveTo(9,5);ctx.bezierCurveTo(-4,8,14,11,2,15);ctx.stroke();}ctx.restore();text(label,x+18,y,31,color);
 }
}
// Percentage is always raw slip ratio × 100. Colour is a visual scale, not an optimum-grip target.
const slipPalettes={
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
function wheelSlip(s,online,a=assistView,only=null){
 const wheels=s.game?.wheels||[],now=performance.now();
 for(let i=0;i<4;i++){
  if(only!==null&&i!==only)continue;
  const w=wheels[i],nativeRatio=Number.isFinite(w?.ratio),reported=nativeRatio?w.ratio:w?.slipFeedback,valid=online&&s.game?.available&&s.game.paused!==true&&s.game.inMenu!==true&&Number.isFinite(reported),ratio=valid?reported:0,zero=i<2?295:645;
  const airborne=a.fresh&&a.unloaded[i];
  if(airborne){lockState[i].since=0;lockState[i].until=0;}
  const stoppedRolling=Number.isFinite(w?.omega)?Math.abs(w.omega)<2.5:Number.isFinite(w?.speedMs)&&Math.abs(w.speedMs)<.75;
  const candidate=valid&&nativeRatio&&!airborne&&Math.abs(s.game.speedKmh)>=10&&s.game.brake>.15&&ratio<=-.8&&stoppedRolling;
  if(candidate){if(!lockState[i].since)lockState[i].since=now;if(now-lockState[i].since>=80)lockState[i].until=now+300;}else lockState[i].since=0;
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
  if(valid&&nativeRatio&&(magnitude>=.005||isLocked))text((braking?'-':'+')+Math.min(999,magnitude*100).toFixed(0)+'%',tx,zero-5,38,isLocked?'#fff1f2':color);
  ctx.restore();
 }
}
function lateralBar(x,y,width,value){
 const valid=Number.isFinite(value),half=width/2,range=20,color=valid?slipColor(Math.abs(value)/range,false):'#a2b0be';
 ctx.save();
 // Match the four longitudinal rails: no white backing, only a quiet track and an active coloured extent.
 ctx.strokeStyle='#718399';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-half,y);ctx.lineTo(x+half,y);ctx.stroke();
 if(valid){
  const distance=Math.min(1,Math.abs(value)/range)*half,sign=Math.sign(value),end=x+sign*distance;
  if(distance>.5){ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=(8)*paintScale;ctx.beginPath();ctx.roundRect(value<0?end:x,y-10,distance,20,Math.min(9,distance/2));ctx.fill();ctx.shadowBlur=(0)*paintScale;}
  if(Math.abs(value)>=12){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.shadowColor=color;ctx.shadowBlur=(17)*paintScale;ctx.beginPath();ctx.roundRect(value<0?x-half:x,y-12,half,24,10);ctx.stroke();ctx.shadowBlur=(0)*paintScale;}
  // The filled width is the primary magnitude cue; a small end cap merely marks its measured endpoint.
  ctx.fillStyle=color;ctx.strokeStyle='#07111d';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(end-4,y-13,8,26,3);ctx.fill();ctx.stroke();
 }else{ctx.setLineDash([3,3]);ctx.strokeStyle='#738399';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x-4,y-13,8,26,3);ctx.stroke();ctx.setLineDash([]);}
 // Centre survives coloured fills: dark separator with a short white head above/below the rail.
 ctx.strokeStyle='#132334';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();ctx.strokeStyle='#f7fbff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-15);ctx.lineTo(x,y-11);ctx.moveTo(x,y+11);ctx.lineTo(x,y+15);ctx.stroke();ctx.restore();
}
function rgbMix(a,b,t){const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));const x=hex(a),y=hex(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,'0')).join('');}
// Whole rail hue reflects the current state; trend chevrons never command pedal movement.
function responseColor(value){
 const stops=[[0,'#ff183c'],[.15,'#ff623f'],[.4,'#ffc34e'],[.7,'#beed65'],[1,'#66f0c3']],v=Math.max(0,Math.min(1,value));
 for(let i=1;i<stops.length;i++)if(v<=stops[i][0])return rgbMix(stops[i-1][1],stops[i][1],(v-stops[i-1][0])/(stops[i][0]-stops[i-1][0]));
 return stops.at(-1)[1];
}
function pedalAssist(x,cue){
 if(!cue||!(cue.severity>.01))return;
 // One signal only. Real pedal fill is bottom-up; release reference blooms TOP -> DOWN on its border.
 const strength=Math.max(0,Math.min(1,cue.severity)),l=x-19,r=x+19,top=230,end=top+Math.max(12,440*strength),color=rgbMix('#ffdc7a','#ff244f',strength);
 const path=()=>{ctx.beginPath();ctx.moveTo(l,end);ctx.lineTo(l,top+12);ctx.quadraticCurveTo(l,top,l+12,top);ctx.lineTo(r-12,top);ctx.quadraticCurveTo(r,top,r,top+12);ctx.lineTo(r,end);};
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.shadowColor=color;
 ctx.globalAlpha=.28;ctx.lineWidth=12+strength*5;ctx.shadowBlur=(22+strength*20)*paintScale;path();ctx.stroke();
 ctx.globalAlpha=1;ctx.lineWidth=4+strength*3;ctx.shadowBlur=(12+strength*12)*paintScale;path();ctx.stroke();ctx.restore();
}
function axleReserve(online,a,key,x){
 const grip=online&&a.fresh?a.grip?.axles?.[key]:null,r=grip?.reserve,valid=grip?.available&&r;
 const y=94,w=210,h=18,left=x-w/2;
 text(key==='front'?'前轮响应':'后轮响应',x,28,20,'#bac9d8');
 const signed=valid&&(grip.rawReserve?.value??r.value)<.005&&grip.overrun>.015?-grip.overrun:r?.value;
 const round=v=>Math.round(Math.max(-1,Math.min(1,v))*20)*5;
 const color=valid?responseColor(signed):'#8091a4';
 const estimate=valid?(signed<0?'≈−'+Math.max(5,Math.abs(round(signed)))+'%':(grip.reason==='low-speed'||grip.reason==='unloaded'?'':'≈')+String(round(signed)).padStart(2,' ')+'%'):'—';
 text(estimate,x,61,valid?36:24,color);
 ctx.save();ctx.setLineDash([]);
 for(let side=0;side<2;side++){
  const bx=left+side*(w/2+1),bw=w/2-1,unloaded=valid&&grip.unloadedSides?.[side];
  const part=grip?.sides?.[side],value=part?.value??r?.value??0,current=Math.max(value,part?.current??grip?.currentReserve?.value??value),overrun=part?.overrun||0;
  ctx.shadowBlur=(0)*paintScale;ctx.fillStyle='#1d2b39';ctx.strokeStyle='#788b9e';ctx.lineWidth=2;
  ctx.beginPath();ctx.roundRect(bx,y-h/2,bw,h,5);ctx.fill();ctx.stroke();
  if(unloaded){
   // The ENTIRE anatomical left/right half is empty and outlined, never a tiny end bracket.
   ctx.clearRect(bx+2,y-h/2+2,bw-4,h-4);ctx.strokeStyle='#f5fcff';ctx.lineWidth=3;ctx.shadowColor='#e8f7ff';ctx.shadowBlur=(12)*paintScale;
   ctx.beginPath();ctx.roundRect(bx,y-h/2,bw,h,5);ctx.stroke();continue;
  }
  if(!valid)continue;
  // Both normal fills approach the shared centre. Overrun reverses along the outline.
  const at=level=>side===0?bx+bw*level:bx+bw*(1-level);
  const partColor=responseColor(value);ctx.save();ctx.beginPath();ctx.roundRect(bx,y-h/2,bw,h,5);ctx.clip();
  ctx.fillStyle=partColor;ctx.fillRect(Math.min(at(0),at(value)),y-h/2,bw*Math.max(0,Math.min(1,value)),h);
  if(current-value>.015){ctx.fillStyle=partColor+'55';ctx.fillRect(Math.min(at(value),at(current)),y-h/2,bw*(current-value),h);ctx.strokeStyle=partColor;ctx.lineWidth=2;
   for(let v=value;v<current;v+=8/bw){ctx.beginPath();ctx.moveTo(at(v),y+h/2);ctx.lineTo(at(Math.min(v+7/bw,current)),y-h/2);ctx.stroke();}}
  ctx.fillStyle='#f3fbff';ctx.fillRect(at(Math.min(1,current))-1,y-h/2,2,h);ctx.restore();
  if(overrun>.015){const inner=at(1),end=at(1-Math.min(1,overrun));
   ctx.strokeStyle='#ff183c';ctx.lineWidth=4;ctx.shadowColor='#ff183c';ctx.shadowBlur=(10)*paintScale;ctx.lineJoin='round';ctx.lineCap='round';
   ctx.beginPath();ctx.moveTo(end,y-h/2);ctx.lineTo(inner,y-h/2);ctx.lineTo(inner,y+h/2);ctx.lineTo(end,y+h/2);
   if(overrun>=.999){ctx.lineTo(end,y-h/2);}ctx.stroke();}

 }
 ctx.restore();
}
function handlingColor(kind,level){
 const palettes={understeer:['#edfaff','#6ce6dd','#e2ef69','#ffb147','#ff653d','#ff2047'],oversteer:['#edfaff','#87cbff','#a89dff','#df77e0','#ff558e','#ff234d'],both:['#edfaff','#aee893','#f0e56b','#ffac48','#ff5e42','#ff1749']};
 const stops=[0,.2,.45,.7,.9,1],colors=palettes[kind]||palettes.understeer,v=Math.sqrt(Math.max(0,Math.min(1,level)));
 for(let i=1;i<stops.length;i++)if(v<=stops[i])return rgbMix(colors[i-1],colors[i],(v-stops[i-1])/(stops[i]-stops[i-1]));return colors.at(-1);
}
function steeringNeedle(s,online,a){
 const grip=online&&a.fresh?a.grip:null;
 if(!grip?.available||a.steering?.mode==='static'||a.steering?.mode==='low_speed'||a.steering?.mode==='reverse')return;
 const handling=a.handling,level=Math.max(0,Math.min(1,handling?.severity||0)),kind=handling?.state;
 if(!['understeer','oversteer','both'].includes(kind))return;
 const label=kind==='understeer'?'推头':kind==='oversteer'?'甩尾':'四轮侧滑';
 const color=handlingColor(kind,level),width=kind==='both'?206:140;
 ctx.save();ctx.fillStyle='#0d1623e6';ctx.strokeStyle=color;ctx.lineWidth=2+level*2;ctx.shadowColor=color;ctx.shadowBlur=(5+level*13)*paintScale;
 ctx.beginPath();ctx.roundRect(500-width/2,39,width,65,15);ctx.fill();ctx.stroke();
 text(label,500,72,kind==='both'?38:48,color);ctx.restore();
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
 a=presentationView(a,performance.now());
 const lateral=online&&a.fresh?a.lateral:null;
 layout.group('frontLateral',()=>lateralBar(500,119,480,lateral?.front));
 layout.group('handling',()=>steeringNeedle(s,online,a));
 layout.group('frontResponse',()=>axleReserve(online,a,'front',245));
 layout.group('rearResponse',()=>axleReserve(online,a,'rear',755));
 layout.group('rearLateral',()=>lateralBar(500,787,480,lateral?.rear));
 if(!online||!a.fresh)return;
 // Pedal input and its release outline are one inseparable editable control.
 layout.group('decel',()=>{if(Number.isFinite(a.decel)){
  const value=Math.abs(a.decel)<.005?0:a.decel;text('实际减速',500,658,18,'#c1ccd9');text((value<0?'−':'')+Math.abs(value).toFixed(2)+' g',500,691,35,'#f5f9ff');
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
 text(c?c.magnitude.toFixed(2)+'g':'—g',x,y+27,21,c?'#f3ffff':'#9aaebe');ctx.restore();
}
function centreStripe(){
 // Physical yellow leather centre band, not an emissive LED.
 ctx.save();ctx.beginPath();ctx.moveTo(639,33);ctx.bezierCurveTo(648,30,666,30,675,33);ctx.lineTo(675,144);ctx.bezierCurveTo(666,146,648,146,639,144);ctx.closePath();ctx.clip();
 const yellow=ctx.createLinearGradient(639,0,675,0);yellow.addColorStop(0,'#ae8506');yellow.addColorStop(.12,'#f0c408');yellow.addColorStop(.38,'#ffe02a');yellow.addColorStop(.72,'#ffd510');yellow.addColorStop(.94,'#e9b80a');yellow.addColorStop(1,'#9d7405');
 ctx.globalCompositeOperation='source-atop';ctx.fillStyle=yellow;ctx.fillRect(638,29,39,119);
 ctx.globalCompositeOperation='luminosity';ctx.globalAlpha=.18;ctx.drawImage(image,0,0);ctx.restore();
}
function render(now){runtimePerf.renders++;
 const stage=layout.stage?.()||{width:1000,height:850,originX:0,originY:0,scale:1};
 const raster=layout.raster?.(stage,window.devicePixelRatio||1,window.innerWidth,window.innerHeight,params.has('stage'))||{width:stage.width,height:stage.height,ratio:1};
 paintScale=stage.scale*raster.ratio;uiInfo.raster=raster;
 if(canvas.width!==raster.width||canvas.height!==raster.height){canvas.width=raster.width;canvas.height=raster.height;}
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(stage.scale*raster.width/stage.width,0,0,stage.scale*raster.height/stage.height,stage.originX*raster.width/stage.width,stage.originY*raster.height/stage.height);let s=state;const live=s.connected&&(qa||Date.now()-lastGood<1000);if(demo){s={connected:true,angle:35*Math.sin(now/1800),brake:Math.max(0,Math.sin(now/1300))*100,throttle:Math.max(0,Math.cos(now/1700))*100,buttons:[17,26,54],leds:{buttons:['#56f7fc','#ff3165','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc'],knobs:['#ff3366','#2ee973','#315aff','#ff651c'],rpm:Array.from({length:16},(_,i)=>i<11?'#45f7c0':'#111')},ledSource:'demo'};}
 const online=demo||live;angle=online?s.angle:0;assistView=assistModel.update(online?s:{connected:false},qa&&Number.isFinite(qaClock)?qaClock:performance.now());
 layout.begin();
 const presented=presentationView(assistView,performance.now());
 layout.group('brake',()=>{bar(70,online?s.brake:0,'#ff354d','刹车',online);if(online&&presented.fresh)pedalAssist(70,presented.brake);});
 layout.group('throttle',()=>{bar(930,online?s.throttle:0,'#3eff97','油门',online);if(online&&presented.fresh)pedalAssist(930,presented.drive);});
 layout.group('wheel',()=>{
 ctx.save();ctx.translate(500,450);ctx.rotate(angle*Math.PI/180);ctx.scale(740/1315,740/1315);ctx.translate(-657.5,-598.5);
 if(image.complete&&image.naturalWidth){ctx.shadowColor='#03050b';ctx.shadowBlur=(3)*paintScale;ctx.shadowOffsetX=(2)*paintScale;ctx.drawImage(image,0,0);ctx.shadowBlur=(0)*paintScale;ctx.shadowOffsetX=(0)*paintScale;}
 
 if(window.DashRenderer)ctx.drawImage(DashRenderer.render({...s,angle},Number(params.get('page')||1)),529,344,256,81.4);
 const pressed=new Set(online?s.buttons:[]);let led=s.leds||{};const liveButtonLights=online&&buttonLightsAvailable(led);
 const map=s.inputProfile?.buttonMap;if(Array.isArray(map))controls.forEach((c,i)=>c.b=[Number.isInteger(map[i])?map[i]:i+1]);
 uiInfo.ambientButtons=!liveButtonLights;
 uiInfo.waiting=!demo&&telemetryWaiting(s.game,performance.now());
 const tendency=assistView.grip?.steeringState;
 const ambientAlert=Math.max(0,Math.min(tendency?.front||0,tendency?.rear||0),...Object.values(assistView.grip?.axles||{}).map(x=>x.overrun||0),...(s.game?.speedKmh>10?s.game?.wheels||[]:[]).map(w=>Math.max(0,Math.min(1,(-(w.ratio||0)-.65)/.35))));
 // Shapes measured from the original wheel image: 3 brow + 10 centre + 3 brow.
 if(!liveButtonLights&&s.game?.available&&s.game.maxRpm>0){const fraction=Math.max(0,Math.min(1,s.game.rpm/s.game.maxRpm));led={...led,rpm:ledShapes.map((_,i)=>i<Math.round(fraction*ledShapes.length)?(fraction>.96?(Math.floor(now/100)%2?'#ff314d':'#28050b'):fraction>.86?'#f0bb62':fraction>.7?'#8dcdb8':'#83a8d5'):'#11171e')};}
 for(const shape of ledShapes){const points=shape.points,light=emittedColor((led.rpm||[])[shape.led]);ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.lineJoin='round';ctx.lineWidth=7;ctx.strokeStyle='#171b20';ctx.fillStyle='#11171e';ctx.stroke();ctx.fill();
  if(light){ctx.fillStyle=light;ctx.fill();}ctx.lineWidth=1.3;ctx.strokeStyle=light?'#d9e5eb55':'#53617088';ctx.stroke();
 }
 for(const c of controls){if(c.led!==undefined)buttonCap(c,liveButtonLights&&typeof (led.buttons||[])[c.led]==='string'?(led.buttons||[])[c.led]:ambientButtonColor(c,now,ambientAlert),!liveButtonLights);const axisValue=c.axis&&online?(s.paddleMode==='combined'?s.handbrake:s[c.axis])||0:0;if(c.b.some(b=>pressed.has(b))||axisValue>1){circle(c.x,c.y,c.r+10,'#ffffff22','#fff',5);circle(c.x,c.y,c.r+16,'#ffffff00','#ffdc48',4);}}
 uiInfo.ambientKnobs=false;
 for(const e of encoders){const n=e.led-8,rawColor=(led.knobs||[])[n],ambient=!(online&&led.available===true&&typeof rawColor==='string'&&/^#[0-9a-f]{6}$/i.test(rawColor)),color=ambient?ambientButtonColor(e,now,ambientAlert):emittedColor(rawColor);if(ambient)uiInfo.ambientKnobs=true;if(Array.isArray(s.knobPositions))knobPositions[n]=s.knobPositions[n]??null;else for(let i=0;i<12;i++)if(pressed.has(e.first+i))knobPositions[n]=i;
  // Concentric graphite bezel, fine detent marks and one selected sector.
  circle(e.x,e.y,69,'#0b1017','#778493',2);circle(e.x,e.y,64,'#202a36','#05090e',3);
  for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2,selected=i===knobPositions[n];ctx.beginPath();ctx.arc(e.x,e.y,53,a+.045,a+Math.PI/6-.045);ctx.lineWidth=selected?17:10;ctx.strokeStyle=selected?(color||'#d8e5ee'):'#344150';ctx.stroke();
   ctx.beginPath();ctx.moveTo(e.x+60*Math.cos(a),e.y+60*Math.sin(a));ctx.lineTo(e.x+65*Math.cos(a),e.y+65*Math.sin(a));ctx.strokeStyle=selected?'#edf8ff':'#81909f';ctx.lineWidth=2;ctx.stroke();
  }
  if(color){ctx.save();ctx.shadowColor=color;ctx.shadowBlur=(ambient?15:0)*paintScale;ctx.beginPath();ctx.arc(e.x,e.y,65,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=ambient?4:3;ctx.stroke();ctx.restore();}
  const cap=ctx.createRadialGradient(e.x-10,e.y-12,2,e.x,e.y,38);cap.addColorStop(0,'#404c58');cap.addColorStop(1,'#141c26');circle(e.x,e.y,37,cap,'#080e16',3);
  for(let j=0;j<20;j++){const a=j*Math.PI/10;ctx.beginPath();ctx.moveTo(e.x+33*Math.cos(a),e.y+33*Math.sin(a));ctx.lineTo(e.x+37*Math.cos(a),e.y+37*Math.sin(a));ctx.strokeStyle='#76839166';ctx.lineWidth=1.5;ctx.stroke();}
  text(knobPositions[n]===null?'—':String(knobPositions[n]+1),e.x,e.y,29,'#f1f7ff');
  if(e.b.some(b=>pressed.has(b)))circle(e.x,e.y,73,'#ffffff00','#ffdc48',4);
 }
 for(const c of controls){const active=c.b.filter(b=>pressed.has(b));if(active.length)text(active.join('·'),c.x,c.y,c.r<20?18:23,'#eafaff');}
 const extra=[...pressed].filter(n=>!controls.some(c=>c.b.includes(n)));
 if(extra.length)text(extra.slice(0,8).join(' · '),657,680,27,'#eafaff');
 ctx.restore();
 uiInfo.waiting=!demo&&telemetryWaiting(s.game,performance.now());waitingBadge(uiInfo.waiting);
 });
 for(let i=0;i<4;i++)layout.group('slip'+i,()=>wheelSlip(s,online,assistView,i));
 drivingUi(s,online,assistView);
 layout.group('handbrake',()=>{if(online&&(s.handbrake||0)>.5){ctx.fillStyle='#101720ec';ctx.strokeStyle='#ffdc48';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(440,505,120,95,15);ctx.fill();ctx.stroke();text('手刹',500,526,24,'#ffdc48');text(Math.round(s.handbrake||0)+'%',500,569,38,'#fff');}
 });
 layout.group('statuses',()=>statuses(s,online));
 gBallView=gBallModel?.update(online?s.game:null,qa&&Number.isFinite(qaClock)?qaClock:performance.now());
 layout.group('gBall',()=>drawGBall(gBallView));
 layout.flush(ctx);
 if(demo)text('演示数据',500,839,16,'#ffdc48');
 if(!qa)requestAnimationFrame(render);
}
async function poll(){const requestAt=performance.now();try{const r=await fetch('/state',{cache:'no-store'});if(!r.ok)throw Error(r.status);state=await r.json();observeCost('network',performance.now()-requestAt);lastGood=Date.now();const processAt=performance.now();assistView=assistModel.update(state,processAt);observeCost('algorithm',performance.now()-processAt);runtimePerf.polls++;if(state.game?.packet!==runtimePerf.lastPacket){runtimePerf.uniquePackets++;runtimePerf.lastPacket=state.game?.packet;}}catch(e){runtimePerf.errors++;state={connected:false,error:'输入服务已断开'};}setTimeout(poll,16);}
if(!demo&&!qa)poll();requestAnimationFrame(render);
window.overlayDiagnostics={controls,encoders,getPerformance,getGBall:()=>gBallView,resetGPeak:()=>gBallModel?.clearPeak(),getUi:()=>({...uiInfo}),getState:()=>state,getAssist:()=>assistView,getPresentation:()=>presentation,setTestState:(s,at)=>{if(qa){state=s;lastGood=Date.now();if(Number.isFinite(at)){qaClock=at;assistView=assistModel.update(s,at);}else if(qaClock!==null)qaClock+=20;}}};
