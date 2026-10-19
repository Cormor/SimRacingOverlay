'use strict';
(function(root){
 const definitions=[
 ['wheel','方向盘与仪表', [125,108,750,682]],['brake','刹车与边框',[27,165,86,573]],['throttle','油门与边框',[887,165,86,573]],
 ['slip0','左前轮滑移',[120,171,185,248]],['slip1','右前轮滑移',[695,171,185,248]],['slip2','左后轮滑移',[120,521,185,248]],['slip3','右后轮滑移',[695,521,185,248]],
 ['frontResponse','前轮响应',[135,13,220,96]],['rearResponse','后轮响应',[645,13,220,96]],['frontLateral','前轮侧滑',[245,102,510,34]],['rearLateral','后轮侧滑',[245,770,510,34]],
 ['handling','推头／甩尾',[390,30,220,80]],['decel','实际减速',[422,642,156,70]],['handbrake','手刹',[434,499,132,107]],['statuses','ABS / TC / ESC',[265,800,470,48]],['gBall','G 力球',[426,343,175,160]]
 ].map(([id,label,bounds],z)=>({id,label,bounds,z}));
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const stageDefault={width:1000,height:850,originX:0,originY:0,scale:1};let desktopStage=null;
 function validStage(s){if(!s)return {...stageDefault};const n=(k,min,max,def)=>Number.isFinite(s[k])?clamp(s[k],min,max):def;return {width:n('width',320,16384,1000),height:n('height',200,16384,850),originX:n('originX',-16000,16000,0),originY:n('originY',-16000,16000,0),scale:n('scale',.1,4,1),...Object.fromEntries(['pixelWidth','pixelHeight','monitorPixelWidth','monitorPixelHeight'].filter(k=>Number.isFinite(s[k])&&s[k]>0).map(k=>[k,Math.round(clamp(s[k],1,32768))]))};}
 function clean(input){const out={version:2,stage:validStage(input?.stage),controls:{}};for(const d of definitions){const c=input?.controls?.[d.id]||{};out.controls[d.id]={x:Number.isFinite(c.x)?clamp(c.x,-160000,160000):0,y:Number.isFinite(c.y)?clamp(c.y,-160000,160000):0,sx:Number.isFinite(c.sx)?clamp(c.sx,.2,4):1,sy:Number.isFinite(c.sy)?clamp(c.sy,.2,4):1,z:Number.isFinite(c.z)?clamp(Math.round(c.z),-1000,1000):d.z,...Object.fromEntries(['opacity','textOpacity','imageOpacity'].map(k=>[k,Number.isFinite(c[k])?clamp(c[k],0,1):1]))};}return out;}
 function fit(d,c){const stage=desktopStage||layout.stage,v={x:-stage.originX/stage.scale,y:-stage.originY/stage.scale,w:stage.width/stage.scale,h:stage.height/stage.scale},[x,y,w,h]=d.bounds,margin=10,sx=Math.min(clamp(c.sx,.2,4),(v.w-margin*2)/w),sy=Math.min(clamp(c.sy,.2,4),(v.h-margin*2)/h),cx=x+w/2,cy=y+h/2;return {...c,sx,sy,x:clamp(c.x,v.x+margin+w*sx/2-cx,v.x+v.w-margin-w*sx/2-cx),y:clamp(c.y,v.y+margin+h*sy/2-cy,v.y+v.h-margin-h*sy/2-cy)};}
 function setDesktopStage(s){desktopStage=s?validStage(s):null;}
 function stage(){return {...(desktopStage||layout.stage)};}
 function box(d,c){c=fit(d,c);const [x,y,w,h]=d.bounds;return {x:x+w/2+c.x-w*c.sx/2,y:y+h/2+c.y-h*c.sy/2,w:w*c.sx,h:h*c.sy};}
 let layout=clean(null),jobs=[],selected=null,painting=null;
 function set(v){layout=clean(v);}function get(){return JSON.parse(JSON.stringify({...layout,stage:stage()}));}
 function begin(){jobs=[];}function group(id,draw){if(definitions.some(d=>d.id===id))jobs.push({id,draw});else draw();}
 function flush(ctx){for(const j of jobs.sort((a,b)=>layout.controls[a.id].z-layout.controls[b.id].z)){const d=definitions.find(d=>d.id===j.id),c=fit(d,layout.controls[j.id]),[x,y,w,h]=d.bounds;ctx.save();ctx.translate(x+w/2+c.x,y+h/2+c.y);ctx.scale(c.sx,c.sy);ctx.translate(-x-w/2,-y-h/2);painting=c;try{j.draw();}finally{painting=null;ctx.restore();}}if(selected){const d=definitions.find(d=>d.id===selected),b=box(d,layout.controls[d.id]);ctx.save();ctx.strokeStyle='#ffe082';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.setLineDash([]);for(const [x,y] of [[b.x+b.w,b.y+b.h],[b.x+b.w,b.y+b.h/2],[b.x+b.w/2,b.y+b.h]]){ctx.fillStyle='#ffe082';ctx.fillRect(x-6,y-6,12,12);}ctx.restore();}}
 function hit(x,y){return definitions.slice().sort((a,b)=>layout.controls[b.id].z-layout.controls[a.id].z).find(d=>{const b=box(d,layout.controls[d.id]);return x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h;})?.id;}
 function raster(stage,dpr=1,vw=stage.width,vh=stage.height,nativeDesktop=false){if(nativeDesktop&&Number.isFinite(stage.pixelWidth)&&Number.isFinite(stage.pixelHeight))return {width:stage.pixelWidth,height:stage.pixelHeight,ratio:Math.sqrt(stage.pixelWidth/stage.width*stage.pixelHeight/stage.height)};dpr=Number.isFinite(dpr)&&dpr>0?dpr:1;const fit=Math.min((Number.isFinite(vw)?vw:stage.width)/stage.width,(Number.isFinite(vh)?vh:stage.height)/stage.height),ratio=Math.min(4,Math.max(dpr,fit*dpr));return {width:Math.round(stage.width*ratio),height:Math.round(stage.height*ratio),ratio};}
 function drawOpacity(kind){return (painting?.opacity??1)*(kind==='text'?(painting?.textOpacity??1):(painting?.imageOpacity??1));}
 const api={drawOpacity,raster,definitions,clean,fit,box,set,get,stage,setDesktopStage,begin,group,flush,hit,select:id=>selected=id};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OverlayLayout=api;
})(typeof window!=='undefined'?window:globalThis);
