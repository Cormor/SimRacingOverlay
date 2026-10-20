'use strict';
(function(){
 const L=window.OverlayLayout,canvas=document.getElementById('overlay'),editing=new URLSearchParams(location.search).get('edit')==='1'&&!!window.desktopOverlay;
 let selected='wheel',drag=null,saveTimer=null,dirty=false,revision=0;
 async function load(){if(dirty||drag)return;try{const r=await fetch('assets/layout.json',{cache:'no-store'});if(r.ok){L.set(await r.json());if(editing)sync();}}catch{}}
 function save(){dirty=true;revision++;clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{const token=revision;try{const r=await desktopOverlay.saveLayout(L.get());if(!r.ok)throw Error(r.error);if(token===revision){dirty=false;notice.textContent='已保存 · OBS 同步此布局';}}catch(e){notice.textContent='保存失败：'+e.message;}},180);}
 function flushSaveNow(){clearTimeout(saveTimer);revision++;if(!dirty)return {ok:true};try{const r=desktopOverlay.saveLayoutNow(L.get());dirty=!r.ok;if(!r.ok)notice.textContent='保存失败：'+r.error;return r;}catch(e){notice.textContent='保存失败：'+e.message;return {ok:false,error:e.message};}}
 window.overlayEditor={flushSaveNow};
 addEventListener('beforeunload',e=>{if(dirty&&!flushSaveNow().ok){e.preventDefault();e.returnValue=false;}});

 window.desktopOverlay?.onScene(scene=>L.setDesktopStage(scene));
 load();setInterval(load,1200);
 if(!editing)return;
 document.body.classList.add('editing');
 const panel=document.createElement('aside');panel.id='editor';panel.innerHTML=`<header id="panelGrip">布局编辑 <span>拖此栏移动面板</span></header>
 <label>控件 <select id="control"></select></label><div class="hint">拖框内移动；右下角等比缩放；边中点单轴缩放</div>
 <div class="pair"><label>X <input id="posX" type="number" step="1"></label><label>Y <input id="posY" type="number" step="1"></label></div>
 <div class="pair"><label>宽 × <input id="scaleX" type="number" min="0.2" max="4" step="0.05"></label><label>高 × <input id="scaleY" type="number" min="0.2" max="4" step="0.05"></label></div>
 <label>等比 × <input id="uniform" type="number" min="0.2" max="4" step="0.05"></label>
 <label>整体 <input id="opacity" type="range" min="0" max="100" step="1"><output id="opacityValue"></output></label>
 <label>文字 <input id="textOpacity" type="range" min="0" max="100" step="1"><output id="textOpacityValue"></output></label>
 <label>图像/图形 <input id="imageOpacity" type="range" min="0" max="100" step="1"><output id="imageOpacityValue"></output></label>
 <button id="resetOpacity" style="width:100%">复位透明度</button>
 <div class="pair"><button id="resetPosition">复位位置</button><button id="resetSize">复位尺寸</button></div>
 <div class="pair"><button id="resetWidth">复位宽度</button><button id="resetHeight">复位高度</button></div><div class="pair"><button id="back">下移一层</button><button id="front">上移一层</button></div>
 <div class="pair"><button id="bottom">置底</button><button id="top">置顶</button></div>
 <div class="pair"><button id="moveWindow">拖动整体窗口</button><button id="resetPeak">清空 G 峰值</button></div>
 <button id="finish" style="width:100%;background:#346356">完成并保存</button><div id="notice" class="hint">自动保存 · 允许重叠 · Ctrl+Alt+M 完成</div>`;
 document.body.appendChild(panel);
 const el=id=>panel.querySelector('#'+id),notice=el('notice'),select=el('control');
 for(const d of L.definitions){const o=document.createElement('option');o.value=d.id;o.textContent=d.label;select.appendChild(o);}
 function sync(){L.select(selected);select.value=selected;const c=L.get().controls[selected];for(const [id,k] of [['posX','x'],['posY','y'],['scaleX','sx'],['scaleY','sy']])el(id).value=Number(c[k].toFixed(2));el('uniform').value=Number(Math.sqrt(c.sx*c.sy).toFixed(2));for(const k of ['opacity','textOpacity','imageOpacity']){el(k).value=Math.round(c[k]*100);el(k+'Value').textContent=Math.round(c[k]*100)+'%';}el('textOpacity').disabled=['frontLateral','rearLateral'].includes(selected);el('imageOpacity').disabled=selected==='decel';}
 function change(fn){const l=L.get(),c=l.controls[selected],d=L.definitions.find(d=>d.id===selected);fn(c,l);l.controls[selected]=L.fit(d,c);L.set(l);sync();save();}
 select.onchange=()=>{selected=select.value;sync();};
 for(const [id,k] of [['posX','x'],['posY','y'],['scaleX','sx'],['scaleY','sy']])el(id).onchange=()=>{const v=Number(el(id).value);if(Number.isFinite(v))change(c=>c[k]=v);};
 for(const k of ['opacity','textOpacity','imageOpacity'])el(k).oninput=()=>change(c=>c[k]=Number(el(k).value)/100);
 el('resetOpacity').onclick=()=>change(c=>{c.opacity=1;c.textOpacity=1;c.imageOpacity=1;});
 el('uniform').onchange=()=>{const v=Number(el('uniform').value);if(Number.isFinite(v))change(c=>{const old=Math.sqrt(c.sx*c.sy),ratio=v/old;c.sx*=ratio;c.sy*=ratio;});};
 el('resetWidth').onclick=()=>change(c=>c.sx=1);el('resetHeight').onclick=()=>change(c=>c.sy=1);
 el('resetPosition').onclick=()=>change(c=>{c.x=0;c.y=0;});el('resetSize').onclick=()=>change(c=>{c.sx=c.sy=L.defaultScale(selected);});
 function layer(dir){change((c,l)=>{const order=L.definitions.slice().sort((a,b)=>l.controls[a.id].z-l.controls[b.id].z);const from=order.findIndex(d=>d.id===selected);const to=dir==='top'?order.length-1:dir==='bottom'?0:Math.max(0,Math.min(order.length-1,from+dir));const [item]=order.splice(from,1);order.splice(to,0,item);order.forEach((d,z)=>l.controls[d.id].z=z);});}
 el('back').onclick=()=>layer(-1);el('front').onclick=()=>layer(1);el('top').onclick=()=>layer('top');el('bottom').onclick=()=>layer('bottom');
 el('finish').onclick=()=>{if(flushSaveNow().ok)desktopOverlay.finishEditing();};
 el('resetPeak').onclick=()=>window.overlayDiagnostics?.resetGPeak();
 function point(e){const r=canvas.getBoundingClientRect(),stage=L.stage(),scale=Math.min(r.width/stage.width,r.height/stage.height),px=(e.clientX-r.x-(r.width-stage.width*scale)/2)/scale,py=(e.clientY-r.y-(r.height-stage.height*scale)/2)/scale;return {x:(px-stage.originX)/stage.scale,y:(py-stage.originY)/stage.scale};}
 canvas.onpointerdown=e=>{if(e.button!==0)return;const p=point(e),l=L.get(),d=L.definitions.find(d=>d.id===selected),b=L.box(d,l.controls[selected]),near=(x,y)=>Math.hypot(p.x-x,p.y-y)<15;let mode=near(b.x+b.w,b.y+b.h)?'uniform':near(b.x+b.w,b.y+b.h/2)?'sx':near(b.x+b.w/2,b.y+b.h)?'sy':'move';if(mode==='move'){const hit=L.hit(p.x,p.y);if(!hit)return;selected=hit;sync();}drag={...p,mode,c:{...L.get().controls[selected]}};canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(!drag)return;const p=point(e),d=L.definitions.find(d=>d.id===selected),[x,y,w,h]=d.bounds,dx=p.x-drag.x,dy=p.y-drag.y;
 change(c=>{Object.assign(c,drag.c);if(drag.mode==='move'){c.x+=dx;c.y+=dy;}else if(drag.mode==='sx')c.sx+=2*dx/w;else if(drag.mode==='sy')c.sy+=2*dy/h;else{const ratio=Math.max(.05,1+(Math.abs(dx/w)>Math.abs(dy/h)?2*dx/(w*c.sx):2*dy/(h*c.sy)));c.sx*=ratio;c.sy*=ratio;}});};
 function end(e){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}canvas.onpointerup=end;canvas.onpointercancel=end;
 const grip=el('panelGrip');let panelDrag=null;
 grip.onpointerdown=e=>{panelDrag={x:e.clientX,y:e.clientY,left:panel.offsetLeft,top:panel.offsetTop};grip.setPointerCapture(e.pointerId);};grip.onpointermove=e=>{if(!panelDrag)return;panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,panelDrag.left+e.clientX-panelDrag.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-panel.offsetHeight,panelDrag.top+e.clientY-panelDrag.y))+'px';panel.style.right='auto';};grip.onpointerup=()=>panelDrag=null;
 const move=el('moveWindow');move.onpointerdown=e=>{move.setPointerCapture(e.pointerId);desktopOverlay.moveStart(e.screenX,e.screenY);};move.onpointermove=e=>{if(move.hasPointerCapture(e.pointerId))desktopOverlay.moveMove(e.screenX,e.screenY);};move.onpointerup=e=>{desktopOverlay.moveEnd();move.releasePointerCapture(e.pointerId);};
 const resize=document.querySelector('.resize');resize.onpointerdown=e=>{resize.setPointerCapture(e.pointerId);desktopOverlay.resizeStart(e.screenX,e.screenY);};resize.onpointermove=e=>{if(resize.hasPointerCapture(e.pointerId))desktopOverlay.resizeMove(e.screenX,e.screenY);};resize.onpointerup=e=>{desktopOverlay.resizeEnd();resize.releasePointerCapture(e.pointerId);};
 addEventListener('resize',()=>{panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,panel.offsetLeft))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-panel.offsetHeight,panel.offsetTop))+'px';panel.style.right='auto';});
 // Loading persisted layout must not erase the current selection highlight.
 sync();
})();
