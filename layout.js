'use strict';
(function(root){
 const preset=typeof module!=='undefined'&&module.exports?require('./layout-preset'):root.OverlayPreset;
 const definitions=[
  ['wheel','方向盘与仪表',[180,130,640,640],[125,108,750,682]],
  ['brake','刹车与辅助',[27,165,86,573]],['throttle','油门与辅助',[887,165,86,573]],
  ['slip0','左前轮滑移',[120,171,185,248]],['slip1','右前轮滑移',[695,171,185,248]],
  ['slip2','左后轮滑移',[120,521,185,248]],['slip3','右后轮滑移',[695,521,185,248]],
  ['frontResponse','左侧裕度 · 上前／下后',[148,23,194,48],[135,13,220,96]],
  ['rearResponse','右侧裕度 · 上前／下后',[658,23,194,48],[645,13,220,96]],
  ['frontLateral','前轴侧滑／估计侧偏角',[234,101,552,36],[245,102,510,34]],
  ['rearLateral','后轴侧滑／估计侧偏角',[234,769,552,36],[245,770,510,34]],
  ['handling','推头／甩尾／侧摆',[390,30,220,80]],['decel','实际减速',[422,642,156,70]],
  ['handbrake','手刹',[434,499,132,107]],['statuses','ABS / TC / ESC',[265,800,470,48]],
  ['gBall','G 力球',[426,343,175,160]],['flags','iRacing 旗语与解释',[370,-89,260,64]]
 ].map(([id,label,bounds,legacy],z)=>({id,label,bounds,legacy:legacy||bounds,z}));
 const byId=new Map(definitions.map(d=>[d.id,d]));
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),clone=v=>JSON.parse(JSON.stringify(v));
 const defaultScale=id=>preset?.controls?.[id]?.sx??(['frontResponse','rearResponse'].includes(id)?2:1);
 const stageDefault={width:1000,height:1000,originX:0,originY:110,scale:1};
 let desktopStage=null,layout,jobs=[],selected=[],painting=null,editing=false;
 const listeners=new Set();
 function changed(){for(const fn of listeners)fn();}
 function onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
 function validStage(s){s=s||{};const n=(k,a,b,v)=>Number.isFinite(s[k])?clamp(s[k],a,b):v;return {width:n('width',320,16384,1000),height:n('height',200,16384,1000),originX:n('originX',-16000,16000,0),originY:n('originY',-16000,16000,110),scale:n('scale',.02,8,1),...Object.fromEntries(['pixelWidth','pixelHeight','monitorPixelWidth','monitorPixelHeight'].filter(k=>Number.isFinite(s[k])&&s[k]>0).map(k=>[k,Math.round(clamp(s[k],1,32768))]))};}
 function defaults(id){const d=byId.get(id),s=defaultScale(id),[x,y,w,h]=d.bounds,[lx,ly,lw,lh]=d.legacy;return {x:(lx+lw/2-x-w/2)*(1-s),y:(ly+lh/2-y-h/2)*(1-s),sx:s,sy:s,rotation:0,z:d.z,enabled:true,locked:false,opacity:1,textOpacity:1,imageOpacity:1,...(preset?.controls?.[id]||{})};}
 function screenStage(width,height,placement=preset?.placement){
  const p=placement||{anchorX:.5,bottomRatio:.02,heightRatio:.43,edgeRatio:.02},value={controls:Object.fromEntries(definitions.map(d=>[d.id,defaults(d.id)]))},b=bounds(definitions.map(d=>d.id),value);
  const edge=clamp(Number.isFinite(p.edgeRatio)?p.edgeRatio:.02,0,.2),bottom=clamp(Number.isFinite(p.bottomRatio)?p.bottomRatio:.02,0,.4),anchor=clamp(Number.isFinite(p.anchorX)?p.anchorX:.5,0,1),heightRatio=clamp(Number.isFinite(p.heightRatio)?p.heightRatio:.43,.05,.95);
  const scale=Math.min(height*heightRatio/b.h,width*(1-edge*2)/b.w,height*(1-bottom-edge)/b.h);
  const center=clamp(width*anchor,b.w*scale/2+width*edge,width-b.w*scale/2-width*edge);
  return {width,height,originX:center-(b.x+b.w/2)*scale,originY:height*(1-bottom)-(b.y+b.h)*scale,scale};
 }
 function clean(input){
  const out={version:3,stage:validStage(input?.stage||screenStage(1000,1000)),controls:{}};
  for(const d of definitions){const c=input?.controls?.[d.id],v=defaults(d.id);
   if(c){for(const k of ['x','y','sx','sy','rotation','z','opacity','textOpacity','imageOpacity'])if(Number.isFinite(c[k]))v[k]=c[k];v.enabled=c.enabled!==false;v.locked=c.locked===true;
    if((input.version||2)<3){const [x,y,w,h]=d.bounds,[lx,ly,lw,lh]=d.legacy;v.x=(Number.isFinite(c.x)?c.x:0)+(lx+lw/2-x-w/2)*(1-v.sx);v.y=(Number.isFinite(c.y)?c.y:0)+(ly+lh/2-y-h/2)*(1-v.sy);}
   }
   v.x=clamp(v.x,-160000,160000);v.y=clamp(v.y,-160000,160000);v.sx=clamp(v.sx,.2,4);v.sy=clamp(v.sy,.2,4);v.rotation=((v.rotation+180)%360+360)%360-180;v.z=clamp(Math.round(v.z),-1000,1000);
   for(const k of ['opacity','textOpacity','imageOpacity'])v[k]=clamp(v[k],0,1);
   out.controls[d.id]=v;
  }return out;
 }
 layout=clean(null);
 function stage(){return {...(desktopStage||layout.stage)};}
 function setDesktopStage(s){const next=s?validStage(s):null;if(JSON.stringify(next)!==JSON.stringify(desktopStage)){desktopStage=next;changed();}}
 function set(v){const next=clean(v);if(JSON.stringify(next)!==JSON.stringify(layout)){layout=next;changed();}}
 function get(){return clone({...layout,stage:stage()});}
 function corners(d,c){const [x,y,w,h]=d.bounds,cx=x+w/2+c.x,cy=y+h/2+c.y,a=c.rotation*Math.PI/180,co=Math.cos(a),si=Math.sin(a);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:cx+u*w*c.sx/2*co-v*h*c.sy/2*si,y:cy+u*w*c.sx/2*si+v*h*c.sy/2*co}));}
 function box(d,c){const p=corners(d,c),xs=p.map(p=>p.x),ys=p.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
 function bounds(ids,value=layout){const boxes=ids.filter(id=>byId.has(id)).map(id=>box(byId.get(id),value.controls[id]));if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
 function viewport(){const s=stage();return {x:-s.originX/s.scale,y:-s.originY/s.scale,w:s.width/s.scale,h:s.height/s.scale};}
 // Fit only on an explicit editor action; painting must never alter saved geometry.
 function fit(d,c){const b=box(d,c),v=viewport(),dx=b.w>v.w?v.x+v.w/2-b.x-b.w/2:clamp(0,v.x+10-b.x,v.x+v.w-10-b.x-b.w),dy=b.h>v.h?v.y+v.h/2-b.y-b.h/2:clamp(0,v.y+10-b.y,v.y+v.h-10-b.y-b.h);return {...c,x:c.x+dx,y:c.y+dy};}
 function transform(value,ids,{dx=0,dy=0,scaleX=1,scaleY=scaleX,rotation=0,center=null}={}){
  const out=clean(value),active=ids.filter(id=>byId.has(id)&&!out.controls[id].locked),b=bounds(active,out);if(!b)return out;
  center=center||{x:b.x+b.w/2,y:b.y+b.h/2};
  scaleX=clamp(scaleX,Math.max(...active.map(id=>.2/out.controls[id].sx)),Math.min(...active.map(id=>4/out.controls[id].sx)));
  scaleY=clamp(scaleY,Math.max(...active.map(id=>.2/out.controls[id].sy)),Math.min(...active.map(id=>4/out.controls[id].sy)));
  const a=rotation*Math.PI/180,co=Math.cos(a),si=Math.sin(a);
  for(const id of active){const c=out.controls[id],[x,y,w,h]=byId.get(id).bounds,px=(x+w/2+c.x-center.x)*scaleX,py=(y+h/2+c.y-center.y)*scaleY;c.x=center.x+px*co-py*si+dx-x-w/2;c.y=center.y+px*si+py*co+dy-y-h/2;c.sx*=scaleX;c.sy*=scaleY;c.rotation+=rotation;}
  return clean(out);
 }
 function select(ids){const next=[...new Set((Array.isArray(ids)?ids:ids?[ids]:[]).filter(id=>byId.has(id)))];if(JSON.stringify(next)!==JSON.stringify(selected)){selected=next;changed();}}
 function hit(x,y,includeLocked=false){return definitions.slice().sort((a,b)=>layout.controls[b.id].z-layout.controls[a.id].z).find(d=>{const c=layout.controls[d.id];if(!c.enabled||(!includeLocked&&c.locked))return false;const [bx,by,w,h]=d.bounds,a=-c.rotation*Math.PI/180,px=x-bx-w/2-c.x,py=y-by-h/2-c.y;return Math.abs(px*Math.cos(a)-py*Math.sin(a))<=w*c.sx/2&&Math.abs(px*Math.sin(a)+py*Math.cos(a))<=h*c.sy/2;})?.id;}
 function point(clientX,clientY,r){const s=stage(),scale=Math.min(r.width/s.width,r.height/s.height);return {x:((clientX-r.x-(r.width-s.width*scale)/2)/scale-s.originX)/s.scale,y:((clientY-r.y-(r.height-s.height*scale)/2)/scale-s.originY)/s.scale};}
 function begin(){jobs=[];}
 function group(id,draw){if(byId.has(id))jobs.push({id,draw});else draw();}
 function capture(){return jobs.filter(j=>layout.controls[j.id].enabled).slice().sort((a,b)=>layout.controls[a.id].z-layout.controls[b.id].z).map(j=>{const d=byId.get(j.id),c={...layout.controls[j.id]},[x,y,w,h]=d.bounds;const paint=target=>{target.save();target.translate(x+w/2+c.x,y+h/2+c.y);target.rotate(c.rotation*Math.PI/180);target.scale(c.sx,c.sy);target.translate(-x-w/2,-y-h/2);painting=c;try{j.draw();}finally{painting=null;target.restore();}};return {id:j.id,c,d,paint};});}
 function flush(ctx,retained,prepared){for(const j of prepared||capture()){if(retained)retained.draw(j.id,j.c,j.d,j.paint);else j.paint(ctx);}if(retained)retained.finish(ctx);if(!editing&&!selected.length)return;
  ctx.save();const unit=1/stage().scale;ctx.lineWidth=unit;
  for(const d of definitions){const c=layout.controls[d.id],active=selected.includes(d.id);if(!editing&&!active)continue;const p=corners(d,c);ctx.strokeStyle=active?'#62d9ff':c.enabled?'#7f93ad88':'#7f93ad44';ctx.setLineDash(active?[]:[4*unit,4*unit]);ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(const v of p.slice(1))ctx.lineTo(v.x,v.y);ctx.closePath();ctx.stroke();if(editing&&active){ctx.fillStyle=active?'#ddf6ff':'#aabbd0';ctx.font=`${11*unit}px "Microsoft YaHei UI",sans-serif`;ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText((c.locked?'锁定 · ':'')+d.label,p[0].x,p[0].y-3*unit);}}
  const b=bounds(selected.filter(id=>!layout.controls[id].locked));if(b){ctx.strokeStyle='#62d9ff';ctx.setLineDash([5*unit,3*unit]);ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.setLineDash([]);ctx.fillStyle='#62d9ff';ctx.fillRect(b.x+b.w-5*unit,b.y+b.h-5*unit,10*unit,10*unit);}
  ctx.restore();
 }
 function raster(s,dpr=1,vw=s.width,vh=s.height,native=false){if(native&&Number.isFinite(s.pixelWidth)&&Number.isFinite(s.pixelHeight))return {width:s.pixelWidth,height:s.pixelHeight,ratio:Math.sqrt(s.pixelWidth/s.width*s.pixelHeight/s.height)};dpr=Number.isFinite(dpr)&&dpr>0?dpr:1;const fit=Math.min(vw/s.width,vh/s.height),ratio=Math.min(4,Math.max(dpr,fit*dpr));return {width:Math.round(s.width*ratio),height:Math.round(s.height*ratio),ratio};}
 function drawOpacity(kind){return (painting?.opacity??1)*(kind==='text'?(painting?.textOpacity??1):(painting?.imageOpacity??1));}
 const api={definitions,byId,defaults,screenStage,preset:()=>clone(preset),defaultScale,clean,set,get,stage,setDesktopStage,corners,box,bounds,viewport,fit,transform,hit,point,select,selection:()=>selected.slice(),setEditing:v=>{editing=!!v;changed();},begin,group,capture,flush,onChange,raster,drawOpacity};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OverlayLayout=api;
})(typeof window!=='undefined'?window:globalThis);
