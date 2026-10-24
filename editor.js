'use strict';
(function(){
 const L=window.OverlayLayout,canvas=document.getElementById('overlay');
 const editing=new URLSearchParams(location.search).get('edit')==='1'&&!!window.desktopOverlay;
 let selected=[],drag=null,saveTimer=null,dirty=false,revision=0,loaded=false,notice=null;
 const undo=[],redo=[];
 const snapshot=()=>JSON.stringify(L.get().controls);
 function remember(before){if(before===snapshot())return;undo.push(before);if(undo.length>80)undo.shift();redo.length=0;}
 function message(text,error=false){if(notice){notice.textContent=text;notice.classList.toggle('error',error);}}
 async function load(){if(dirty||drag)return;try{const r=await fetch('assets/layout.json',{cache:'no-store'});if(r.ok&&!dirty&&!drag){L.set(await r.json());loaded=true;if(editing)sync();}}catch{message('读取布局失败，稍后自动重试',true);}}
 function save(){dirty=true;revision++;clearTimeout(saveTimer);message('正在保存…');saveTimer=setTimeout(async()=>{const token=revision;try{const r=await desktopOverlay.saveLayout(L.get());if(!r?.ok)throw Error(r?.error||'写入未完成');if(token===revision){dirty=false;message('已保存 · 桌面与 OBS 共用布局');}}catch(e){message('保存失败：'+e.message+'；修改仍保留在编辑器',true);}},180);}
 function flushSaveNow(){clearTimeout(saveTimer);revision++;if(!dirty)return {ok:true};try{const r=desktopOverlay.saveLayoutNow(L.get());dirty=!r.ok;if(!r.ok)message('保存失败：'+r.error,true);return r;}catch(e){message('保存失败：'+e.message,true);return {ok:false,error:e.message};}}
 window.overlayEditor={flushSaveNow,getStatus:()=>({editing,loaded,dirty,revision})};
 addEventListener('beforeunload',e=>{if(dirty&&!flushSaveNow().ok){e.preventDefault();e.returnValue=false;}});
 window.desktopOverlay?.onScene(scene=>L.setDesktopStage(scene));
 // Pure QA windows do not contact the live layout or any device.
 if(new URLSearchParams(location.search).get('qa')!=='1'){load();setInterval(load,1200);}else loaded=true;
 if(!editing)return;
 document.body.classList.add('editing');canvas.tabIndex=0;L.setEditing(true);
 const panel=document.createElement('aside');panel.id='editor';panel.setAttribute('aria-label','叠加层布局编辑器');
 panel.innerHTML=`<header id="panelGrip"><div><strong>布局编辑</strong><span>拖动标题移动面板</span></div><button id="collapse" title="折叠面板" aria-label="折叠面板">−</button></header>
 <div class="editorBody">
 <div class="toolbar"><button id="undo" title="撤销 Ctrl+Z">↶ 撤销</button><button id="redo" title="重做 Ctrl+Shift+Z">↷ 重做</button><button id="selectAll" title="全选 Ctrl+A">全选</button></div>
 <p class="hint">点击选中 · Shift 加选 · 空白处框选<br>方向键微调 · Shift 加速 · 拖右下角等比缩放</p>
 <div class="sectionTitle">模块 <span>选择 / 显示 / 锁定</span></div><div id="modules" role="group" aria-label="模块列表"></div>
 <div id="selectionTitle" class="sectionTitle">未选择模块</div>
 <div class="pair"><label>X <input id="posX" aria-label="选择区域左侧位置" type="number" step="1"></label><label>Y <input id="posY" aria-label="选择区域顶部位置" type="number" step="1"></label></div>
 <div class="pair"><label>宽 <input id="width" type="number" min="1" step="1"></label><label>高 <input id="height" type="number" min="1" step="1"></label></div>
 <div class="pair"><label>缩放 % <input id="scale" type="number" min="5" max="2000" step="5" value="100"></label><label>旋转 ° <input id="rotation" type="number" step="1"></label></div>
 <p class="hint">位置、尺寸以屏幕逻辑像素显示；多选旋转绕共同中心。多选旋转框输入增量角度。</p>
 <div class="toolbar"><button id="rotateLeft">↶ 90°</button><button id="rotateRight">↷ 90°</button><button id="recover">移回屏内</button></div>
 <label class="check"><input id="snap" type="checkbox">拖动吸附到 8 px 网格</label>
 <details open><summary>对齐与层级</summary><div class="toolbar"><button id="alignLeft">左对齐</button><button id="alignTop">顶对齐</button><button id="alignCenter">横向居中</button></div><div class="toolbar"><button id="back">下移一层</button><button id="front">上移一层</button><button id="bottom">置底</button><button id="top">置顶</button></div></details>
 <details><summary>透明度</summary>${['opacity','textOpacity','imageOpacity'].map((k,i)=>`<label>${['整体','文字','图形'][i]} <input id="${k}" type="range" min="0" max="100" step="1"><output id="${k}Value"></output></label>`).join('')}<button id="resetOpacity">复位透明度</button></details>
 <details><summary>复位选项</summary><div class="toolbar"><button id="resetPosition">仅位置</button><button id="resetSize">仅尺寸</button><button id="resetRotation">仅方向</button></div><div class="toolbar"><button id="resetWidth">仅宽度</button><button id="resetHeight">仅高度</button></div></details>
 <div class="toolbar"><button id="resetSelected">复位所选</button><button id="moveAll">移动整体</button><button id="resetAll">整体复位</button></div>
 <details><summary>布局文件与辅助</summary><div class="toolbar"><button id="export">导出布局</button><button id="import">导入布局</button><button id="resetPeak">清空 G 峰值</button></div><input id="file" type="file" accept=".json,application/json" hidden><p class="hint">复位和导入均可撤销。锁定模块不参与移动；整体复位恢复全部模块的默认状态。</p></details>
 <button id="finish" class="primary">完成并保存 <span>Ctrl+Alt+M</span></button><div id="notice" role="status" class="hint">已载入布局 · 自动保存</div>
 </div>`;
 document.body.appendChild(panel);
 const el=id=>panel.querySelector('#'+id);notice=el('notice');
 const modules=el('modules');
 for(const d of L.definitions){const row=document.createElement('div');row.className='module';row.dataset.id=d.id;row.innerHTML=`<label title="选择；可多选"><input type="checkbox" data-action="select"><span>${d.label}</span></label><button data-action="enabled" title="启用或禁用模块" aria-label="启用或禁用${d.label}"></button><button data-action="locked" title="锁定或解锁位置" aria-label="锁定或解锁${d.label}"></button>`;modules.appendChild(row);}
 const ids=()=>selected.filter(id=>!L.get().controls[id].locked);
 function choose(next){selected=[...new Set(next)];L.select(selected);sync();}
 function sync(){
  const value=L.get(),active=ids(),b=L.bounds(active,value),s=L.stage();
  el('selectionTitle').textContent=selected.length?`已选 ${selected.length} 项${active.length<selected.length?' · 含锁定项':''}`:'未选择模块';
  for(const row of modules.children){const id=row.dataset.id,c=value.controls[id];row.classList.toggle('selected',selected.includes(id));row.querySelector('input').checked=selected.includes(id);const enabled=row.querySelector('[data-action=enabled]'),lock=row.querySelector('[data-action=locked]');enabled.textContent=c.enabled?'显示':'隐藏';enabled.setAttribute('aria-pressed',String(c.enabled));lock.textContent=c.locked?'锁定':'解锁';lock.setAttribute('aria-pressed',String(c.locked));}
  const values={posX:b?s.originX+b.x*s.scale:0,posY:b?s.originY+b.y*s.scale:0,width:b?b.w*s.scale:0,height:b?b.h*s.scale:0,rotation:active.length===1?value.controls[active[0]].rotation:0,scale:100};
  for(const [id,v] of Object.entries(values)){const input=el(id);if(document.activeElement!==input)input.value=Number(v.toFixed(2));input.disabled=!b;}
  // Non-uniform scaling rotated groups would introduce shear; keep multi-selection proportional.
  el('width').disabled=!b||active.length>1;el('height').disabled=!b||active.length>1;
  for(const k of ['opacity','textOpacity','imageOpacity']){const c=active.length?value.controls[active[0]][k]:1;el(k).value=Math.round(c*100);el(k).disabled=!active.length;el(k+'Value').textContent=active.some(id=>value.controls[id][k]!==c)?'混合':Math.round(c*100)+'%';}
  el('undo').disabled=!undo.length;el('redo').disabled=!redo.length;
 }
 function apply(value,before=snapshot(),history=true){L.set(value);if(history)remember(before);sync();save();}
 function edit(fn){if(!loaded){message('布局尚在读取，请稍候',true);return;}const value=L.get(),before=snapshot();fn(value,ids());apply(value,before);}
 function transform(options){if(!ids().length)return;apply(L.transform(L.get(),ids(),options));}
 modules.addEventListener('click',e=>{const action=e.target.dataset.action;if(!action)return;const row=e.target.closest('.module'),id=row.dataset.id;if(action==='select'){choose(e.target.checked?[...selected,id]:selected.filter(x=>x!==id));return;}edit(v=>{v.controls[id][action]=!v.controls[id][action];});});
 el('selectAll').onclick=()=>choose(L.definitions.map(d=>d.id));
 el('moveAll').onclick=()=>{choose(L.definitions.map(d=>d.id).filter(id=>L.get().controls[id].enabled));message('整体已选中 · 拖动任意选中框或用方向键移动');};
 function travel(from,to){if(!from.length)return;to.push(snapshot());const controls=JSON.parse(from.pop()),v=L.get();v.controls=controls;L.set(v);sync();save();}
 el('undo').onclick=()=>travel(undo,redo);el('redo').onclick=()=>travel(redo,undo);
 for(const [id,axis] of [['posX','x'],['posY','y']])el(id).onchange=()=>{const v=Number(el(id).value),b=L.bounds(ids()),s=L.stage();if(b&&Number.isFinite(v))transform({[axis==='x'?'dx':'dy']:(v-s[axis==='x'?'originX':'originY'])/s.scale-b[axis]});};
 for(const [id,axis] of [['width','sx'],['height','sy']])el(id).onchange=()=>{const n=Number(el(id).value),active=ids();if(active.length!==1||!(n>0))return;edit(v=>{const c=v.controls[active[0]],d=L.byId.get(active[0]),b=L.box(d,c),a=c.rotation*Math.PI/180;const dimension=axis==='sx'?d.bounds[2]*Math.abs(Math.cos(a)):d.bounds[3]*Math.abs(Math.cos(a));if(dimension<1e-6){message('此方向旋转后请使用等比缩放');return;}c[axis]+=(n/L.stage().scale-(axis==='sx'?b.w:b.h))/dimension;});};
 el('scale').onchange=()=>{const scale=Number(el('scale').value)/100;if(scale>0&&Number.isFinite(scale)){transform({scaleX:scale});el('scale').value=100;}};
 el('rotation').onchange=()=>{const angle=Number(el('rotation').value),active=ids();if(Number.isFinite(angle))transform({rotation:active.length===1?angle-L.get().controls[active[0]].rotation:angle});el('rotation').blur();sync();};
 el('rotateLeft').onclick=()=>transform({rotation:-90});el('rotateRight').onclick=()=>transform({rotation:90});
 function fitGroup(value,active){let b=L.bounds(active,value);if(!b)return value;const view=L.viewport(),ratio=Math.min(1,(view.w-32)/b.w,(view.h-32)/b.h);value=L.transform(value,active,{scaleX:ratio});b=L.bounds(active,value);return L.transform(value,active,{dx:view.x+view.w/2-b.x-b.w/2,dy:view.y+view.h/2-b.y-b.h/2});}
 function recover(){if(ids().length)apply(fitGroup(L.get(),ids()));}
 el('recover').onclick=recover;
 function align(axis){const active=ids(),b=L.bounds(active);if(!b)return;edit(v=>{for(const id of active){const c=v.controls[id],r=L.box(L.byId.get(id),c);if(axis==='left')c.x+=b.x-r.x;else if(axis==='top')c.y+=b.y-r.y;else c.x+=b.x+b.w/2-r.x-r.w/2;}});}
 el('alignLeft').onclick=()=>align('left');el('alignTop').onclick=()=>align('top');el('alignCenter').onclick=()=>align('center');
 function layer(dir){edit((v,active)=>{const order=L.definitions.map(d=>d.id).sort((a,b)=>v.controls[a].z-v.controls[b].z),set=new Set(active);if(dir==='top'||dir==='bottom'){const a=order.filter(id=>set.has(id)),b=order.filter(id=>!set.has(id));order.splice(0,order.length,...(dir==='top'?[...b,...a]:[...a,...b]));}else if(dir>0){for(let i=order.length-2;i>=0;i--)if(set.has(order[i])&&!set.has(order[i+1]))[order[i],order[i+1]]=[order[i+1],order[i]];}else for(let i=1;i<order.length;i++)if(set.has(order[i])&&!set.has(order[i-1]))[order[i],order[i-1]]=[order[i-1],order[i]];order.forEach((id,z)=>v.controls[id].z=z);});}
 el('back').onclick=()=>layer(-1);el('front').onclick=()=>layer(1);el('top').onclick=()=>layer('top');el('bottom').onclick=()=>layer('bottom');
 for(const k of ['opacity','textOpacity','imageOpacity'])el(k).oninput=()=>edit((v,active)=>active.forEach(id=>v.controls[id][k]=Number(el(k).value)/100));
 el('resetOpacity').onclick=()=>edit((v,active)=>active.forEach(id=>Object.assign(v.controls[id],{opacity:1,textOpacity:1,imageOpacity:1})));
 for(const [id,keys] of [['resetPosition',['x','y']],['resetSize',['sx','sy']],['resetRotation',['rotation']],['resetWidth',['sx']],['resetHeight',['sy']]])el(id).onclick=()=>edit((v,active)=>{for(const name of active){const d=L.defaults(name);for(const k of keys)v.controls[name][k]=d[k];}});
 for(const input of panel.querySelectorAll('input[type=number]'))input.addEventListener('blur',sync);
 el('resetSelected').onclick=()=>edit((v,active)=>active.forEach(id=>v.controls[id]=L.defaults(id)));
 el('resetAll').onclick=()=>{edit(v=>{for(const d of L.definitions)v.controls[d.id]=L.defaults(d.id);const all=L.definitions.map(d=>d.id),s=L.stage(),target=L.screenStage(s.width,s.height),b=L.bounds(all,v),r=target.scale/s.scale;v.controls=L.transform(v,all,{scaleX:r,center:{x:0,y:0},dx:(target.originX-s.originX)/s.scale,dy:(target.originY-s.originY)/s.scale}).controls;});message('全部模块已恢复默认中下方布局 · 可撤销');};
 el('export').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(L.get(),null,2)+'\n'],{type:'application/json'}));a.href=url;a.download='racing-overlay-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 el('import').onclick=()=>el('file').click();el('file').onchange=async()=>{try{const f=el('file').files[0];if(!f)return;if(f.size>1024*1024)throw Error('布局文件超过 1 MiB');const v=JSON.parse(await f.text());if(!v.controls||typeof v.controls!=='object'||!Object.keys(v.controls).some(id=>L.byId.has(id)))throw Error('文件中没有可识别的模块');const current=L.get();apply({...L.clean(v),stage:current.stage});message('布局已导入 · 可撤销');}catch(e){message('导入失败：'+e.message,true);}finally{el('file').value='';}};
 el('resetPeak').onclick=()=>window.overlayDiagnostics?.resetGPeak();
 el('finish').onclick=()=>{if(flushSaveNow().ok)desktopOverlay.finishEditing();};
 const point=e=>L.point(e.clientX,e.clientY,canvas.getBoundingClientRect());
 const marquee=document.createElement('div');marquee.id='marquee';document.body.appendChild(marquee);
 canvas.onpointerdown=e=>{
  if(e.button!==0||!loaded)return;canvas.focus({preventScroll:true});const p=point(e),active=ids(),b=L.bounds(active),threshold=12/L.stage().scale;
  const resize=b&&Math.hypot(p.x-b.x-b.w,p.y-b.y-b.h)<threshold,hit=L.hit(p.x,p.y);
  if(!resize){if(hit){if(e.shiftKey||e.ctrlKey){choose(selected.includes(hit)?selected.filter(id=>id!==hit):[...selected,hit]);return;}if(!selected.includes(hit))choose([hit]);}else if(!e.shiftKey&&!e.ctrlKey)choose([]);}
  drag={pointerId:e.pointerId,start:p,screen:{x:e.clientX,y:e.clientY},before:snapshot(),value:L.get(),ids:ids(),mode:resize?'scale':hit?'move':'marquee',selection:selected.slice(),b:L.bounds(ids())};canvas.setPointerCapture(e.pointerId);
 };
 canvas.onpointermove=e=>{if(!drag)return;const p=point(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
  if(drag.mode==='marquee'){const x=Math.min(drag.screen.x,e.clientX),y=Math.min(drag.screen.y,e.clientY);Object.assign(marquee.style,{display:'block',left:x+'px',top:y+'px',width:Math.abs(e.clientX-drag.screen.x)+'px',height:Math.abs(e.clientY-drag.screen.y)+'px'});const x0=Math.min(p.x,drag.start.x),y0=Math.min(p.y,drag.start.y),x1=Math.max(p.x,drag.start.x),y1=Math.max(p.y,drag.start.y);choose([...drag.selection,...L.definitions.filter(d=>{const c=L.get().controls[d.id],b=L.box(d,c);return c.enabled&&!c.locked&&b.x>=x0&&b.y>=y0&&b.x+b.w<=x1&&b.y+b.h<=y1;}).map(d=>d.id)]);return;}
  let options;if(drag.mode==='move'){const grid=el('snap').checked?8/L.stage().scale:0;options={dx:grid?Math.round(dx/grid)*grid:dx,dy:grid?Math.round(dy/grid)*grid:dy};if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))options.dy=0;else options.dx=0;}}
  else{const b=drag.b,ratio=Math.max(.05,1+(Math.abs(dx/b.w)>Math.abs(dy/b.h)?2*dx/b.w:2*dy/b.h));options={scaleX:ratio};}
  L.set(L.transform(drag.value,drag.ids,options));sync();
 };
 function end(e,cancel=false){if(!drag)return;if(cancel&&drag.mode!=='marquee'){const v=L.get();v.controls=JSON.parse(drag.before);L.set(v);}else if(drag.mode!=='marquee'){remember(drag.before);save();}drag=null;marquee.style.display='none';if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);sync();}
 canvas.onpointerup=e=>end(e);canvas.onpointercancel=e=>end(e,true);
 addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='a'){e.preventDefault();el('selectAll').click();}else if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();(e.shiftKey?el('redo'):el('undo')).click();}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();el('redo').click();}else if(e.key==='Escape'){if(drag)end({pointerId:drag.pointerId},true);else choose([]);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=(e.shiftKey?10:1)/L.stage().scale;transform({dx:e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy:e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0});}});
 const grip=el('panelGrip');let panelDrag=null;
 grip.onpointerdown=e=>{if(e.target.closest('button'))return;panelDrag={x:e.clientX,y:e.clientY,left:panel.offsetLeft,top:panel.offsetTop};grip.setPointerCapture(e.pointerId);};
 grip.onpointermove=e=>{if(!panelDrag)return;panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,panelDrag.left+e.clientX-panelDrag.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-40,panelDrag.top+e.clientY-panelDrag.y))+'px';};
 grip.onpointerup=grip.onpointercancel=()=>panelDrag=null;
 el('collapse').onclick=()=>{panel.classList.toggle('collapsed');el('collapse').textContent=panel.classList.contains('collapsed')?'+':'−';};
 addEventListener('resize',()=>{panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,panel.offsetLeft))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-40,panel.offsetTop))+'px';});
 Object.assign(window.overlayEditor,{getSelection:()=>selected.slice(),getHistory:()=>({undo:undo.length,redo:redo.length})});
 sync();
})();
