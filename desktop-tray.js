'use strict';
// UI-only tray controller. The HUD remains the sole telemetry consumer/solver.
const {performance}=require('node:perf_hooks');
const {SIZES,makePNG}=require('./tray-wheel-icon');
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
function createImages(nativeImage) {
  const result={};
  for(const [key,connected] of [['gray',false],['gold',true]]) {
    const image=nativeImage.createEmpty();
    for(const size of SIZES)image.addRepresentation({scaleFactor:size/16,dataURL:'data:image/png;base64,'+makePNG(size,connected).toString('base64')});
    if(image.isEmpty())throw new Error('方向盘托盘PNG图标初始化失败');
    result[key]=image;
  }
  return result;
}

function createDesktopTray({Tray,nativeImage,tooltipSuffix='Ctrl+Alt+M 编辑',onChange=()=>{}}) {
  const images=createImages(nativeImage),tray=new Tray(images.gray);
  let closed=false,report=null,lastMessageAt=-Infinity,lastAdvanceAt=-Infinity,lastEpoch=null,lastSequence=-1;
  const retiredEpochs=new Set();
  let shown=null,lastTooltip='',waitingReason='等待本机状态';
  let publicStatus={connected:false,reason:waitingReason,iconEmpty:false};
  function healthy(now=performance.now()) {
    return !!report&&!report.error&&now-lastMessageAt<=STALE_MS&&now-lastAdvanceAt<=STALE_MS;
  }
  function show(connected,reason,name) {
    if(closed||tray.isDestroyed())return;
    if(shown!==connected){tray.setImage(connected?images.gold:images.gray);shown=connected;}
    const tooltip=['SimRacingOverlay',reason,tooltipSuffix].filter(Boolean).join(' · ');
    if(tooltip!==lastTooltip){tray.setToolTip(tooltip);lastTooltip=tooltip;}
    const next={connected,reason,...(connected&&name?{confirmedName:name}:{}),iconEmpty:false};
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
  return {tray,acceptState,invalidate,dispose,setTooltipSuffix:value=>{tooltipSuffix=safeName(value);present();},getStatus:()=>({...publicStatus})};
}
module.exports={createDesktopTray};
