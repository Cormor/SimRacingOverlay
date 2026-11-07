'use strict';
const canvas=document.getElementById('overlay'),nativeContext=canvas.getContext('2d');
let ctx=typeof OpacityPaint!=='undefined'?OpacityPaint.wrap(nativeContext,kind=>layout.drawOpacity?.(kind)??1):nativeContext;
let image=new Image();image.src='assets/wheel.png';
const originalWheelImage=image;
let roundWheelBitmap=null;
function wheelImage(){
 if(activeFace?.id!=='default')return image;
 if(roundWheelBitmap||!image.complete||!image.naturalWidth)return roundWheelBitmap||image;
 // Keep the leather photograph and hub. Trim its irregular outer contour to an
 // exact circle after the calibrated X correction; cache once, not per frame.
 if(typeof document.createElement!=='function')return image;
 const bitmap=document.createElement('canvas');bitmap.width=image.naturalWidth;bitmap.height=image.naturalHeight;
 const paint=bitmap.getContext('2d');paint.beginPath();paint.ellipse(655,602.5,562*1158/1139,562,0,0,Math.PI*2);paint.clip();paint.drawImage(image,0,0);
 roundWheelBitmap=bitmap;return bitmap;
}

// Exactly two current-face layers; the unstyled source bitmap still serves the editor ghost.
const wheelLayers={photo:{},lights:{}};
const wheelFaceStats={builds:0,reuses:0,photo:{builds:0,reuses:0,totalMs:0,maxMs:0,pixels:0},lights:{builds:0,reuses:0,totalMs:0,maxMs:0,pixels:0}};
function wheelDensity(){
 const t=ctx.getTransform?.();if(!t)return null;
 // Evaluate before steering rotation. The largest singular scale bounds every
 // orientation, including non-uniform layout scaling, without angle-driven resizes.
 const x=t.a*t.a+t.b*t.b,y=t.c*t.c+t.d*t.d,cross=t.a*t.c+t.b*t.d;
 const scale=Math.sqrt((x+y+Math.hypot(x-y,2*cross))/2)*(740/1315)*Math.max(...activeFace.calibration.map(Math.abs));
 return Math.ceil((scale-1e-6)*4)/4;
}
function paintWheelLayer(kind,key,density,draw){
 const layer=wheelLayers[kind],stats=wheelFaceStats[kind],w=Math.ceil(1315*density),h=Math.ceil(1197*density);
 if(!(density>0)||w*h>8*1024*1024||typeof document.createElement!=='function'){draw();return;}
 const style=layout.drawOpacity?.('image')+':'+(kind==='lights'?layout.drawOpacity?.('text'):'');key+=':'+style;
 if(!layer.bitmap||layer.key!==key||layer.density!==density){
  const started=performance.now();
  if(!layer.bitmap){layer.bitmap=document.createElement('canvas');const native=layer.bitmap.getContext('2d');layer.context=typeof OpacityPaint!=='undefined'?OpacityPaint.wrap(native,kind=>layout.drawOpacity?.(kind)??1):native;}
  if(layer.bitmap.width!==w||layer.bitmap.height!==h){layer.bitmap.width=w;layer.bitmap.height=h;}
  const previous=ctx;ctx=layer.context;ctx.save();
  try{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.setTransform(w/1315,0,0,h/1197,0,0);draw();}
  finally{ctx.restore();ctx=previous;}
  layer.key=key;layer.density=density;stats.builds++;stats.pixels=w*h;wheelFaceStats.builds++;
  const elapsed=performance.now()-started;stats.totalMs+=elapsed;stats.maxMs=Math.max(stats.maxMs,elapsed);
 }else{stats.reuses++;wheelFaceStats.reuses++;}
 // Per-command image/text opacity is already baked, so composite only once.
 nativeContext.drawImage(layer.bitmap,0,0,1315,1197);
}
const params=new URLSearchParams(location.search),demo=params.get('demo')==='1',qa=params.get('qa')==='1';
let paintScale=1;
let state={connected:false},angle=0,qaClock=null;
let paintAngle=0,displayAngle=null,displayFrame=null,displayLastAt=null,lastPaintSignature=null;
const hardwareInputs=new Map(),retiredHardwareEpochs=new Set();let hardwareEpoch=null,hardwareStatusSample=null,gameSteering=null;
const transportClock=new TelemetryClock.Clock();
let clockRequest=null,clockRetryAt=0,clockRevision=0;
function clearTimedState(now){
 advanceFeed();hardwareInputs.clear();hardwareStatusSample=null;gameSteering=null;
 lastInputAt=-Infinity;state={connected:false};gBallView=gBallModel?.update(null,now);queueScene(now);
}
function resetTransportClock(){
 clockRevision++;clockRequest?.abort();clockRequest=null;clockRetryAt=0;transportClock.reset();clearTimedState(performance.now());
}
function acceptClock(response,start,end,revision=clockRevision){
 if(revision!==clockRevision)return false;
 const epoch=response.headers?.get('X-Overlay-Clock-Epoch'),text=response.headers?.get('X-Overlay-Clock-Ms');
 const generation=transportClock.generation;
 const accepted=text!==null&&text!==undefined&&transportClock.observe(epoch,Number(text),start,end);
 if(accepted&&transportClock.generation!==generation){
  clearTimedState(end);
 }
 return accepted;
}
function requestClock(epoch,now){
 if(clockRequest||now<clockRetryAt||!transportClock.needsObservation(epoch,now))return;
 const controller=new AbortController(),start=performance.now(),revision=clockRevision;clockRequest=controller;
 const timeout=setTimeout(()=>controller.abort(),1000);
 fetch('/clock',{cache:'no-store',signal:controller.signal}).then(response=>{
  if(response.ok&&clockRequest===controller)acceptClock(response,start,performance.now(),revision);
 }).catch(()=>{}).finally(()=>{clearTimeout(timeout);if(clockRequest===controller){clockRequest=null;clockRetryAt=performance.now()+500;}});
}
function publishedFrame(meta,receivedAt){
 if(typeof meta?.epoch!=='string'||!Number.isFinite(meta.publishedMs)||transportClock.retired.has(meta.epoch))return null;
 requestClock(meta.epoch,receivedAt);
 const frame=transportClock.locate(meta,receivedAt);
 if(!frame||frame.at<0||frame.ageMs>=400){runtimePerf.agedFrames=(runtimePerf.agedFrames||0)+1;return null;}
 return frame;
}
if(typeof addEventListener==='function')addEventListener('unload',()=>clockRequest?.abort(),{once:true});

function observeHardware(meta,channels,now){
 if(typeof meta?.epoch!=='string'||!Number.isSafeInteger(meta.sequence)||meta.sequence<0||
    !Number.isFinite(meta.validForMs)||meta.validForMs<=0)return;
 if(meta.epoch!==hardwareEpoch){
  if(retiredHardwareEpochs.has(meta.epoch))return;
  if(hardwareEpoch!==null){retiredHardwareEpochs.add(hardwareEpoch);if(retiredHardwareEpochs.size>16)retiredHardwareEpochs.delete(retiredHardwareEpochs.values().next().value);}
  hardwareEpoch=meta.epoch;hardwareInputs.clear();
 }
 for(const [name,channel] of Object.entries(channels||{})){
  const prior=hardwareInputs.get(name);if(prior&&meta.sequence<=prior.sequence)continue;
  const ageMs=channel?.ageMs;
  hardwareInputs.set(name,{sequence:meta.sequence,at:now,ageMs:Number.isFinite(ageMs)&&ageMs>=0?ageMs:Infinity,
   validForMs:meta.validForMs,value:channel?.value,state:channel?.state});
 }
}
function hardwareValue(name,now){
 const input=hardwareInputs.get(name);
 return input?.state==='valid'&&Number.isFinite(input.value)&&input.ageMs+Math.max(0,now-input.at)<input.validForMs?input.value:null;
}
function steeringValue(now){
 if(demo)return Number.isFinite(state.angle)?state.angle:null;
 const hardware=hardwareValue('steering',now);if(hardware!==null)return hardware;
 return gameSteering&&now-gameSteering.at<400?gameSteering.angle:null;
}
// Neutral canvas pose is a drawing choice, not a valid zero-angle reading.
function steeringAt(now){return steeringValue(now)??0;}
function observeSteering(s,now){
 observeHardware(s?.hardware,s?.hardware?.channels,now);
 const hardware=s?.hardware,previous=hardwareStatusSample?.hardware;
 if(hardware&&hardware.epoch===hardwareEpoch&&Number.isSafeInteger(hardware.sequence)&&hardware.sequence>=0&&
    (!previous||hardware.epoch!==previous.epoch||hardware.sequence>previous.sequence)){
  hardwareStatusSample={hardware,devices:s.devices||[],at:now};
 }
 gameSteering=s?.game?.available&&Number.isFinite(s.gameSteeringAngle)?{at:now,angle:s.gameSteeringAngle}:null;
}
function displayInputs(s,now){
 if(qa||demo)return s;
 const status=getHardwareStatus(now),wheelId=status.hardware?.channels?.steering?.deviceId;
 const wheel=status.devices.find(device=>device.id===wheelId);
 const values={angle:steeringValue(now),buttons:Array.isArray(wheel?.buttons)?wheel.buttons:[]};
 for(const name of ['throttle','brake','handbrake']){
  const hardware=hardwareValue(name,now);
  values[name]=hardware!==null?hardware:s.inputSources?.[name]==='game'&&now-lastInputAt<400&&Number.isFinite(s[name])?s[name]:null;
 }
 return {...s,...values};
}
function getHardwareStatus(now=performance.now()){
 const hardware=hardwareStatusSample?.hardware,elapsed=hardwareStatusSample?Math.max(0,now-hardwareStatusSample.at):0;
 if(!hardware)return {hardware:null,devices:[]};
 const age=value=>Number.isFinite(value)&&value>=0?value+elapsed:null;
 const ageMs=age(hardware.ageMs),validForMs=hardware.validForMs;
 const current=hardware.epoch===hardwareEpoch&&Number.isFinite(validForMs)&&validForMs>0;
 const fresh=value=>current&&value!==null&&value<validForMs;
 const channels=Object.fromEntries(Object.entries(hardware.channels||{}).map(([name,value])=>{
  const channelAge=age(value?.ageMs),valid=value?.state==='valid'&&fresh(channelAge);
  return [name,{...value,ageMs:channelAge,state:value?.state==='valid'&&!valid?'stale':value?.state,value:valid?value.value:null}];
 }));
 const devices=(hardwareStatusSample.devices||[]).map(device=>({...device,ageMs:age(device.ageMs)})).filter(device=>fresh(device.ageMs));
 return {hardware:{...hardware,ageMs,channels,current},devices};
}
function openSteeringStream(){
 if(typeof EventSource==='undefined')return;
 const source=new EventSource('/steering-events');
 source.onmessage=event=>{
  try{
   const data=JSON.parse(event.data);
   const frame=publishedFrame(data.transport,performance.now());
   if(frame)observeHardware(data,{steering:{state:data.state,value:data.angle,ageMs:data.ageMs}},frame.at);
  }catch{/* A malformed message cannot refresh the age of the last sample. */}
 };
 // EventSource reconnects; the last sample expires by its capture age.
}
const UI=typeof OverlayTheme!=='undefined'?OverlayTheme:{font:'Consolas,"Microsoft YaHei UI",monospace',colors:{text:'#edf5ff',muted:'#a4b7cc',track:'#1c2938',border:'#73879d',panel:'#111923',accent:'#62d9ff',brake:'#ff5673',throttle:'#65e3ad',warning:'#ffc75a',danger:'#ff365d',estimateFront:'#83d7f2',estimateRear:'#f6bd84'},sizes:{caption:16,label:20,value:32,secondary:24,primary:28,headline:40,wheelKnob:29,wheelButton:23,flagTitle:28,flagHint:18}};
const uiInfo={version:'ue-editor-v1',ambientKnobs:false,ambientButtons:false,waiting:false};
const createAssistModel=()=>new DrivingAssist.Model();
const processor=!qa&&!demo&&typeof TelemetryProcessor!=='undefined'?new TelemetryProcessor.Client({createModel:createAssistModel}):null;
let assistModel=processor?null:createAssistModel(),assistModelContext=null,assistView={fresh:false,unloaded:[false,false,false,false]};
if(processor&&typeof addEventListener==='function')addEventListener('unload',()=>processor.dispose(),{once:true});
// Fixed-size counters, no per-frame logging. Recording derives rates from counter deltas.
const runtimePerf={startedAt:performance.now(),polls:0,errors:0,renders:0,uniquePackets:0,lastPacket:null,algorithm:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)},network:{count:0,totalMs:0,maxMs:0,buckets:Array(11).fill(0)}};
const costBounds=[.1,.25,.5,1,2,4,8,16,32,64,Infinity];
function observeCost(kind,ms){const c=runtimePerf[kind];c.count++;c.totalMs+=ms;c.maxMs=Math.max(c.maxMs,ms);c.buckets[costBounds.findIndex(b=>ms<=b)]++;}
function getPerformance(){const elapsedMs=performance.now()-runtimePerf.startedAt;const cost=c=>({count:c.count,totalMs:c.totalMs,maxMs:c.maxMs,buckets:c.buckets.slice()});return {elapsedMs,polls:runtimePerf.polls,errors:runtimePerf.errors,renders:runtimePerf.renders,displayFrames:runtimePerf.displayFrames||0,displayElapsed:runtimePerf.displayElapsed||0,slowDisplayFrames:runtimePerf.slowDisplayFrames||0,prepares:runtimePerf.prepares||0,uniquePackets:runtimePerf.uniquePackets,processingMode:runtimePerf.processingMode||processor?.status().mode||'main',processing:processor?.status()??null,processingErrors:runtimePerf.processingErrors||0,lastProcessingError:runtimePerf.lastProcessingError??null,discardedResults:runtimePerf.discardedResults||0,transport:streaming?'events':'http',clock:transportClock.status(),agedFrames:runtimePerf.agedFrames||0,streamFrames:runtimePerf.streamFrames||0,coalescedFrames:runtimePerf.coalescedFrames||0,algorithm:cost(runtimePerf.algorithm),network:cost(runtimePerf.network),bucketUpperMs:costBounds.map(b=>Number.isFinite(b)?b:null)};}
const gBallModel=typeof GBall!=='undefined'?new GBall.Model(qa?null:window.sessionStorage):null;let gBallView=null;
const layout=typeof OverlayLayout!=='undefined'?OverlayLayout:{begin(){},group(id,draw){draw();},flush(){}};
if(params.has('stage')&&typeof OverlayLayout!=='undefined'){try{OverlayLayout.setDesktopStage(JSON.parse(params.get('stage')));}catch{}}
const latch={};
const lockState=[{},{},{},{}];
const knobPositions=[null,null,null,null];
const defaultControls=[
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
const defaultEncoders=[{x:359,y:766,b:[26,27],first:53,led:8},{x:476,y:878,b:[39,40],first:89,led:9},{x:837,y:878,b:[30,31],first:77,led:10},{x:954,y:766,b:[28,29],first:65,led:11}];
const defaultLedShapes=[{"led": 0, "points": [[481, 338], [482, 337], [492, 331], [496, 329], [498, 331], [498, 348], [497, 349], [495, 349], [492, 347], [482, 340], [481, 339]]}, {"led": 1, "points": [[475, 344], [476, 343], [477, 343], [492, 354], [496, 357], [496, 358], [495, 359], [476, 359], [475, 358]]}, {"led": 2, "points": [[481, 366], [483, 365], [496, 365], [498, 367], [498, 384], [496, 386], [491, 381], [481, 368]]}, {"led": 3, "points": [[533, 319], [535, 317], [542, 316], [552, 315], [554, 315], [555, 316], [555, 318], [551, 326], [549, 328], [541, 328], [536, 323]]}, {"led": 4, "points": [[559, 324], [563, 316], [565, 314], [575, 314], [577, 316], [581, 322], [581, 324], [580, 325], [576, 326], [564, 327], [560, 327], [559, 326]]}, {"led": 5, "points": [[583, 314], [584, 313], [593, 312], [604, 312], [605, 313], [600, 323], [599, 324], [592, 325], [591, 325], [588, 322], [585, 318], [583, 315]]}, {"led": 6, "points": [[608, 322], [609, 320], [613, 313], [614, 312], [623, 311], [626, 314], [630, 320], [630, 323], [609, 323]]}, {"led": 7, "points": [[633, 312], [634, 311], [652, 311], [653, 312], [653, 313], [652, 322], [651, 323], [650, 323], [640, 322], [637, 319], [634, 315], [633, 313]]}, {"led": 8, "points": [[660, 311], [679, 311], [680, 312], [680, 313], [676, 319], [672, 323], [662, 323], [660, 322]]}, {"led": 9, "points": [[682, 322], [683, 320], [687, 314], [690, 311], [695, 311], [699, 312], [700, 313], [703, 318], [705, 322], [705, 323], [703, 324], [683, 323]]}, {"led": 10, "points": [[708, 313], [709, 312], [720, 312], [729, 313], [729, 316], [724, 323], [723, 324], [714, 324], [713, 323], [708, 314]]}, {"led": 11, "points": [[732, 323], [733, 321], [737, 315], [738, 314], [744, 314], [749, 315], [750, 316], [754, 324], [754, 326], [753, 327], [750, 327], [738, 326], [732, 325]]}, {"led": 12, "points": [[757, 317], [758, 316], [766, 316], [777, 317], [779, 319], [778, 321], [774, 326], [772, 328], [764, 328], [762, 327]]}, {"led": 13, "points": [[815, 330], [816, 329], [817, 329], [819, 330], [826, 334], [831, 337], [832, 338], [829, 341], [819, 348], [817, 349], [815, 349]]}, {"led": 14, "points": [[817, 357], [819, 355], [834, 344], [836, 343], [837, 343], [838, 344], [838, 358], [837, 359], [819, 359], [817, 358]]}, {"led": 15, "points": [[815, 366], [816, 365], [820, 365], [831, 366], [831, 368], [830, 370], [827, 374], [820, 383], [817, 386], [816, 386], [815, 385]]}];
const defaultFace={id:'default',name:'原款方向盘',controls:defaultControls.map((c,i)=>({...c,id:'button-'+i,label:'按键 '+(i+1)})),encoders:defaultEncoders.map((e,i)=>({...e,id:'encoder-'+i,label:'旋钮 '+(i+1),r:69})),ledShapes:defaultLedShapes,dashboard:[529,344,256,81.4],center:[655,602.5],calibration:[1139/1158,1]};
let activeFace=defaultFace,controls=defaultFace.controls.map(c=>({...c,b:c.b.slice()})),encoders=defaultFace.encoders,ledShapes=defaultLedShapes;
let mappingHighlight=null;
let faceRequest=0,pendingFace=null,faceError=null,observedLayoutFace='default',faceJob=null,faceDisposed=false,activeFaceEpoch=0;
const faceEpochs=new Map(),faceFailures=new Map();
const faceCache=new Map([['default',{profile:defaultFace,image:originalWheelImage,epoch:0}]]);
const faceEpoch=id=>faceEpochs.get(id)||0;
async function prepareFace(id,epoch=faceEpoch(id),ownerSignal=null){
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('盘面标识无效');
 const abort=new AbortController();let timedOut=false,rejectAbort;
 const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(Error(timedOut?'盘面载入超时':'盘面载入已取消'));});
 abort.signal.addEventListener('abort',rejectAbort,{once:true});const cancel=()=>abort.abort();
 if(ownerSignal?.aborted)cancel();else ownerSignal?.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(()=>{timedOut=true;cancel();},10000);
 const current=()=>{if(abort.signal.aborted||epoch!==faceEpoch(id))throw Error('盘面资源已更新或载入已取消');};
 const load=async()=>{
  current();const cached=faceCache.get(id);if(cached?.epoch===epoch){if(cached.image.decode)await cached.image.decode();current();return cached;}
  const r=await fetch('assets/wheel-packs/'+id+'.json',{cache:'no-store',signal:abort.signal});if(!r.ok)throw Error('盘面尚未下载或文件缺失');
  const body=await r.text();current();if(body.length>8*1024*1024)throw Error('盘面文件过大');const profile=WheelProfiles.validate(JSON.parse(body));if(profile.id!==id)throw Error('盘面标识不匹配');
  const bitmap=new Image();bitmap.src=profile.image;await bitmap.decode();current();if(bitmap.naturalWidth!==1315||bitmap.naturalHeight!==1197)throw Error('盘面图像尺寸无效');
  const value={profile,image:bitmap,epoch};faceCache.set(id,value);return value;
 };
 try{return await Promise.race([load(),cancelled]);}
 finally{clearTimeout(timeout);ownerSignal?.removeEventListener('abort',cancel);abort.signal.removeEventListener('abort',rejectAbort);}
}
function cancelFaceLoad(){++faceRequest;faceJob?.controller?.abort();faceJob=null;pendingFace=null;}
async function activateFace(id,commit=false){
 if(faceDisposed)return {ok:false,cancelled:true};cancelFaceLoad();const job={token:faceRequest,id,commit,controller:null};faceJob=job;pendingFace=id;faceError=null;
 // Resource changes retire only the old read. The user's selection Promise keeps
 // ownership until the latest resource generation succeeds, fails or is cancelled.
 for(;;){const epoch=faceEpoch(id);job.controller=new AbortController();
  try{const next=await prepareFace(id,epoch,job.controller.signal);if(faceJob!==job||job.token!==faceRequest)return {ok:false,cancelled:true};if(epoch!==faceEpoch(id))continue;
   activeFace=next.profile;activeFaceEpoch=epoch;image=next.image;controls=activeFace.controls.map(c=>({...c,b:c.b.slice()}));encoders=activeFace.encoders;ledShapes=activeFace.ledShapes;knobPositions.fill(null);roundWheelBitmap=null;wheelLayers.photo.key=null;wheelLayers.lights.key=null;faceFailures.delete(id);
   let before=null;if(commit){before=JSON.stringify(layout.get());const value=layout.get();value.wheel.faceId=id;observedLayoutFace=id;layout.set(value);}
   faceJob=null;pendingFace=null;queueScene(performance.now());window.dispatchEvent?.(new Event('wheel-face-change'));return {ok:true,id,before};
  }catch(error){if(faceJob!==job||job.token!==faceRequest)return {ok:false,cancelled:true};if(epoch!==faceEpoch(id))continue;
   faceJob=null;pendingFace=null;faceFailures.set(id,epoch);faceError=String(error.message);const reason=faceError;window.dispatchEvent?.(new Event('wheel-face-change'));
   // An unrelated pack may have changed while this selection owned the loader.
   syncFaceLayout();return {ok:false,error:reason};
  }
 }
}
function syncFaceLayout(){
 if(faceDisposed)return;const id=layout.get?.().wheel?.faceId||'default',changed=id!==observedLayoutFace;observedLayoutFace=id;
 if(changed){faceFailures.delete(id);if(faceJob)cancelFaceLoad();}if(faceJob)return;const epoch=faceEpoch(id);
 if(activeFace.id===id&&activeFaceEpoch===epoch||faceFailures.get(id)===epoch)return;
 void activateFace(id);
}
function wheelResourcesChanged(ids){
 if(faceDisposed||!Array.isArray(ids))return;const changed=new Set(ids.filter(id=>typeof id==='string'&&id!=='default'&&/^[a-z][a-z0-9-]{0,63}$/.test(id)));if(!changed.size)return;
 for(const id of changed){faceEpochs.set(id,faceEpoch(id)+1);faceCache.delete(id);faceFailures.delete(id);}
 if(faceJob){if(changed.has(faceJob.id))faceJob.controller?.abort();return;}syncFaceLayout();
}
const stopWheelResources=window.desktopOverlay?.onWheelResourcesChanged?.(wheelResourcesChanged);
if(typeof addEventListener==='function')addEventListener('unload',()=>{faceDisposed=true;cancelFaceLoad();if(typeof stopWheelResources==='function')stopWheelResources();},{once:true});
window.WheelFaces={cancel:cancelFaceLoad,highlight:id=>{mappingHighlight=id;queueScene(performance.now());},select:id=>activateFace(id,true),retryCurrent:()=>{const id=layout.get().wheel.faceId;return !faceJob&&id!==activeFace.id?activateFace(id):Promise.resolve({ok:true});},prepare:prepareFace,get:()=>({id:activeFace.id,name:activeFace.name,pending:pendingFace,error:faceError,dashboard:activeFace.dashboard,controls:activeFace.controls,encoders:activeFace.encoders}),busy:()=>pendingFace!==null};
function text(s,x,y,size=UI.sizes.primary,color=UI.colors.text){ctx.font=`600 ${size}px ${UI.font}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=Math.max(2,size*.09);ctx.strokeStyle=UI.colors.panel;ctx.strokeText(s,x,y);ctx.fillStyle=color;ctx.fillText(s,x,y);}
function circle(x,y,r,fill,stroke='#151820',width=5){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
function emittedColor(v){return typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)&&v.toLowerCase()!=='#000000'?v:null;}
// Dusty rose -> apricot -> sage -> teal -> blue -> lilac: no saturated RGB bands.
const ambientPalette=UI.palettes?.ambient||['#e5a0b0','#e6b184','#e0cd83','#aed498','#8bd3bc','#91bfe6','#b4aae6','#d5a4df'];
function shiftLightColors(game,now){
 if(typeof WheelProfiles!=='undefined')return WheelProfiles.shiftColors(game,now,ledShapes.length);
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
 // The optional photo has transparent cutouts beside its lower buttons.
 // Keep light and shadow inside the physical bezel rather than emitting into a hole.
 const clipped=activeFace.id!=='default';if(clipped){ctx.save();ctx.beginPath();ctx.arc(c.x,c.y,c.r+3,0,Math.PI*2);ctx.clip();}
 const glow=emittedColor(color),base=ctx.createRadialGradient(c.x-8,c.y-10,2,c.x,c.y,c.r);base.addColorStop(0,'#38434f');base.addColorStop(1,'#121922');
 circle(c.x,c.y,c.r+2,'#090d12','#536170',2);circle(c.x,c.y,c.r,base,'#0a0e14',3);
 if(glow){ctx.save();ctx.shadowColor=glow;ctx.shadowBlur=(ambient?16:8)*paintScale;circle(c.x,c.y,c.r-3,glow,'#ffffff44',1.5);ctx.restore();}
 else{ctx.beginPath();ctx.arc(c.x,c.y,c.r-4,Math.PI*1.12,Math.PI*1.82);ctx.strokeStyle='#6d798777';ctx.lineWidth=2;ctx.stroke();}
 if(clipped)ctx.restore();
}
const pedalBorderColors={green:'#66f0c3',yellow:'#ffc34e',red:'#ff183c'};
function bar(x,value,color,label,online,traction){
 online=online&&Number.isFinite(value);
 const y=230,h=440,w=38;
 ctx.lineJoin='round';ctx.lineWidth=6;ctx.strokeStyle=(online&&pedalBorderColors[traction?.state])||'#07090d';
 ctx.fillStyle='#20252de0';ctx.beginPath();ctx.roundRect(x-w/2,y,w,h,12);ctx.fill();ctx.stroke();
 if(online){
  ctx.save();ctx.beginPath();ctx.roundRect(x-w/2+5,y+5,w-10,h-10,8);ctx.clip();ctx.fillStyle=color;
  const fill=(h-10)*Math.max(0,Math.min(100,value))/100;
  if(fill>0){ctx.beginPath();ctx.roundRect(x-w/2+5,y+h-5-fill,w-10,fill,Math.min(8,fill/2));ctx.fill();}
  ctx.restore();
 }
 text(label,x,y-43,UI.sizes.value||32);
 text(online?`${Math.round(value).toString().padStart(3,' ')}%`:'—',x,y+h+40,UI.sizes.value);
}
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
// Two long lateral rails on each side: FRONT above REAR, both fill toward the wheel centre.
// Longitudinal information lives only at the actual throttle/brake borders.
function wheelLateral(cx,cy,value,unloaded,side,research,evidenceExpired){
 const shown=Number.isFinite(value),width=190,height=18,left=cx-width/2;
 const shape=()=>{ctx.beginPath();ctx.roundRect(left,cy-height/2,width,height,6);};
 ctx.save();ctx.lineJoin='round';ctx.shadowBlur=0;shape();ctx.fillStyle=UI.colors.track;ctx.fill();
 if(unloaded){ctx.strokeStyle='#f5fcff';ctx.lineWidth=3;ctx.shadowColor='#e8f7ff';ctx.shadowBlur=14*paintScale;ctx.stroke();ctx.restore();return;}
 if(shown){
  ctx.save();shape();ctx.clip();ctx.fillStyle=evidenceExpired?'#738497':responseColor(value);
  ctx.fillRect(side===0?left:left+width*(1-value),cy-height/2,width*value,height);ctx.restore();
 }
 const borderKnown=shown&&!evidenceExpired;
 const warning=borderKnown?1-value:0,fit=borderKnown?research?.forceResponse?.lateral:null;
 const evidence=fit?.quality??0,secondary=fit?value+(fit.gain-value)*evidence:value;
 const richness=.5+.5*Math.max(evidence,warning);
 shape();ctx.strokeStyle=borderKnown?rgbMix('#9cb3c7',responseColor(secondary),richness):'#738497';ctx.lineWidth=2+warning*2;
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
  const value=online&&a.fresh?a.lateralSlip?.[row*2+side]:null;
  const front=row===0?a.frontResponse:null;
  const length=Number.isFinite(value)&&front?value*(1-front.reduction):value;
  wheelLateral(x,row?60:34,length,!!grip?.unloadedSides?.[side],side,a.feedback?.wheels?.[row*2+side],front?.evidenceExpired);
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
 const feedback=FeedbackResearch.ageView(a.feedback,now);
 const needle=Math.sign(old?.grip?.needle)!==Math.sign(g.needle)?g.needle:blend(old?.grip?.needle,g.needle);
 const freshCue=cue=>cue&&now-cue.observedAt<240?cue:null;
 const frontResponse=freshCue(a.frontResponse)??(a.frontResponse?.reduction>0?{reduction:0,evidenceExpired:true}:null);
 presentation={...a,grip:{...g,axles,needle},feedback,frontResponse,drive:freshCue(a.drive),brake:freshCue(a.brake)};return presentation;
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
function componentKey(id,s,online,p,now,faceKey,dashboardKey){
 const g=s.game,a=assistView;
 if(id==='dashboard')return dashboardKey;
 if(id==='wheel')return [faceKey,uiInfo.waiting];
 if(id==='brake'||id==='throttle')return [online,p.fresh,id==='brake'?[s.brake,p.brake?.state]:[s.throttle,p.drive?.state]];
 if(id.startsWith('slip')&&!id.startsWith('slipAngle')){const i=Number(id.slice(4)),w=g?.wheels?.[i];return [online,g?.available,g?.paused,g?.inMenu,g?.speedKmh,g?.brake,w,a.fresh,a.unloaded?.[i],w?.ratio<-.65||(lockState[i].until||0)>now?Math.floor(now/20):0];}
 if(id==='frontResponse'||id==='rearResponse')return [online,p.fresh,p.lateralSlip,p.frontResponse?.reduction,p.frontResponse?.evidenceExpired,a.grip?.axles?.front?.unloadedSides,a.grip?.axles?.rear?.unloadedSides,p.feedback?.wheels.map(w=>[w.forceResponse.lateral?.gain,w.forceResponse.lateral?.quality])];
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

 const s=displayInputs(state,now),live=s.connected&&(qa||now-lastInputAt<1000);
 const online=demo||live;angle=online?s.angle:null;
 if(!online||performance.now()-assistView.processedAt>400)assistView={fresh:false,unloaded:[false,false,false,false]};
 layout.begin();
 uiInfo.waiting=!demo&&telemetryWaiting(s.game,now);
 for(const key of ['absActive','tcActive','escActive'])if(online&&s.game?.statuses?.[key]===true)latch[key]=now+220;
 for(let i=0;i<4;i++)advanceWheelLock(s,online,assistView,i,now);
 const presented=presentationView(assistView,now);
 const retained=params.get('edit')==='1'?null:componentPaint;
 layout.group('brake',()=>bar(70,online?s.brake:0,UI.colors.brake,'刹车',online,presented.brake));
 layout.group('throttle',()=>bar(930,online?s.throttle:0,UI.colors.throttle,'油门',online,presented.drive));
 const wheelSettings=layout.get?.().wheel||{faceId:'default',dashboardMode:'auto',buttonMaps:{}};
 const overrides=wheelSettings.buttonMaps?.[activeFace.id]||{};
 controls=typeof WheelProfiles!=='undefined'?WheelProfiles.mapControls(activeFace,overrides,s.inputProfile?.buttonMap):activeFace.controls.map((c,i)=>({...c,b:Number.isInteger(s.inputProfile?.buttonMap?.[i])?[s.inputProfile.buttonMap[i]]:c.b.slice()}));
 encoders=typeof WheelProfiles!=='undefined'?WheelProfiles.mapControls({...activeFace,controls:activeFace.encoders},overrides):activeFace.encoders;
 const pressed=new Set(online?s.buttons:[]);let led=s.leds||{};const liveButtonLights=activeFace.id==='default'&&online&&buttonLightsAvailable(led);
 uiInfo.ambientButtons=!liveButtonLights;
 const ambientPeriod=1000/30,ambientAt=Math.floor(now/ambientPeriod)*ambientPeriod;
 const tendency=assistView.grip?.steeringState;
 const ambientAlert=Math.max(0,Math.min(tendency?.front||0,tendency?.rear||0),...Object.values(assistView.grip?.axles||{}).map(x=>x.overrun||0),...(s.game?.speedKmh>10?s.game?.wheels||[]:[]).map(w=>Math.max(0,Math.min(1,(-(w.ratio||0)-.65)/.35))));
 // Screen-only fallback: game-reported shift thresholds, not a hardware LED acknowledgement.
 if(!(activeFace.id==='default'&&online&&led.available===true&&Array.isArray(led.rpm)&&led.rpm.some(v=>typeof v==='string'))&&online&&!uiInfo.waiting&&s.game?.available){
  const lights=shiftLightColors(s.game,now);
  if(lights){led={...led,rpm:lights.colors};uiInfo.rpmLightSource=lights.source;}else uiInfo.rpmLightSource='unavailable';
 }else uiInfo.rpmLightSource=activeFace.id==='default'&&online&&led.available===true?'observed-device':'unavailable';
 if(uiInfo.rpmLightSource==='unavailable'||s.game?.paused||s.game?.inMenu)led={...led,rpm:[]};
 if(typeof WheelProfiles!=='undefined')led={...led,rpm:WheelProfiles.resample(led.rpm,ledShapes.length)};
 const rpmPaint=ledShapes.map(shape=>emittedColor((led.rpm||[])[shape.led]));
 const buttonPaint=controls.map(c=>{
  const axisValue=c.axis&&online?(s.paddleMode==='combined'?s.handbrake:s[c.axis])||0:0;
  const color=c.led===undefined?null:liveButtonLights?(led.buttons||[])[c.led]:ambientButtonColor(c,ambientAt,ambientAlert);
  return {c,color,highlight:c.id===mappingHighlight||c.b.some(b=>pressed.has(b))||axisValue>1};
 });
 const knobPaint=encoders.map((e,index)=>{
  const n=e.led===undefined?index:e.led-8,rawColor=(led.knobs||[])[n],ambient=e.led!==undefined&&!(activeFace.id==='default'&&online&&led.available===true&&typeof rawColor==='string'&&/^#[0-9a-f]{6}$/i.test(rawColor));
  const color=e.led===undefined?null:ambient?ambientButtonColor(e,ambientAt,ambientAlert):emittedColor(rawColor);
  if(activeFace.id==='default'&&Array.isArray(s.knobPositions))knobPositions[n]=s.knobPositions[n]??null;
  else if(Number.isInteger(e.first)){for(let i=0;i<12;i++)if(pressed.has(e.first+i))knobPositions[n]=i;}else knobPositions[n]=null;
  return {e,color,ambient,position:knobPositions[n]};
 });
 uiInfo.ambientKnobs=knobPaint.some(x=>x.ambient);
 const dash=window.DashRenderer,page=Number(params.get('page')||1);
 const inlineDash=activeFace.dashboard&&wheelSettings.dashboardMode==='auto'?dash?.prepare({game:s.game},page):null;
 const separateDash=wheelSettings.dashboardMode==='separate'?dash?.prepare({game:s.game},page):null;
 const imageReady=image.complete&&image.naturalWidth;
 // Telemetry only invalidates the bitmap when it changes a drawn value.
 const faceKey=JSON.stringify([activeFace.id,imageReady,mappingHighlight,paintScale,[...pressed],
  !liveButtonLights,rpmPaint,buttonPaint.map(({c,color,highlight})=>[c.b,color,highlight]),
  knobPaint.map(({e,color,ambient,position})=>[e.b,color,ambient,position])]);
 const photoKey=JSON.stringify([activeFace.id,imageReady,paintScale]);
 const wheelKey=JSON.stringify([photoKey,faceKey,inlineDash?.key]);
 const drawPhoto=()=>{
 if(imageReady){ctx.shadowColor='#03050b';ctx.shadowBlur=(3)*paintScale;ctx.shadowOffsetX=(2)*paintScale;ctx.drawImage(wheelImage(),0,0);ctx.shadowBlur=(0)*paintScale;ctx.shadowOffsetX=(0)*paintScale;}
 if(activeFace.id==='default'&&imageReady)centreStripe();
 };
 const drawLights=()=>{
 // Shapes measured from the original wheel image: 3 brow + 10 centre + 3 brow.
 for(let i=0;i<ledShapes.length;i++){const points=ledShapes[i].points,light=rpmPaint[i];ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.lineJoin='round';ctx.lineWidth=activeFace.ledStroke??7;ctx.strokeStyle='#171b20';ctx.fillStyle='#11171e';ctx.stroke();ctx.fill();
  if(light){ctx.fillStyle=light;ctx.fill();}ctx.lineWidth=1.3;ctx.strokeStyle=light?'#d9e5eb55':'#53617088';ctx.stroke();
 }
 for(const {c,color,highlight} of buttonPaint){if(c.led!==undefined)buttonCap(c,color,!liveButtonLights);if(highlight){circle(c.x,c.y,c.r+10,'#ffffff22','#fff',5);circle(c.x,c.y,c.r+16,'#ffffff00','#ffdc48',4);}}
 for(const {e,color,ambient,position} of knobPaint){
  if(activeFace.id!=='default'){if(color&&e.lightPoints){ctx.save();ctx.beginPath();ctx.moveTo(...e.lightPoints[0]);for(const point of e.lightPoints.slice(1))ctx.lineTo(...point);ctx.closePath();ctx.globalAlpha=.38;ctx.fillStyle=color;ctx.fill();ctx.restore();}if(e.id===mappingHighlight||e.b.some(b=>pressed.has(b)))circle(e.x,e.y,e.r+8,'#ffffff00','#ffdc48',4);continue;}
  // Concentric graphite bezel, fine detent marks and one selected sector.
  circle(e.x,e.y,69,'#0b1017','#778493',2);circle(e.x,e.y,64,'#202a36','#05090e',3);
  for(let i=0;i<12;i++){const a=i*Math.PI/6-Math.PI/2,selected=i===position;ctx.beginPath();ctx.arc(e.x,e.y,53,a+.045,a+Math.PI/6-.045);ctx.lineWidth=selected?17:10;ctx.strokeStyle=selected?(color||'#d8e5ee'):'#344150';ctx.stroke();
   ctx.beginPath();ctx.moveTo(e.x+60*Math.cos(a),e.y+60*Math.sin(a));ctx.lineTo(e.x+65*Math.cos(a),e.y+65*Math.sin(a));ctx.strokeStyle=selected?'#edf8ff':'#81909f';ctx.lineWidth=2;ctx.stroke();
  }
  if(color){ctx.save();ctx.shadowColor=color;ctx.shadowBlur=(ambient?15:0)*paintScale;ctx.beginPath();ctx.arc(e.x,e.y,65,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=ambient?4:3;ctx.stroke();ctx.restore();}
  const cap=ctx.createRadialGradient(e.x-10,e.y-12,2,e.x,e.y,38);cap.addColorStop(0,'#404c58');cap.addColorStop(1,'#141c26');circle(e.x,e.y,37,cap,'#080e16',3);
  for(let j=0;j<20;j++){const a=j*Math.PI/10;ctx.beginPath();ctx.moveTo(e.x+33*Math.cos(a),e.y+33*Math.sin(a));ctx.lineTo(e.x+37*Math.cos(a),e.y+37*Math.sin(a));ctx.strokeStyle='#76839166';ctx.lineWidth=1.5;ctx.stroke();}
  text(position===null?'—':String(position+1),e.x,e.y,UI.sizes.wheelKnob,'#f1f7ff');
  if(e.b.some(b=>pressed.has(b)))circle(e.x,e.y,73,'#ffffff00','#ffdc48',4);
 }
 for(const c of controls){const active=c.b.filter(b=>pressed.has(b));if(active.length)text(active.join('·'),c.x,c.y,c.r<20?18:23,'#eafaff');}
 const extra=[...pressed].filter(n=>!controls.some(c=>c.b.includes(n)));
 if(extra.length&&activeFace.id==='default')text(extra.slice(0,8).join(' · '),657,680,27,'#eafaff');
 };
 layout.group('wheel',()=>{
 const density=wheelDensity();
 ctx.save();ctx.translate(500,450);ctx.rotate(paintAngle*Math.PI/180);ctx.scale(740/1315,740/1315);
 // Calibrated opaque rim: x=76..1234, y=33..1172. Correct the original
 // photograph before rotation; all buttons and the dashboard share this transform.
 ctx.scale(...activeFace.calibration);ctx.translate(-activeFace.center[0],-activeFace.center[1]);
 paintWheelLayer('photo',photoKey,density,drawPhoto);
 if(inlineDash)ctx.drawImage(dash.paint(inlineDash,displayAngle),...activeFace.dashboard);
 paintWheelLayer('lights',faceKey,density,drawLights);
 ctx.restore();
 waitingBadge(uiInfo.waiting);
 });
 layout.group('dashboard',()=>{if(separateDash)ctx.drawImage(dash.paint(separateDash,0),370,210,260,83);});
 for(let i=0;i<4;i++)layout.group('slip'+i,()=>wheelSlip(s,online,assistView,i,false));
 drivingUi(s,online,presented);
 layout.group('handbrake',()=>{if(online&&(s.handbrake||0)>.5){ctx.fillStyle='#101720ec';ctx.strokeStyle='#ffdc48';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(440,505,120,95,15);ctx.fill();ctx.stroke();text('手刹',500,526,UI.sizes.secondary,'#ffdc48');text(Math.round(s.handbrake||0)+'%',500,569,UI.sizes.value,'#fff');}
 });
 layout.group('statuses',()=>statuses(s,online,false));

 layout.group('gBall',()=>drawGBall(gBallView));
 layout.group('flags',()=>{if(online)flagBanner(s.game);});
 finishScene(stage,raster,retained,s,online,presented,now,wheelKey,separateDash?.key??null);
}

// Three independent clocks: telemetry owns estimation; this 30 Hz fallback owns
// decoration/deadlines; requestAnimationFrame only submits the newest prepared scene.
let preparedScene=null,paintPending=false,sceneTimer=null,sceneSignature=null;
function finishScene(stage,raster,retained,s,online,presented,now,faceKey,dashboardKey){
 const jobs=layout.capture?.();
 const keys=Object.fromEntries((jobs||[]).map(j=>[j.id,JSON.stringify(componentKey(j.id,s,online,presented,now,faceKey,dashboardKey))]));
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
 displayAngle=qa?(Number.isFinite(angle)?angle:null):steeringValue(at);paintAngle=displayAngle??0;
 const paintSignature=sceneSignature+'@'+displayAngle;
 if(!qa&&paintSignature===lastPaintSignature)return;lastPaintSignature=paintSignature;
 const {stage,raster,retained,jobs,keys,game}=preparedScene;
 runtimePerf.renders++;
 if(canvas.width!==raster.width||canvas.height!==raster.height){canvas.width=raster.width;canvas.height=raster.height;}
 ctx.setTransform(1,0,0,1,0,0);
 if(!retained)ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.setTransform(stage.scale*raster.width/stage.width,0,0,stage.scale*raster.height/stage.height,stage.originX*raster.width/stage.width,stage.originY*raster.height/stage.height);
 retained?.begin(canvas,stage,raster,id=>id==='wheel'?keys[id]+'@'+displayAngle:keys[id]);
 const compositesBefore=retained?.stats?.composites;
 layout.flush(ctx,retained,jobs);
 if(demo)text('演示数据',500,839,16,'#ffdc48');
 if(!retained||retained.stats?.composites!==compositesBefore||demo||layout.selection?.().length){
  displayFrame={frameId:(displayFrame?.frameId||0)+1,at,angle:displayAngle,pose:paintAngle};
  window.dispatchEvent?.(new Event('overlay-frame'));
 }
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
 layout.onChange?.(()=>{syncFaceLayout();queueScene(performance.now());});
 syncFaceLayout();
 if(typeof addEventListener==='function')addEventListener('resize',()=>queueScene(performance.now()));
 if(typeof window!=='undefined')window.addEventListener('overlay-refresh',()=>{if(componentPaint)componentPaint.invalidate();sceneSignature=null;queueScene(performance.now());});
 if(typeof document!=='undefined'){let wasHidden=document.hidden===true;document.addEventListener('visibilitychange',()=>{const recovered=wasHidden&&!document.hidden;wasHidden=document.hidden===true;if(recovered&&!demo&&!qa)resetTransportClock();if(!document.hidden){if(componentPaint)componentPaint.invalidate();sceneSignature=null;queueScene(performance.now());}});}
 if(typeof addEventListener==='function')addEventListener('pageshow',event=>{if(event.persisted&&!demo&&!qa)resetTransportClock();});
 if(demo){
  const sample=()=>{const now=performance.now();state={connected:true,angle:35*Math.sin(now/1800),brake:Math.max(0,Math.sin(now/1300))*100,throttle:Math.max(0,Math.cos(now/1700))*100,buttons:[17,26,54],leds:{buttons:['#56f7fc','#ff3165','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc','#56f7fc'],knobs:['#ff3366','#2ee973','#315aff','#ff651c'],rpm:Array.from({length:16},(_,i)=>i<11?'#45f7c0':'#111')},ledSource:'demo'};
   observeSteering(state,now);lastInputAt=now;assistView=assistModel.update(state,now);gBallView=gBallModel?.update(null,now);
   queueScene(now);setTimeout(sample,1000/60);
  };sample();
 }else if(!qa)queueScene(performance.now());
}
function testState(s,at){
 if(!qa)return;state=s;observeSteering(state,performance.now());lastInputAt=performance.now();
 qaClock=Number.isFinite(at)?at:qaClock===null?performance.now():qaClock+20;
 assistView=assistModel.update(s,qaClock);gBallView=gBallModel?.update(s.connected?s.game:null,qaClock);
}

let stream=null,streaming=false,streamLast=0,streamOpenedAt=0,feedEpoch=0,pendingFrame=null,processing=false;
let inputContext=null,inputContextEpoch=0,lastSourceTime=null;
function clearAssist(){assistView={fresh:false,unloaded:[false,false,false,false]};}
function advanceFeed(){feedEpoch++;pendingFrame=null;clearAssist();}
function recordProcessingError(error){
 runtimePerf.processingErrors=(runtimePerf.processingErrors||0)+1;
 runtimePerf.lastProcessingError={code:error?.code||'processing-error',message:String(error?.message||error||'Calculation failed').slice(0,256),at:performance.now()};
 clearAssist();
}
function validSnapshot(s){return s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.connected==='boolean';}
async function consume(incoming,receivedAt){
 // Input time is the bridge publication projected into this browser's clock.
 // Queue delay is already part of its age; model completion never renews it.
 const game=incoming.game,context=JSON.stringify([incoming.connected,game?.available,game?.source,game?.carModel,game?.vehicleIdentity,game?.streamEpoch,game?.paused,game?.inMenu,transportClock.generation]);
 if(context!==inputContext||(Number.isFinite(game?.sampleTime)&&Number.isFinite(lastSourceTime)&&game.sampleTime<lastSourceTime)){
  inputContext=context;inputContextEpoch++;clearAssist();
 }
 lastSourceTime=Number.isFinite(game?.sampleTime)?game.sampleTime:null;
 state=incoming;lastInputAt=receivedAt;
 uiInfo.inputProtocol=typeof incoming.hardware?.epoch==='string'?'capture-clock-v2':'unsupported';
 observeSteering(incoming,receivedAt);
 gBallView=gBallModel?.update(incoming.connected?game:null,receivedAt);
 queueScene(performance.now());
 if(pendingFrame)runtimePerf.coalescedFrames=(runtimePerf.coalescedFrames||0)+1;
 pendingFrame={incoming,receivedAt,feedEpoch,contextEpoch:inputContextEpoch};if(processing)return;
 processing=true;
 try{while(pendingFrame){
  const frame=pendingFrame;pendingFrame=null;
  if(frame.feedEpoch!==feedEpoch||frame.contextEpoch!==inputContextEpoch)continue;
  let result;const processAt=performance.now();
  try{
   if(processor)result=await processor.run(frame.incoming,frame.receivedAt,frame.contextEpoch);
   else{if(!assistModel||assistModelContext!==frame.contextEpoch){assistModel=createAssistModel();assistModelContext=frame.contextEpoch;}result={ok:true,view:assistModel.update(frame.incoming,frame.receivedAt),costMs:performance.now()-processAt,mode:'main'};}
  }catch(error){assistModel=null;result={ok:false,error:{code:'model-error',message:String(error?.message||error)},mode:processor?.status().mode||'main'};}
  runtimePerf.processingMode=result.mode;runtimePerf.polls++;
  if(frame.incoming.game?.packet!==runtimePerf.lastPacket){runtimePerf.uniquePackets++;runtimePerf.lastPacket=frame.incoming.game?.packet;}
  const current=frame.feedEpoch===feedEpoch&&frame.contextEpoch===inputContextEpoch;
  if(!result.ok){if(current){recordProcessingError(result.error);queueScene(performance.now());}continue;}
  observeCost('algorithm',result.costMs);
  if(!current||performance.now()-frame.receivedAt>400||(result.view.fresh&&(!Number.isFinite(result.view.processedAt)||performance.now()-result.view.processedAt>400))){
   runtimePerf.discardedResults=(runtimePerf.discardedResults||0)+1;continue;
  }
  assistView=result.view;queueScene(performance.now());
 }}finally{processing=false;}
}
function loseStream(source){
 if(source!==stream||!source)return;source.close();stream=null;const wasOwner=streaming;streaming=false;if(wasOwner){advanceFeed();queueScene(performance.now());}setTimeout(openStream,1000);
}
function openStream(){
 if(stream||typeof EventSource==='undefined')return;
 try{
  const source=new EventSource('/events');stream=source;streamOpenedAt=performance.now();
  source.onmessage=event=>{
   if(source!==stream)return;
   let incoming;
   try{incoming=JSON.parse(event.data);if(!validSnapshot(incoming))throw Error('Invalid snapshot');}catch{loseStream(source);return;}
   const receivedAt=performance.now();runtimePerf.streamFrames=(runtimePerf.streamFrames||0)+1;
   const frame=publishedFrame(incoming.transport,receivedAt);if(!frame)return;
   if(!streaming)advanceFeed();streamLast=receivedAt;streaming=true;
   consume(incoming,frame.at).catch(recordProcessingError);
  };
  source.onerror=()=>loseStream(source);
 }catch{stream=null;setTimeout(openStream,1000);}
}
async function poll(){
 const requestAt=performance.now();
 if(stream&&requestAt-(streaming?streamLast:streamOpenedAt)>400)loseStream(stream);
 if(streaming){setTimeout(poll,100);return;}
 const epoch=feedEpoch,revision=clockRevision,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1500);let incoming=null,acceptedEpoch=epoch;
 try{
  const r=await fetch('/state',{cache:'no-store',signal:controller.signal});const owned=epoch===feedEpoch&&!streaming;acceptClock(r,requestAt,performance.now(),revision);if(owned)acceptedEpoch=feedEpoch;if(!r.ok)throw Error(r.status);
  incoming=await r.json();if(!validSnapshot(incoming))throw Error('Invalid snapshot');
 }catch(e){incoming=null;if(!streaming&&epoch===feedEpoch){runtimePerf.errors++;advanceFeed();state={connected:false,error:'输入服务已断开'};gameSteering=null;gBallView=gBallModel?.update(null,performance.now());queueScene(performance.now());}}
 finally{clearTimeout(timeout);}
 // Network acquisition and calculation failures have different owners.
 // HTTP keeps acquiring the newest input while a model sample is in flight.
 if(incoming&&!streaming&&acceptedEpoch===feedEpoch){const now=performance.now();observeCost('network',now-requestAt);const frame=publishedFrame(incoming.transport,now);if(frame)consume(incoming,frame.at).catch(recordProcessingError);}
 setTimeout(poll,Math.max(0,1000/60-(performance.now()-requestAt)));
}
if(!demo&&!qa){openStream();openSteeringStream();poll();}startSceneClock();
window.overlayDiagnostics={get controls(){return controls;},get encoders(){return encoders;},getPerformance,getGBall:()=>gBallView,resetGPeak:()=>{if(!gBallModel)return;gBallModel.clearPeak();const now=performance.now();gBallView=gBallModel.view(now);queueScene(now);return {ok:true};},getUi:()=>({...uiInfo}),getState:()=>state,getHardwareStatus,getAssist:()=>assistView,getPresentation:()=>presentation,getPaint:()=>componentPaint?.stats,getWheelFace:()=>({...wheelFaceStats,photo:{...wheelFaceStats.photo},lights:{...wheelFaceStats.lights},dashboard:window.DashRenderer?.getPerformance?.()}),getDisplay:()=>displayFrame?{...displayFrame}:null,renderTest:at=>{if(qa){prepareScene(at??performance.now());render();}},paintTest:()=>{if(qa)render();},setTestState:testState};
