'use strict';
// UI-D3: one existing HUD renderer; this file only presents its output and layout.
(function(){
 if(new URLSearchParams(location.search).get('desktop')!=='1'||!window.desktopOverlay)return;
 const L=window.OverlayLayout,source=document.getElementById('overlay');
 // Forward only the already received device summary; no second telemetry source/model.
 function reportTrayState(){
  const s=window.overlayDiagnostics?.getState();
  if(!s||typeof window.desktopOverlay.reportTrayState!=='function')return;
  const input=window.overlayDiagnostics?.getHardwareStatus?.();
  const devices=Array.isArray(input?.devices)?input.devices.slice(0,64).map(d=>({
   id:typeof d?.id==='string'?d.id.slice(0,128):'',
   productId:typeof d?.productId==='string'?d.productId.slice(0,128):'',
   name:typeof d?.name==='string'?d.name.slice(0,256):'',
   type:typeof d?.type==='string'?d.type.slice(0,48):'',ageMs:d?.ageMs
  })):[];
  const hardware=input?.hardware?{epoch:input.hardware.epoch,sequence:input.hardware.sequence,ageMs:input.hardware.ageMs,validForMs:input.hardware.validForMs,channels:{steering:{state:input.hardware.channels?.steering?.state,deviceId:input.hardware.channels?.steering?.deviceId}}}:null;
  window.desktopOverlay.reportTrayState({hardware,sourceTimestamp:Number.isFinite(s.timestamp)?s.timestamp:null,error:typeof s.error==='string'?s.error.slice(0,384):'',devices});
 }
 const trayReportTimer=setInterval(reportTrayState,1000);reportTrayState();
 addEventListener('unload',()=>clearInterval(trayReportTimer),{once:true});
 let child=null,revision=0,loading=0,ghostFrame=0,loaded=false,disposed=false,layoutRequest=null,fallbackTimer=null,pendingLayout=false,loadError=null;
 let reference={active:false,paused:false,mode:'ghost'},layoutSnapshot=L.get();
 const subscriptions=[],ghost=document.createElement('canvas');ghost.id='desktop-ghost';ghost.setAttribute('aria-hidden','true');Object.assign(ghost.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',display:'none'});document.body.appendChild(ghost);
 function cancelGhost(){if(ghostFrame)cancelAnimationFrame(ghostFrame);ghostFrame=0;}
 function invalidateGhost(){if(!disposed&&ghost.style.display==='block'&&!ghostFrame)ghostFrame=requestAnimationFrame(()=>{ghostFrame=0;drawGhost();});}
 function applyReference(){const active=reference.active&&!reference.paused;if(!active||reference.mode!=='normal')cancelSceneGesture();sceneCanvas.style.display=active&&reference.mode==='normal'?'block':'none';invalidateSelection();source.style.visibility=active&&reference.mode!=='normal'?'hidden':'visible';ghost.style.display=active&&reference.mode==='ghost'?'block':'none';if(ghost.style.display==='block')invalidateGhost();else cancelGhost();}
 subscriptions.push(window.desktopOverlay.onReference(value=>{reference=value;applyReference();}));
 let page=Number(new URLSearchParams(location.search).get('page')||1);subscriptions.push(window.desktopOverlay.onPage(value=>{if(value===page)return;page=value;if(typeof params!=='undefined')params.set('page',String(value));window.dispatchEvent(new Event('overlay-refresh'));}));
 subscriptions.push(window.desktopOverlay.onScene(scene=>L.setDesktopStage(scene)));
 function editing(){return loaded&&child&&!child.closed&&(child.OverlayManager?.ownsLayout?.()??true);}
 function cancelLoad(){loading++;layoutRequest?.abort();layoutRequest=null;}
 async function load(){
  if(disposed)return;if(editing()){pendingLayout=true;return;}
  cancelLoad();const token=loading,request=new AbortController();layoutRequest=request;const timeout=setTimeout(()=>request.abort(),5000);loadError=null;notify();
  try{const r=await fetch('assets/layout.json',{cache:'no-store',signal:request.signal});if(!r.ok)throw Error('布局读取失败：'+r.status);const value=await r.json();
   if(disposed||token!==loading)return;if(editing()){pendingLayout=true;return;}const wasLoaded=loaded;loaded=true;pendingLayout=false;const before=revision;L.set(value);if(revision===before&&!wasLoaded)notify();
  }catch(error){if(!disposed&&token===loading){loadError=error.name==='AbortError'?'读取布局超时，现有布局保留':error.message;notify();}}
  finally{clearTimeout(timeout);if(layoutRequest===request)layoutRequest=null;}
 }
 function notify(){if(!child||child.closed)return;try{child.OverlayManager?.hostChanged();}catch(e){console.error('管理界面更新失败',e);}}
 subscriptions.push(L.onChange(()=>{revision++;layoutSnapshot=L.get();notify();invalidateGhost();invalidateSelection();}));
 function faceChanged(){revision++;notify();invalidateGhost();}
 window.addEventListener('wheel-face-change',faceChanged);
 // Desktop file changes are owned by the host watcher. Older hosts keep a
 // serial refresh; browser/OBS configuration refresh remains in editor.js.
 function fallback(){if(disposed)return;fallbackTimer=setTimeout(async()=>{fallbackTimer=null;await load();fallback();},1200);}
 const watched=typeof window.desktopOverlay.onLayoutChanged==='function';
 if(watched)subscriptions.push(window.desktopOverlay.onLayoutChanged(()=>{void load();}));
 const initialLoad=load();if(!watched)initialLoad.finally(fallback);
 function drawGhost(){if(disposed||ghost.style.display==='none')return;const s=L.stage(),r=L.raster(s,window.devicePixelRatio||1,innerWidth,innerHeight,true),ctx=ghost.getContext('2d');if(ghost.width!==r.width||ghost.height!==r.height){ghost.width=r.width;ghost.height=r.height;}ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ghost.width,ghost.height);ctx.setTransform(s.scale*r.width/s.width,0,0,s.scale*r.height/s.height,s.originX*r.width/s.width,s.originY*r.height/s.height);const v=layoutSnapshot,pose=window.overlayDiagnostics?.getDisplay?.()?.pose??0;
  for(const d of L.definitions){const c=v.controls[d.id];if(!c.enabled||['flags','handling','handbrake','statuses','decel'].includes(d.id))continue;const [x,y,w,h]=d.bounds;ctx.save();ctx.globalAlpha=c.opacity*c.imageOpacity*.25;ctx.translate(x+w/2+c.x,y+h/2+c.y);ctx.rotate(c.rotation*Math.PI/180);ctx.scale(c.sx,c.sy);ctx.translate(-x-w/2,-y-h/2);ctx.strokeStyle='#b7c3d0';ctx.fillStyle='#18222d';ctx.lineWidth=2/s.scale;
   if(d.id==='wheel'&&typeof image!=='undefined'&&image.complete&&image.naturalWidth&&typeof activeFace!=='undefined'){ctx.save();ctx.translate(500,450);ctx.rotate(pose*Math.PI/180);ctx.scale(740/1315,740/1315);ctx.scale(...activeFace.calibration);ctx.translate(-activeFace.center[0],-activeFace.center[1]);ctx.drawImage(wheelImage(),0,0);ctx.restore();}else{ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(10,w/5,h/5));ctx.fill();ctx.stroke();}ctx.restore();}
 }
 function frameChanged(){cancelGhost();drawGhost();if(child&&!child.closed)child.OverlayManager?.frameChanged(window.overlayDiagnostics?.getDisplay?.());}
 window.addEventListener('overlay-frame',frameChanged);window.addEventListener('resize',invalidateGhost);
 // Direct editing owns input for the whole scene before the first press.
 // The manager remains the sole gesture/history owner and docks outside HUD.
 const sceneCanvas=document.createElement('canvas');sceneCanvas.id='desktop-edit';sceneCanvas.tabIndex=0;sceneCanvas.setAttribute('aria-label','屏幕直接编辑：拖动组件，Esc取消拖动或返回布局，方向键微调');Object.assign(sceneCanvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',display:'none',touchAction:'none',outline:'none'});document.body.appendChild(sceneCanvas);
 const sceneTools=document.createElement('div');sceneTools.id='scene-tools';sceneTools.setAttribute('role','toolbar');sceneTools.setAttribute('aria-label','屏幕直接编辑操作');Object.assign(sceneTools.style,{position:'fixed',display:'none',zIndex:'3',gap:'4px',boxSizing:'border-box',padding:'2px',background:'#141719',border:'1px solid #756544',borderRadius:'8px',color:'#f5f2e9',font:'14px "Segoe UI","Microsoft YaHei UI",sans-serif'});document.body.appendChild(sceneTools);
 let sceneId=null,sceneStart=null,sceneDragging=false,selectionFrame=0,sceneNative={};
 const sceneEvidence={counts:{},events:[]};
 const managerAPI=()=>child&&!child.closed?child.OverlayManager:null;
 function sceneReady(){return !disposed&&reference.active&&!reference.paused&&reference.mode==='normal'&&!!managerAPI();}
 function scenePoint(e){const r=sceneCanvas.getBoundingClientRect(),s=L.stage();return {x:(e.clientX-r.left)*s.width/r.width,y:(e.clientY-r.top)*s.height/r.height};}
 function payload(e){return {...scenePoint(e),pointerId:e.pointerId,button:e.button,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey};}
 function recordScene(type,e,extra={}){sceneEvidence.counts[type]=(sceneEvidence.counts[type]||0)+1;if(type==='move'&&sceneEvidence.counts[type]%4)return;sceneEvidence.events.push({type,at:performance.now(),pointerId:e?.pointerId,x:e?.clientX,y:e?.clientY,...extra});if(sceneEvidence.events.length>64)sceneEvidence.events.shift();}
 function updateSceneTools(){const d=sceneNative.directEditor,r=d?.toolbarRect,visible=sceneReady()&&d?.fullScreen&&r&&r.width>0&&r.height>0;sceneTools.style.display=visible?'flex':'none';if(visible)Object.assign(sceneTools.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});}
 function returnToManager(){cancelSceneGesture();return managerAPI()?.setReferenceMode?.('ghost');}
 for(const [title,action]of [['返回布局页',returnToManager],['撤销',()=>managerAPI()?.sceneKey?.({key:'z',ctrlKey:true})],['完成',()=>managerAPI()?.finishEditing?.()]]){const button=document.createElement('button');button.type='button';button.textContent=title;Object.assign(button.style,{flex:'1',minWidth:'0',border:'1px solid #756544',borderRadius:'5px',background:'#22272b',color:'inherit',font:'inherit',cursor:'pointer'});button.onclick=action;sceneTools.appendChild(button);}
 function setSceneDragging(value){if(sceneDragging===value)return;sceneDragging=value;void window.desktopOverlay.setSceneDragging?.(value,value?undefined:managerAPI()?.sceneSelection?.().regions);}
 function cancelSceneGesture(){if(sceneId!==null){const id=sceneId;sceneId=null;sceneStart=null;const accepted=managerAPI()?.scenePointer?.('cancel',{pointerId:id});recordScene('cancel',null,{accepted});if(sceneCanvas.hasPointerCapture(id))sceneCanvas.releasePointerCapture(id);}setSceneDragging(false);void window.desktopOverlay.setReferenceInteraction?.(false);invalidateSelection();updateSceneTools();}
 function invalidateSelection(){if(!selectionFrame&&!disposed)selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;drawSelection();});}
 function drawSelection(){updateSceneTools();if(!sceneReady()||sceneCanvas.style.display==='none')return;const r=sceneCanvas.getBoundingClientRect(),dpr=devicePixelRatio||1,s=L.stage(),pw=Math.round(r.width*dpr),ph=Math.round(r.height*dpr);if(sceneCanvas.width!==pw||sceneCanvas.height!==ph){sceneCanvas.width=pw;sceneCanvas.height=ph;}const ctx=sceneCanvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,pw,ph);ctx.setTransform(dpr*r.width/s.width,0,0,dpr*r.height/s.height,0,0);const selection=managerAPI()?.sceneSelection?.(),v=layoutSnapshot;ctx.strokeStyle='#efd083';ctx.fillStyle='#efd083';ctx.lineWidth=2;
  if(selection?.grid){ctx.save();ctx.globalAlpha=.16;ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<s.width;x+=32){ctx.moveTo(x,0);ctx.lineTo(x,s.height);}for(let y=0;y<s.height;y+=32){ctx.moveTo(0,y);ctx.lineTo(s.width,y);}ctx.stroke();ctx.restore();}
  const toStage=p=>({x:s.originX+p.x*s.scale,y:s.originY+p.y*s.scale});
  for(const id of selection?.selected||[]){if(!L.byId.has(id))continue;const c=v.controls[id],corners=L.corners(L.byId.get(id),c).map(toStage);ctx.setLineDash(c.locked?[5,4]:[]);ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();}
  ctx.setLineDash([]);const marquee=selection?.marquee;if(marquee){const a=toStage(marquee.start),b=toStage(marquee.end);ctx.globalAlpha=.15;ctx.fillRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));ctx.globalAlpha=1;ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));}const b=selection?.bounds;if(b){const p=toStage(b),q=toStage({x:b.x+b.w,y:b.y+b.h});ctx.setLineDash([5,4]);ctx.strokeRect(p.x,p.y,q.x-p.x,q.y-p.y);ctx.setLineDash([]);ctx.fillRect(q.x-5,q.y-5,10,10);}
 }
 sceneCanvas.addEventListener('pointerdown',e=>{if(e.button!==0||!sceneReady())return;e.preventDefault();const accepted=managerAPI()?.scenePointer?.('down',payload(e));recordScene('down',e,{accepted,selected:managerAPI()?.sceneSelection?.().selected});if(accepted===false)return;sceneId=e.pointerId;sceneStart={x:e.clientX,y:e.clientY};sceneCanvas.setPointerCapture(e.pointerId);sceneCanvas.focus({preventScroll:true});void window.desktopOverlay.setReferenceInteraction?.(true);invalidateSelection();});
 sceneCanvas.addEventListener('pointermove',e=>{if(!sceneReady())return;if(sceneId===null||e.pointerId!==sceneId)return;if(!sceneDragging&&Math.hypot(e.clientX-sceneStart.x,e.clientY-sceneStart.y)>3)setSceneDragging(true);const accepted=managerAPI()?.scenePointer?.('move',payload(e));recordScene('move',e,{accepted,selected:managerAPI()?.sceneSelection?.().selected});});
 function finishScene(e,cancel){if(sceneId===null||e.pointerId!==sceneId)return;const id=sceneId;sceneId=null;sceneStart=null;const accepted=managerAPI()?.scenePointer?.(cancel?'cancel':'up',payload(e));recordScene(cancel?'cancel':'up',e,{accepted,selected:managerAPI()?.sceneSelection?.().selected});if(sceneCanvas.hasPointerCapture(id))sceneCanvas.releasePointerCapture(id);setSceneDragging(false);if(cancel)void window.desktopOverlay.setReferenceInteraction?.(false);invalidateSelection();}
 sceneCanvas.addEventListener('pointerup',e=>finishScene(e,false));sceneCanvas.addEventListener('pointercancel',e=>finishScene(e,true));sceneCanvas.addEventListener('lostpointercapture',e=>{if(sceneId===e.pointerId)cancelSceneGesture();});
 addEventListener('keydown',e=>{if(!sceneReady())return;if(e.key==='Escape'&&sceneId===null){e.preventDefault();void returnToManager();return;}if(e.target!==sceneCanvas)return;const handled=managerAPI()?.sceneKey?.({key:e.key,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,altKey:e.altKey,metaKey:e.metaKey});recordScene('key',null,{key:e.key,handled});if(handled!==false)e.preventDefault();if(e.key==='Escape')cancelSceneGesture();invalidateSelection();});
 addEventListener('blur',()=>{if(sceneId!==null)cancelSceneGesture();});
 subscriptions.push(window.desktopOverlay.onManagerState(value=>{sceneNative=value;updateSceneTools();if(!value.sceneInteractive)cancelSceneGesture();}));
 if(window.desktopOverlay.onSceneInputCancelled)subscriptions.push(window.desktopOverlay.onSceneInputCancelled(cancelSceneGesture));
 window.addEventListener('resize',invalidateSelection);
 function getLive(){const s=window.overlayDiagnostics?.getState()||{},input=window.overlayDiagnostics?.getHardwareStatus?.(),devices=input?.devices||[],wheelId=input?.hardware?.channels?.steering?.deviceId,wheel=devices.find(d=>d.id===wheelId);return {state:{connected:s.connected===true,game:s.game,hardware:input?.hardware??null,devices,buttons:wheel?.buttons||[]},ui:window.overlayDiagnostics?.getUi()||{},display:window.overlayDiagnostics?.getDisplay?.()??null};}
 function resumeSavedFace(){if(disposed||!loaded)return;const request=window.WheelFaces?.retryCurrent?.();if(request){faceChanged();void request.finally(faceChanged);}}
 if(window.desktopOverlay.onDrawDemand)subscriptions.push(window.desktopOverlay.onDrawDemand(value=>{if(value)resumeSavedFace();}));
 window.OverlayUIHost={
  createComponentPreview:()=>window.ComponentPreviewBridge.create(),
  attachManager:target=>{if(disposed||!target||target.closed||target.location.origin!==location.origin||target.location.pathname!=='/manager.html')return false;child=target;notify();return true;},
  open:page=>{if(disposed)return;resumeSavedFace();if(!loaded&&!layoutRequest)void load();if(child&&!child.closed){child.focus();child.OverlayManager?.navigate(page);return;}child=window.open('manager.html?page='+encodeURIComponent(page),'sro-manager','width=1440,height=960');},
  managerClosed:()=>{child=null;cancelLoad();reference={active:false,paused:false,mode:'ghost'};applyReference();if(pendingLayout||!loaded)void load();},
  snapshot:()=>({layout:layoutSnapshot,loaded,loadError,revision,face:(()=>{const face=window.WheelFaces?.get();if(!face)return null;const profile=typeof activeFace!=='undefined'?activeFace:null;return {...face,geometry:profile?{size:profile.size||(typeof image!=='undefined'?[image.naturalWidth,image.naturalHeight]:null),center:profile.center,calibration:profile.calibration}:null};})()}),getLive,reloadLayout:load,refreshLayout:()=>{if(pendingLayout)void load();},
  applyDraft:value=>{cancelLoad();L.set({...value,stage:L.stage()});return layoutSnapshot;},
  paintPreview:(ctx,rect,crop=null)=>{if(!source.width||!source.height)return;if(crop){const s=L.stage(),sx=source.width/s.width,sy=source.height/s.height;ctx.drawImage(source,crop.x*sx,crop.y*sy,crop.w*sx,crop.h*sy,rect.x,rect.y,rect.w,rect.h);}else ctx.drawImage(source,rect.x,rect.y,rect.w,rect.h);},
  selectionChanged:invalidateSelection,
  getSceneInputDiagnostics:()=>({counts:{...sceneEvidence.counts},events:sceneEvidence.events.slice(),sceneId,dragging:sceneDragging,ready:sceneReady()}),
  selectFace:id=>{const result=window.WheelFaces.select(id);faceChanged();return result;},cancelFace:()=>{window.WheelFaces.cancel();faceChanged();},highlight:id=>window.WheelFaces.highlight(id),
  resetGPeak:()=>window.overlayDiagnostics?.resetGPeak()
 };
 addEventListener('unload',()=>{cancelSceneGesture();disposed=true;cancelLoad();cancelGhost();if(selectionFrame)cancelAnimationFrame(selectionFrame);window.removeEventListener('resize',invalidateSelection);clearTimeout(fallbackTimer);for(const stop of subscriptions)if(typeof stop==='function')stop();window.removeEventListener('wheel-face-change',faceChanged);window.removeEventListener('overlay-frame',frameChanged);window.removeEventListener('resize',invalidateGhost);},{once:true});
})();
