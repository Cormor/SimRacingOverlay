'use strict';
// Retain unchanged canvas pixels. Clear only damaged regions, then repaint all
// intersecting components in z order, including unchanged overlapping layers.
(function(root){
 class Components {
  constructor(){this.layers=new Map();this.stats={paints:0,reuses:0,composites:0};}
  begin(canvas,stage,raster,key){
   this.canvas=canvas;this.stage=stage;this.raster=raster;this.key=key;this.jobs=[];this.dirty=[];
   const signature=JSON.stringify([canvas.width,canvas.height,stage]);
   if(signature!==this.signature){this.layers.clear();this.signature=signature;this.dirty.push({x:0,y:0,w:canvas.width,h:canvas.height});}
  }
  invalidate(){this.layers.clear();this.signature=null;}
  draw(id,c,d,paint){
   const {stage:s,raster:r}=this,ax=s.scale*r.width/s.width,ay=s.scale*r.height/s.height,ox=s.originX*r.width/s.width,oy=s.originY*r.height/s.height;
   // The exact same component transform is used by paint, hit testing and damage.
   const [x,y,w,h]=d.bounds,cx=x+w/2+c.x,cy=y+h/2+c.y;
   const a=(c.rotation||0)*Math.PI/180,co=Math.cos(a),si=Math.sin(a),pad=40;
   const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:cx+(u*w/2+u*pad)*c.sx*co-(v*h/2+v*pad)*c.sy*si,y:cy+(u*w/2+u*pad)*c.sx*si+(v*h/2+v*pad)*c.sy*co}));
   const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))*ax+ox)),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))*ay+oy));
   const right=Math.min(r.width,Math.ceil(Math.max(...points.map(p=>p.x))*ax+ox)),bottom=Math.min(r.height,Math.ceil(Math.max(...points.map(p=>p.y))*ay+oy));
   const rect={x:left,y:top,w:Math.max(0,right-left),h:Math.max(0,bottom-top)},value=this.key(id),content=typeof value==='string'?value:JSON.stringify(value),old=this.layers.get(id);
   const geometry=JSON.stringify([c,rect]);
   if(!old||old.content!==content||old.geometry!==geometry){if(old)this.dirty.push(old.rect);this.dirty.push(rect);}
   const layer={geometry,content,rect};this.layers.set(id,layer);this.jobs.push({id,layer,paint});
  }
  finish(context){
   const live=new Set(this.jobs.map(j=>j.id));for(const [id,layer] of this.layers)if(!live.has(id)){this.dirty.push(layer.rect);this.layers.delete(id);}
   if(!this.dirty.length){this.stats.reuses+=this.jobs.length;return;}
   context.save();context.setTransform(1,0,0,1,0,0);
   const full=this.dirty.some(b=>b.x===0&&b.y===0&&b.w>=this.canvas.width&&b.h>=this.canvas.height);
   if(!full){context.beginPath();for(const b of this.dirty)if(b.w&&b.h)context.rect(b.x,b.y,b.w,b.h);context.clip();}
   context.clearRect(0,0,this.canvas.width,this.canvas.height);
   const {stage:s,raster:r}=this;context.setTransform(s.scale*r.width/s.width,0,0,s.scale*r.height/s.height,s.originX*r.width/s.width,s.originY*r.height/s.height);
   const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
   for(const {layer:{rect:b},paint} of this.jobs){
    if(b.w&&b.h&&(full||this.dirty.some(d=>overlaps(b,d)))){paint(context);this.stats.paints++;}else this.stats.reuses++;
   }
   context.restore();this.stats.composites++;
  }
 }
 const api={Components};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ComponentPaint=api;
})(typeof window!=='undefined'?window:globalThis);
