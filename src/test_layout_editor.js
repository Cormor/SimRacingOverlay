'use strict';
const assert=require('node:assert/strict'),L=require('../layout'),Flags=require('../flags');
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
L.setDesktopStage({width:1909,height:1074,originX:1120.3,originY:422.9,scale:.489});
const old={version:2,controls:{frontResponse:{x:0,y:0,sx:2,sy:2},rearResponse:{x:10,y:0,sx:2,sy:2},gBall:{x:7,y:35,sx:1.46,sy:1.46}}};
const migrated=L.clean(old);
for(const id of Object.keys(old.controls)){
 const d=L.byId.get(id),[ox,oy,ow,oh]=d.legacy,[x,y,w,h]=d.bounds,c=migrated.controls[id],v=old.controls[id];
 for(const [px,py] of [[x,y],[x+w,y+h]]){near(ox+ow/2+v.x+(px-ox-ow/2)*v.sx,x+w/2+c.x+(px-x-w/2)*c.sx);near(oy+oh/2+v.y+(py-oy-oh/2)*v.sy,y+h/2+c.y+(py-y-h/2)*c.sy);}
}
assert.deepEqual(L.clean(migrated),migrated,'migration is idempotent');
L.set(migrated);
const source=L.get(),ids=['frontResponse','rearResponse'],before=L.bounds(ids);
const move=L.transform(source,ids,{dx:51,dy:-23});
near(L.bounds(ids,move).x,before.x+51);near(L.bounds(ids,move).y,before.y-23);
const rotation=L.transform(source,ids,{rotation:90});
for(const id of ids)near(rotation.controls[id].rotation,90);
near(L.bounds(ids,rotation).w,before.h);near(L.bounds(ids,rotation).h,before.w);
const restore=L.transform(rotation,ids,{rotation:-90});
for(const id of ids){near(restore.controls[id].x,source.controls[id].x);near(restore.controls[id].y,source.controls[id].y);}
source.controls.frontResponse.locked=true;
assert.deepEqual(L.transform(source,ids,{dx:10,rotation:90}).controls.frontResponse,source.controls.frontResponse);
L.set(source);const d=L.byId.get('rearResponse'),c=source.controls.rearResponse,b=L.box(d,c);
assert.equal(L.hit(b.x+b.w/2,b.y+b.h/2),'rearResponse');
source.controls.rearResponse.enabled=false;L.set(source);assert.notEqual(L.hit(b.x+b.w/2,b.y+b.h/2),'rearResponse');
L.begin();L.group('rearResponse',()=>{});L.group('flags',()=>{});assert.deepEqual(L.capture().map(j=>j.id),['flags']);
const off=L.get();off.controls.wheel.x=-10000;L.set(off);L.begin();L.group('wheel',()=>{});assert.equal(L.capture()[0].c.x,-10000,'paint and editor keep identical coordinates');
const s=L.stage(),world={x:123,y:-30},r={x:5,y:8,width:954.5,height:537};
const p=L.point(r.x+(s.originX+world.x*s.scale)/2,r.y+(s.originY+world.y*s.scale)/2,r);near(p.x,world.x);near(p.y,world.y);
const flagsGame={available:true,source:'iRacing-SDK',statuses:{sessionFlags:8}};
assert.equal(Flags.forGame(flagsGame).name,'黄旗');
for(const source of ['F1-25-UDP','ACR','SimHub',null])assert.equal(Flags.forGame({...flagsGame,source}),null);
assert.equal(Flags.forGame({...flagsGame,paused:true}),null);assert.equal(Flags.forGame(flagsGame,false),null);
assert.equal(Flags.current(0x2000),null,'random marshal waving is not a yellow flag');
assert.equal(Flags.current(0x100000).name,'维修旗');assert.equal(Flags.current(0x20000).name,'取消资格');
console.log('PASS: layout migration, group translation/rotation/recovery, locking, module visibility, identical draw/hit coordinates, DPI mapping and iRacing-only flags');

L.setDesktopStage(null);L.set(L.clean(null));
const initial=L.bounds(L.definitions.map(d=>d.id)),screen=L.viewport();
assert(initial.x>=screen.x&&initial.y>=screen.y&&initial.x+initial.w<=screen.x+screen.w&&initial.y+initial.h<=screen.y+screen.h,'fresh browser defaults include the entire flag and all modules');
assert.equal(L.clean({version:2,controls:{frontResponse:{sx:2,sy:2}}}).controls.frontResponse.y,-14,'partial legacy import migrates once');

const v=L.clean(null),group=['frontResponse','rearResponse'],beforeScale=L.bounds(group,v),scaled=L.transform(v,group,{scaleX:1.2});
near(L.bounds(group,scaled).w,beforeScale.w*1.2);near(L.bounds(group,scaled).h,beforeScale.h*1.2);

const lockedSelection=L.clean(null);lockedSelection.controls.wheel.locked=true;L.set(lockedSelection);L.select(['wheel','flags']);
const rects=[],context=new Proxy({}, {get:(o,k)=>k==='strokeRect'?(...p)=>rects.push(p):()=>{},set:(o,k,v)=>true});
L.flush(context,null,[]);const visibleHandle=L.bounds(['flags']);assert.deepEqual(rects.at(-1),[visibleHandle.x,visibleHandle.y,visibleHandle.w,visibleHandle.h],'mixed locked selection paints handles at the same active bounds used by pointer gestures');
