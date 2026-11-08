'use strict';
// UI-only tray controller. The HUD remains the sole telemetry consumer/solver.
const {performance}=require('node:perf_hooks');
const {SIZES,makeRGBA,makePNG}=require('./tray-wheel-icon');
const STALE_MS=3000;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// DirectInput reports this R25 Ultra wheelbase as FirstPerson.
const R25_ULTRA_PRODUCT='0000346e-0000-0000-0000-504944564944';
function id(value) {
  if(typeof value!=='string')return '';
  const v=value.trim().replace(/^\{(.*)\}$/,'$1').toLowerCase();
  return GUID.test(v)?v:'';
}
function safeName(value) {return typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,160):'';}
function snapshot(value) {
  if(!value||!Number.isFinite(value.sourceTimestamp)||value.sourceTimestamp<=0||!Array.isArray(value.devices)||value.devices.length>128)return null;
  const hardware=value.hardware;
  if(!hardware||typeof hardware.epoch!=='string'||!hardware.epoch.length||hardware.epoch.length>128||!Number.isSafeInteger(hardware.sequence)||hardware.sequence<0)return null;
  if(!Number.isFinite(hardware.validForMs)||hardware.validForMs<=0)return null;
  const devices=[];
  for(const row of value.devices) {
    if(!row||!id(row.id)||typeof row.type!=='string')return null;
    if(!Number.isFinite(row.ageMs)||row.ageMs<0||row.ageMs>=hardware.validForMs)continue;
    devices.push({id:id(row.id),productId:id(row.productId),name:safeName(row.name),type:row.type.slice(0,48)});
  }
  const steering=hardware.channels?.steering;
  return {sourceTimestamp:value.sourceTimestamp,epoch:hardware.epoch,sequence:hardware.sequence,
    error:typeof value.error==='string'?value.error.slice(0,256):'',devices,
    steeringId:steering?.state==='valid'?id(steering.deviceId):''};
}
function updatePNG(size,connected){
  const {deflateSync}=require('node:zlib'),rgba=makeRGBA(size,connected),stride=size*4,rows=Buffer.alloc((stride+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=(x+.5)*32/size,py=(y+.5)*32/size,d=Math.hypot(px-26,py-6),at=(y*size+x)*4;
    if(d<5.5){const color=d<3.8?[244,208,111]:[35,35,35];rgba[at]=color[0];rgba[at+1]=color[1];rgba[at+2]=color[2];rgba[at+3]=255;}
  }
  for(let y=0;y<size;y++)rgba.copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride);
  function chunk(kind,data){const k=Buffer.from(kind),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);k.copy(out,4);data.copy(out,8);let crc=0xffffffff;for(const b of Buffer.concat([k,data])){crc^=b;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
  const head=Buffer.alloc(13);head.writeUInt32BE(size);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function createImages(nativeImage) {
  const result={};
  for(const [key,connected] of [['gray',false],['gold',true]]) {
    for(const badge of [false,true]){
    const image=nativeImage.createEmpty();
    for(const size of SIZES)image.addRepresentation({scaleFactor:size/16,dataURL:'data:image/png;base64,'+(badge?updatePNG(size,connected):makePNG(size,connected)).toString('base64')});
    if(image.isEmpty())throw new Error('方向盘托盘PNG图标初始化失败');
    result[key+(badge?'Update':'')]=image;
    }
  }
  return result;
}

function createDesktopTray({Tray,nativeImage,tooltipSuffix='Ctrl+Alt+M 编辑',onChange=()=>{}}) {
  const images=createImages(nativeImage),tray=new Tray(images.gray);
  let closed=false,report=null,lastMessageAt=-Infinity,lastAdvanceAt=-Infinity,lastEpoch=null,lastSequence=-1;
  const retiredEpochs=new Set();
  let updateAvailable=false;
  let shown=null,lastTooltip='',waitingReason='等待本机状态';
  let publicStatus={connected:false,reason:waitingReason,iconEmpty:false};
  function healthy(now=performance.now()) {
    return !!report&&!report.error&&now-lastMessageAt<=STALE_MS&&now-lastAdvanceAt<=STALE_MS;
  }
  function show(connected,reason,name) {
    if(closed||tray.isDestroyed())return;
    const icon=(connected?'gold':'gray')+(updateAvailable?'Update':'');if(shown!==icon){tray.setImage(images[icon]);shown=icon;}
    const tooltip=['SimRacingOverlay',reason,updateAvailable?'有可用更新':'',tooltipSuffix].filter(Boolean).join(' · ');
    if(tooltip!==lastTooltip){tray.setToolTip(tooltip);lastTooltip=tooltip;}
    const next={connected,reason,updateAvailable,...(connected&&name?{confirmedName:name}:{}),iconEmpty:false};
    if(JSON.stringify(next)!==JSON.stringify(publicStatus)){publicStatus=next;onChange({...next});}
  }
  function present() {
    if(closed)return;
    if(!report){show(false,waitingReason);return;}
    if(report.error){show(false,'本机输入状态异常');return;}
    if(!healthy()){show(false,'本机状态已中断');return;}
    // Explicit, valid steering bindings establish a role. Otherwise only native
    // device metadata (including the confirmed R25 exception) establishes it.
    const wheel=report.devices.find(d=>d.id===report.steeringId)||report.devices.find(d=>
      d.type==='Driving'||d.type==='FirstPerson'&&d.productId===R25_ULTRA_PRODUCT);
    if(wheel){const name=wheel.name||'方向盘';show(true,'方向盘已连接 · '+name,name);return;}
    show(false,'未检测到方向盘');
  }
  function invalidate(reason='等待本机状态') {
    if(closed)return;
    report=null;lastMessageAt=-Infinity;lastAdvanceAt=-Infinity;lastEpoch=null;lastSequence=-1;retiredEpochs.clear();
    waitingReason=safeName(reason)||'等待本机状态';present();
  }
  function acceptState(value) {
    if(closed)return;
    const next=snapshot(value);
    if(!next){report=null;waitingReason='本机输入信息不完整';present();return;}
    if(retiredEpochs.has(next.epoch))return;
    if(next.epoch===lastEpoch&&next.sequence<lastSequence)return;
    const now=performance.now();
    if(next.epoch===lastEpoch&&next.sequence===lastSequence){
      // An aging publication may remove expired devices, but cannot restore
      // one or extend sampling freshness without a genuinely newer sample.
      if(report){
        report={...report,devices:report.devices.filter(d=>next.devices.some(row=>row.id===d.id)),
          error:report.error||next.error,steeringId:next.steeringId===report.steeringId?report.steeringId:''};
        lastMessageAt=now;present();
      }
      return;
    }
    if(lastEpoch!==null&&next.epoch!==lastEpoch)retiredEpochs.add(lastEpoch);
    lastEpoch=next.epoch;lastSequence=next.sequence;
    lastMessageAt=now;lastAdvanceAt=now;
    report=next;present();
  }
  const watchdog=setInterval(present,1000);
  function dispose() {
    if(closed)return;
    closed=true;clearInterval(watchdog);
    if(!tray.isDestroyed())tray.destroy();
    publicStatus={connected:false,reason:'托盘已停止',iconEmpty:false};
  }
  present();
  return {tray,setUpdateAvailable:value=>{updateAvailable=!!value;present();},acceptState,invalidate,dispose,setTooltipSuffix:value=>{tooltipSuffix=safeName(value);present();},getStatus:()=>({...publicStatus})};
}
module.exports={createDesktopTray};
