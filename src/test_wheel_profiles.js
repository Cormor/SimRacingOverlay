'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../wheel-profile'),L=require('../layout');
const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'../wheel-packs/simagic-gt-pro-round/profile.json')));
const face=P.validate(pack);
assert.equal(face.dashboard,null);assert.equal(face.ledShapes.length,9);assert.equal(face.controls.filter(c=>c.led!==undefined).length,8);
for(const field of ['schemaVersion','id','image','calibration','ledShapes']){const bad={...pack,[field]:null};assert.throws(()=>P.validate(bad));}
assert.throws(()=>P.validate({...pack,image:pack.image.replace('image/png','image/svg+xml')}));
assert.throws(()=>P.validate({...pack,controls:[{...pack.controls[0],x:Infinity}]}));
assert.throws(()=>P.validate({...pack,controls:[{...pack.controls[0],b:[0]}]}));
assert.deepEqual(P.settings(),{faceId:'default',dashboardMode:'auto',buttonMaps:{}});
assert.deepEqual(P.settings({buttonMaps:JSON.parse('{"constructor":{"prototype":[1]}}')}).buttonMaps,{});
const original=L.clean(null),legacy=L.clean({version:3,controls:{wheel:{x:37,y:-18,sx:.8,sy:.8}}});
assert.equal(legacy.wheel.faceId,'default');assert.equal(legacy.controls.wheel.x,37);assert.equal(legacy.controls.dashboard.enabled,false);
const changed=L.clean({...legacy,wheel:{faceId:face.id,dashboardMode:'separate',buttonMaps:{[face.id]:{'button-1':[42]}}}});
assert.deepEqual(changed.controls.wheel,legacy.controls.wheel);assert.equal(changed.controls.dashboard.enabled,true);assert.deepEqual(L.clean(changed),changed);
assert.equal(L.clean({...changed,wheel:{...changed.wheel,dashboardMode:'hidden'}}).controls.dashboard.enabled,false);
const mapped=P.mapControls(face,changed.wheel.buttonMaps[face.id],Array(30).fill(19));
assert.deepEqual(mapped[0].b,[42]);assert.deepEqual(mapped[1].b,[]);assert.deepEqual(face.controls[0].b,[]);
assert.deepEqual(P.mapControls(face,{},Array(30).fill(19))[0].b,[],'clearing overrides cannot leak old wheel mapping');
assert.deepEqual(P.resample(Array.from({length:16},(_,i)=>i),9),[0,2,4,6,8,9,11,13,15]);assert.deepEqual(P.resample([0,1],1),[1]);
const lights=P.shiftColors({available:true,rpm:8000,maxRpm:8000},1000,9);assert.equal(lights.colors.length,9);assert(lights.colors.every(c=>c!=='#11171e'));
for(const state of [{available:false},{available:true,paused:true,rpm:8000,maxRpm:8000},{available:true,inMenu:true,rpm:8000,maxRpm:8000},{available:true}])assert.equal(P.shiftColors(state,1000,9),null);
assert(P.shiftColors({available:true,shiftLights:{indicator:0}},1000,9).colors.every(c=>c==='#11171e'),'valid zero stays off');
// Exercise the real overlay selection code with controlled I/O and image decode.
const root=path.resolve(__dirname,'..');let now=1000,deferred=null,decodeFailure=false,requested=[];
const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop(){}});return ()=>{};},set(o,k,v){o[k]=v;return true;}});
const scope={console,URLSearchParams,AbortController,Event,Buffer,location:{search:'?qa=1'},performance:{now:()=>now},Date,DrivingAssist:require('../assist'),WheelProfiles:P,OverlayPreset:require('../layout-preset'),
 document:{addEventListener(){},getElementById:()=>({getContext:()=>ctx})},Image:class{constructor(){this.complete=true;this.naturalWidth=1315;this.naturalHeight=1197;}async decode(){if(decodeFailure)throw Error('bad image');}},
 requestAnimationFrame(){},setTimeout,clearTimeout,addEventListener(){},dispatchEvent(){},fetch:async url=>{requested.push(url);if(deferred)return deferred;return {ok:true,text:async()=>JSON.stringify({...pack,id:url.split('/').pop().replace('.json','')})};}};
scope.window=scope;scope.globalThis=scope;vm.createContext(scope);
for(const file of ['layout.js','overlay.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
const run=s=>vm.runInContext(s,scope);
(async()=>{
 const selected=await scope.WheelFaces.select(face.id);assert.equal(selected.ok,true);assert.equal(scope.WheelFaces.get().id,face.id);assert.equal(scope.OverlayLayout.get().wheel.faceId,face.id);
 run('const input=OverlayLayout.get();input.wheel.buttonMaps[input.wheel.faceId]={"button-1":[42]};OverlayLayout.set(input);overlayDiagnostics.setTestState({connected:true,buttons:[42],inputProfile:{buttonMap:Array(30).fill(19)}},1000);overlayDiagnostics.renderTest(1000)');
 assert.deepEqual(Array.from(scope.overlayDiagnostics.controls[0].b),[42]);assert.deepEqual(Array.from(scope.overlayDiagnostics.controls[1].b),[]);
 await scope.WheelFaces.select('default');assert.equal(scope.OverlayLayout.get().wheel.faceId,'default');
 // A slow new face cannot replace a later choice of the cached original face.
 const other={...pack,id:'slow-face'};let resolve;deferred=new Promise(r=>{resolve=r;});const slow=scope.WheelFaces.select('slow-face');await scope.WheelFaces.select('default');resolve({ok:true,text:async()=>JSON.stringify(other)});await slow;deferred=null;
 assert.equal(scope.WheelFaces.get().id,'default');assert.equal(scope.OverlayLayout.get().wheel.faceId,'default');
 const before=scope.OverlayLayout.get();decodeFailure=true;const failed=await scope.WheelFaces.select('bad-face');decodeFailure=false;
 assert.equal(failed.ok,false);assert.equal(scope.WheelFaces.get().id,'default');assert.deepEqual(scope.OverlayLayout.get(),before);
 assert.equal(original.stage.scale,L.clean(null).stage.scale);
 console.log('PASS: data-only pack validation; old layout and per-face mappings; complete 16→9 RPM span, zero/pause/missing data; real overlay activation, last-choice wins and failure retention.');
})().catch(e=>{console.error(e);process.exitCode=1;});
