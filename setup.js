'use strict';
// UI-D3 C21/C27: existing axis selection/normalisation retained; adoption is explicit.
const $=s=>document.querySelector(s),names={steering:'方向盘',throttle:'油门',brake:'刹车',handbrake:'手刹',handbrake2:'第二手刹'};
let cfg={},state={},learning=null,buttonLearning=false,previousButtons=[],active=new URLSearchParams(location.search).get('embedded')!=='1',pollTimer=null,saving=false,baseline='',loaded=false;
let configToken=null,disposed=false,pollEpoch=0,pollRequest=null,configEpoch=0,configRequest=null,saveRequest=null,saveUncertain=false,resumeButtons=false;
function text(selector,value){const node=$(selector);if(node.textContent!==value)node.textContent=value;}
const bindings={};
function message(text,error=false){$('#message').textContent=text;$('#message').dataset.tone=error?'danger':'info';$('#message').setAttribute('role',error?'alert':'status');}
function mapping(k){return k==='handbrake2'?cfg.inputs?.handbrakeInputs?.[1]:k==='handbrake'&&cfg.inputs?.handbrakeInputs?cfg.inputs.handbrakeInputs[0]:cfg.inputs?.[k];}
function data(){const inputs={};for(const[k,v]of Object.entries(bindings))if(k!=='handbrake2')inputs[k]=v;if(bindings.handbrake2){inputs.handbrakeInputs=[bindings.handbrake,bindings.handbrake2];delete inputs.handbrake;}return {inputs,steeringRange:Number($('#range').value),buttonMap:cfg.buttonMap||[],ledObserver:$('#led').checked};}
function changed(){return loaded&&JSON.stringify(data())!==baseline;}
function refreshLabels(){for(const k in names){const m=bindings[k];$('#value-'+k).textContent=m?m.axis+' · 已采用':'自动／游戏输入';$('#start-'+k).textContent=learning?.key===k?'采样中':'开始学习';$('#start-'+k).disabled=!!learning;$('#adopt-'+k).hidden=learning?.key!==k;$('#cancel-'+k).hidden=learning?.key!==k;$('#meter-'+k).hidden=learning?.key!==k;$('#old-'+k).textContent=learning?.key===k?'原绑定：'+(m?m.axis:'自动／游戏输入'):'恢复自动仅清除此轴绑定';}}
for(const[k,label]of Object.entries(names)){const row=document.createElement('div');row.className='axis-row';row.innerHTML='<label>'+label+'</label><output id="value-'+k+'"></output><button class="lx-button lx-material-edge-on-hover" id="start-'+k+'" data-start="'+k+'">开始学习</button><button class="lx-button lx-button--primary lx-material-gold lx-material-glow-on-hover" id="adopt-'+k+'" data-adopt="'+k+'" hidden>采用</button><button class="lx-button lx-material-edge-on-hover lx-material-glow-on-hover" id="cancel-'+k+'" data-cancel="'+k+'" hidden>取消</button><button class="lx-button lx-material-edge-on-hover" data-clear="'+k+'">恢复自动</button><small id="old-'+k+'"></small><progress class="axis-meter" id="meter-'+k+'" max="100" value="0" hidden></progress>';$('#axes').append(row);}
let slot='0';const slotSelect=new UIControls.Select($('#slotSelect'),{label:'旧通用按键位置',options:Array.from({length:18},(_,i)=>({value:String(i),label:'位置 '+(i+1)})),value:'0',onChange:value=>{slot=value;showButton();}});
function showButton(){const v=cfg.buttonMap?.[Number(slot)];$('#buttonResult').textContent='位置 '+(Number(slot)+1)+' ← '+(Number.isInteger(v)?'按钮 '+v:'未绑定');}
function bestSample(){return Object.values(learning?.samples||{}).filter(x=>x.max-x.min>=100).sort((a,b)=>(b.max-b.min)-(a.max-a.min))[0];}
$('#axes').onclick=e=>{const start=e.target.dataset.start,adopt=e.target.dataset.adopt,cancel=e.target.dataset.cancel,clear=e.target.dataset.clear;if(clear){if(learning){message('请先采用或取消当前学习',true);return;}delete bindings[clear];refreshLabels();message('已恢复'+names[clear]+'自动输入；请保存设备设置');return;}if(cancel){learning=null;refreshLabels();message('已取消本次采样，原绑定保留');return;}if(adopt){if(learning?.key!==adopt)return;const best=bestSample();if(!best){message('没有检测到足够的轴行程，请继续操作或取消',true);return;}bindings[adopt]={deviceId:best.deviceId,productId:best.productId,axis:best.axis,min:best.min,max:best.max,invert:adopt!=='steering'&&best.rest>(best.min+best.max)/2};learning=null;refreshLabels();message('已采用'+names[adopt]+'新绑定；请保存设备设置');return;}if(!start||learning)return;const samples={};for(const d of state.devices||[])for(const[a,v]of Object.entries(d.axes||{}))if(Number.isFinite(v))samples[d.id+':'+a]={deviceId:d.id,productId:d.productId,axis:a,min:v,max:v,rest:v,last:v};learning={key:start,samples};refreshLabels();message('只操作'+names[start]+'到实际两端，然后采用；取消保留原绑定。');};
$('#learnButton').onclick=()=>{buttonLearning=true;previousButtons=(state.devices||[]).flatMap(d=>(d.buttons||[]).map(b=>d.id+':'+b));$('#cancelButton').hidden=false;message('请按方向盘上的一个按钮');};$('#cancelButton').onclick=()=>{buttonLearning=false;$('#cancelButton').hidden=true;message('已取消按键学习，原映射保留');};$('#clearButton').onclick=()=>{cfg.buttonMap??=[];cfg.buttonMap[Number(slot)]=null;showButton();message('此通用位置已清除；请保存设备设置');};
$('#save').onclick=async()=>{
 if(saving||disposed||!loaded)return;
 let submitted=null,confirmed=false,request=null,timer=null;
 try{if(learning)throw Error('请先采用或取消当前轴学习');if(buttonLearning)throw Error('请先完成或取消按键学习');if(bindings.handbrake2&&!bindings.handbrake)throw Error('第二手刹需要同时保留第一手刹绑定');const value=data();if(!Number.isFinite(value.steeringRange)||value.steeringRange<180||value.steeringRange>2520)throw Error('总转向角应为180–2520度');
  submitted=JSON.stringify(value);request=new AbortController();saveRequest=request;saving=true;$('#save').disabled=true;message('正在保存设备设置…');timer=setTimeout(()=>request.abort(),10000);
  const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Overlay-Token':configToken},body:submitted,signal:request.signal});
  if(!r.ok){let detail;try{detail=(await r.json()).error;}catch{}confirmed=true;throw Error(detail||'保存失败：'+r.status);}
  const result=await r.json();if(result?.ok!==true)throw Error('服务未确认写入');confirmed=true;
  if(disposed||saveRequest!==request)return;baseline=submitted;saveUncertain=false;message(changed()?'已保存本次提交；保存期间的新修改尚未保存。':'已保存设备设置。灯色观察在关联启动时应用。');
 }catch(e){if(disposed)return;if(submitted!==null&&!confirmed){saveUncertain=true;message('保存结果尚未确认；当前设置保留，请重试保存。',true);}else message(e.message+'；当前设置保留',true);}
 finally{clearTimeout(timer);if(saveRequest===request)saveRequest=null;saving=false;if(!disposed)$('#save').disabled=!loaded;}
};
async function poll(){
 pollTimer=null;if(!active||disposed||pollRequest)return;const epoch=pollEpoch,request=new AbortController();pollRequest=request;const timeout=setTimeout(()=>request.abort(),2000);
 try{const r=await fetch('/state',{cache:'no-store',signal:request.signal});if(!r.ok)throw Error('服务返回'+r.status);const incoming=await r.json();if(disposed||!active||epoch!==pollEpoch||pollRequest!==request)return;state=incoming;if(typeof incoming.configToken==='string')configToken=incoming.configToken;
  text('#devices',(state.devices||[]).map(d=>d.name).join(' · ')||'未检测到输入设备，仍可使用游戏遥测');const value=v=>Number.isFinite(v)?v.toFixed(0):'—';text('#live','方向 '+value(state.angle)+'°　油门 '+value(state.throttle)+'%　刹车 '+value(state.brake)+'%　手刹 '+value(state.handbrake)+'%');
  if(learning){for(const d of state.devices||[])for(const[a,v]of Object.entries(d.axes||{})){if(!Number.isFinite(v))continue;const key=d.id+':'+a;const sample=learning.samples[key]??=( {deviceId:d.id,productId:d.productId,axis:a,min:v,max:v,rest:v,last:v} );sample.min=Math.min(sample.min,v);sample.max=Math.max(sample.max,v);sample.last=v;}const best=bestSample();$('#meter-'+learning.key).value=best?Math.min(100,(best.max-best.min)/65535*100):0;}
  const pressed=(state.devices||[]).flatMap(d=>(d.buttons||[]).map(b=>d.id+':'+b));
  if(buttonLearning&&!resumeButtons){const wheel=bindings.steering?.deviceId;for(const d of state.devices||[]){if(wheel&&d.id!==wheel)continue;const b=(d.buttons||[]).find(b=>!previousButtons.includes(d.id+':'+b));if(b){cfg.buttonMap??=[];cfg.buttonMap[Number(slot)]=b;buttonLearning=false;$('#cancelButton').hidden=true;showButton();message('已采用按键；请保存设备设置');break;}}}
  previousButtons=pressed;resumeButtons=false;
 }catch(e){if(!disposed&&active&&epoch===pollEpoch&&pollRequest===request){state={};resumeButtons=buttonLearning;text('#devices','本机服务暂未连接：'+(e.name==='AbortError'?'读取超时':e.message)+'；设置与采样保留');text('#live','等待新的输入');}}
 finally{clearTimeout(timeout);if(pollRequest===request){pollRequest=null;if(active&&!disposed&&epoch===pollEpoch)pollTimer=setTimeout(poll,80);}}
}
function setActive(value){
 const next=!!value&&!disposed;if(next===active)return;active=next;pollEpoch++;clearTimeout(pollTimer);pollTimer=null;pollRequest?.abort();pollRequest=null;
 if(!active){state={};configEpoch++;configRequest?.abort();configRequest=null;}
 else{resumeButtons=buttonLearning;if(!loaded)void loadConfig();void poll();}
}
window.InputSetup={setActive,canLeave:()=>{if(learning||buttonLearning){message('请先采用或取消正在进行的学习',true);return false;}if(saving||saveUncertain||changed()){message(saveUncertain?'保存结果尚未确认，请重试保存后再离开。':'设备设置尚未保存，请保存后再离开；布局与设备分别保存',true);return false;}return true;}};
addEventListener('beforeunload',e=>{if(!window.InputSetup.canLeave()){e.preventDefault();e.returnValue=false;}});
function enableForm(enabled){for(const el of document.querySelectorAll('input,button'))if(el.id!=='retryConfig')el.disabled=!enabled;slotSelect.button.disabled=!enabled;if(enabled)refreshLabels();}
async function loadConfig(){
 if(disposed||!active||saving||loaded&&changed())return;const epoch=++configEpoch;configRequest?.abort();const request=new AbortController();configRequest=request;const timeout=setTimeout(()=>request.abort(),5000);enableForm(false);message('正在读取设备设置…');
 try{const r=await fetch('/api/settings',{cache:'no-store',signal:request.signal});if(!r.ok)throw Error('读取设置失败：'+r.status);const incoming=await r.json();if(disposed||!active||epoch!==configEpoch||configRequest!==request)return;
  cfg=incoming;cfg.inputs??={};for(const key of Object.keys(bindings))delete bindings[key];for(const k in names){const m=mapping(k);if(m)bindings[k]=m;}$('#range').value=cfg.steeringRange||900;$('#led').checked=!!cfg.ledObserver;refreshLabels();showButton();loaded=true;baseline=JSON.stringify(data());enableForm(true);$('#retryConfig').hidden=true;message('设备设置已读取，与布局分别保存');
 }catch(e){if(!disposed&&active&&epoch===configEpoch&&configRequest===request){message((e.name==='AbortError'?'读取设置超时':e.message)+'；未改动现有设置',true);$('#retryConfig').hidden=false;}}
 finally{clearTimeout(timeout);if(configRequest===request)configRequest=null;}
}
addEventListener('unload',()=>{disposed=true;active=false;pollEpoch++;configEpoch++;clearTimeout(pollTimer);pollRequest?.abort();configRequest?.abort();saveRequest?.abort();},{once:true});
$('#retryConfig').onclick=loadConfig;enableForm(false);if(active){void loadConfig();void poll();}
