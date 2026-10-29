'use strict';
(function(root){
 const ID=/^[a-z][a-z0-9-]{0,63}$/;
 function check(ok,message){if(!ok)throw Error(message);}
 const finite=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
 function buttons(v){check(Array.isArray(v)&&v.length<=32&&v.every(n=>Number.isInteger(n)&&n>=1&&n<=512),'按键编号应为 1–512');return [...new Set(v)];}
 function validate(p){
  check(p&&p.schemaVersion===1&&typeof p.id==='string'&&ID.test(p.id)&&p.id!=='default','盘面格式或标识无效');
  check(typeof p.name==='string'&&p.name.length>0&&p.name.length<=80,'盘面名称无效');
  check(JSON.stringify(p.size)==='[1315,1197]'&&JSON.stringify(p.center)==='[655,602.5]','盘面尺寸或轴心不受支持');
  check(Array.isArray(p.calibration)&&p.calibration.length===2&&p.calibration.every(n=>finite(n,.8,1.2)),'盘面校正无效');
  check(typeof p.image==='string'&&p.image.length<=8*1024*1024&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.image),'盘面必须为内嵌 PNG');
  const encoded=p.image.slice(22);check(encoded.length%4===0,'PNG 编码无效');
  const head=typeof Buffer!=='undefined'?Buffer.from(encoded.slice(0,44),'base64'):Uint8Array.from(atob(encoded.slice(0,44)),c=>c.charCodeAt(0));
  const u32=i=>((head[i]*0x1000000)+(head[i+1]<<16)+(head[i+2]<<8)+head[i+3]);
  check([137,80,78,71,13,10,26,10].every((v,i)=>head[i]===v)&&u32(8)===13&&String.fromCharCode(...head.slice(12,16))==='IHDR'&&u32(16)===1315&&u32(20)===1197,'PNG 实际尺寸无效');
  const seen=new Set();
  function control(c,encoder=false){
   check(c&&typeof c.id==='string'&&ID.test(c.id)&&!seen.has(c.id),'控件标识无效或重复');seen.add(c.id);
   check(typeof c.label==='string'&&c.label.length<=60&&finite(c.x,0,1315)&&finite(c.y,0,1197)&&finite(c.r??35,5,90),'控件位置无效');
   const out={id:c.id,label:c.label,x:c.x,y:c.y,r:c.r??35,b:buttons(c.b)};
   if(c.led!==undefined){check(Number.isInteger(c.led)&&c.led>=(encoder?8:0)&&c.led<=(encoder?11:7),'按键灯索引无效');out.led=c.led;}
   if(encoder&&c.first!==undefined){check(Number.isInteger(c.first)&&c.first>=1&&c.first<=501,'旋钮编号无效');out.first=c.first;}
   return out;
  }
  check(Array.isArray(p.controls)&&p.controls.length<=48&&Array.isArray(p.encoders)&&p.encoders.length<=4,'控件数量无效');
  const controls=p.controls.map(c=>control(c)),encoders=p.encoders.map(c=>control(c,true));
  check(Array.isArray(p.ledShapes)&&p.ledShapes.length<=32,'转速灯数量无效');
  const ledShapes=p.ledShapes.map((s,i)=>{check(s.led===i&&Array.isArray(s.points)&&s.points.length>=3&&s.points.length<=64&&s.points.every(v=>Array.isArray(v)&&v.length===2&&finite(v[0],0,1315)&&finite(v[1],0,1197)),'转速灯位置无效');return {led:i,points:s.points.map(v=>v.slice())};});
  check(p.dashboard===null||Array.isArray(p.dashboard)&&p.dashboard.length===4&&p.dashboard.every((v,i)=>finite(v,i<2?0:1,i%2===0?1315:1197)),'仪表位置无效');
  return {schemaVersion:1,id:p.id,name:p.name,size:[1315,1197],center:[655,602.5],calibration:p.calibration.slice(),image:p.image,controls,encoders,ledShapes,dashboard:p.dashboard?.slice()??null};
 }
 function settings(input){
  const out={faceId:typeof input?.faceId==='string'&&ID.test(input.faceId)?input.faceId:'default',dashboardMode:['auto','separate','hidden'].includes(input?.dashboardMode)?input.dashboardMode:'auto',buttonMaps:{}};
  const entries=Object.entries(input?.buttonMaps||{}).slice(0,32);
  for(const [face,map] of entries){if(!ID.test(face)||['__proto__','constructor','prototype'].includes(face)||!map||typeof map!=='object')continue;const clean={};for(const [id,b] of Object.entries(map).slice(0,52)){if(!ID.test(id)||['__proto__','constructor','prototype'].includes(id))continue;try{clean[id]=buttons(b);}catch{}}out.buttonMaps[face]=clean;}
  return out;
 }
 function mapControls(face,maps,legacy){return face.controls.map((c,i)=>({...c,b:Object.hasOwn(maps||{},c.id)?maps[c.id].slice():face.id==='default'&&Number.isInteger(legacy?.[i])&&legacy[i]>0?[legacy[i]]:c.b.slice()}));}
 function resample(colors,count){if(!count||!colors?.length)return [];return Array.from({length:count},(_,i)=>colors[Math.min(colors.length-1,count===1?colors.length-1:Math.round(i*(colors.length-1)/(count-1)))]);}
 // These are display colours only; no device commands are emitted.
 function shiftColors(game,now,count=16){
  if(!game?.available||game.paused===true||game.inMenu===true)return null;
  const s=game.shiftLights,rpm=game.rpm,start=s?.firstRpm,end=s?.lastRpm;
  let fraction=Number.isFinite(s?.indicator)?s.indicator:Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Number.isFinite(rpm)?(rpm-start)/(end-start):null;
  let source=Number.isFinite(s?.indicator)?'game-shift-indicator':'game-shift-thresholds';
  if(fraction===null){const ratio=Number.isFinite(game.maxRpm)&&game.maxRpm>0&&Number.isFinite(rpm)?rpm/game.maxRpm:null;if(ratio!==null){fraction=(ratio-.65)/.35;source='game-rpm-ratio';}}
  if(fraction===null)return null;fraction=Math.max(0,Math.min(1,fraction));
  const blink=Number.isFinite(s?.blinkRpm)&&Number.isFinite(rpm)&&rpm>=s.blinkRpm;
  return {source,colors:Array.from({length:count},(_,i)=>i<Math.ceil(fraction*count)?blink?(Math.floor(now/100)%2?'#ff314d':'#28050b'):i/count>=.8?'#d39ce0':i/count>=.55?'#ebc777':'#8dcdb8':'#11171e')};
 }
 const api={validate,settings,mapControls,resample,shiftColors};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WheelProfiles=api;
})(typeof window!=='undefined'?window:globalThis);
