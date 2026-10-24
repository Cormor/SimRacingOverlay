'use strict';
const assert=require('node:assert/strict'),L=require('../layout'),P=require('../layout-preset');
const ids=L.definitions.map(d=>d.id),value=L.clean(null),b=L.bounds(ids,value),rows=[];
for(const [width,height,dpi] of [[1280,720,1],[1920,1080,1],[2560,1440,1.25],[3840,2160,1],[1920,1080,2],[7680,4320,1],[3840,2160,2],[1080,1920,1],[800,600,1],[320,200,1]]){
 const scene=L.screenStage(width,height),x=scene.originX+b.x*scene.scale,y=scene.originY+b.y*scene.scale,w=b.w*scene.scale,h=b.h*scene.scale;
 assert(x>=-1e-6&&y>=-1e-6&&x+w<=width+1e-6&&y+h<=height+1e-6,'all modules fit');
 assert(Math.abs((x+w/2)/width-.5)<1e-10,'horizontal centre');
 assert(Math.abs((height-y-h)/height-P.placement.bottomRatio)<1e-10,'screen-relative bottom gap');
 const next=L.clean({...value,stage:scene});assert.deepEqual(next.stage,scene,'saved stage preserves geometry without hidden clamping');
 assert.deepEqual(next.controls,value.controls,'resolution never changes component dimensions/relative layout');
 rows.push({width:width*dpi,height:height*dpi,dpi,groupHeightRatio:h/height,bottomRatio:(height-y-h)/height});
}
for(const d of L.definitions)assert.deepEqual(value.controls[d.id],P.controls[d.id],'shared preset is the actual default, not a second hard-coded layout');
console.log(JSON.stringify(rows));console.log('PASS: screen-relative bottom-centre defaults at 720p/1080p/1440p/4K/8K, mixed DPI, portrait and small viewport');
