'use strict';
const $=s=>document.querySelector(s),names={steering:'方向盘',throttle:'油门',brake:'刹车',handbrake:'手刹',handbrake2:'第二手刹'};
let cfg={},state={},learning=null,buttonLearning=false,previousButtons=[];
const bindings={};
function message(s){$('#message').textContent=s;}
function mapping(k){return k==='handbrake2'?cfg.inputs?.handbrakeInputs?.[1]:k==='handbrake'&&cfg.inputs?.handbrakeInputs?cfg.inputs.handbrakeInputs[0]:cfg.inputs?.[k];}
function refreshLabels(){for(const k in names){const m=bindings[k];$('#value-'+k).textContent=m?m.axis+' · 已绑定':'使用自动 / 游戏数据';}}
for(const [k,label]of Object.entries(names)){
 const row=document.createElement('div');row.className='row';row.innerHTML=`<label>${label}</label><button data-start="${k}">开始</button><button data-clear="${k}">恢复自动</button><output id="value-${k}"></output>`;$('#axes').append(row);
}
for(let i=0;i<18;i++)$('#slot').add(new Option(String(i+1),String(i)));
$('#axes').onclick=e=>{const k=e.target.dataset.start,clear=e.target.dataset.clear;if(clear){delete bindings[clear];refreshLabels();return;}if(!k)return;if(learning){if(learning.key!==k){message('请先完成当前轴的学习。');return;}finish();e.target.textContent='开始';return;}
 const samples={};for(const d of state.devices||[])for(const[a,v]of Object.entries(d.axes))samples[d.id+':'+a]={deviceId:d.id,productId:d.productId,axis:a,min:v,max:v,rest:v,last:v};
 learning={key:k,samples};e.target.textContent='完成';message('现在只移动'+names[k]+'到两端，再点“完成”。');};
function finish(){const l=learning;learning=null;const candidates=Object.values(l.samples).filter(x=>x.max-x.min>=100).sort((a,b)=>(b.max-b.min)-(a.max-a.min));const best=candidates[0];if(!best){message('没有检测到足够的轴行程，请重试。');return;}const span=best.max-best.min;bindings[l.key]={deviceId:best.deviceId,productId:best.productId,axis:best.axis,min:best.min,max:best.max,invert:l.key!=='steering'&&best.rest>(best.min+best.max)/2};refreshLabels();message('已学习'+names[l.key]+'。请保存设置。');}
$('#learnButton').onclick=()=>{buttonLearning=true;previousButtons=(state.devices||[]).flatMap(d=>d.buttons.map(b=>d.id+':'+b));message('请按方向盘上的一个按钮。');};
$('#save').onclick=async()=>{try{if(learning)throw Error('请先完成当前轴学习。');const inputs={};for(const[k,v]of Object.entries(bindings))if(k!=='handbrake2')inputs[k]=v;if(bindings.handbrake2){if(!bindings.handbrake)throw Error('请同时学习第一手刹。');inputs.handbrakeInputs=[bindings.handbrake,bindings.handbrake2];delete inputs.handbrake;}const range=Number($('#range').value);if(range<180||range>2520)throw Error('总转向角应为180–2520度。');const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Overlay-Token':state.configToken},body:JSON.stringify({inputs,steeringRange:range,buttonMap:cfg.buttonMap||[],ledObserver:$('#led').checked})});if(!r.ok)throw Error((await r.json()).error||'保存失败');message('已保存。灯色观察服务将在关联启动时应用。');}catch(e){message(e.message);}};
async function poll(){try{const r=await fetch('/state');state=await r.json();$('#devices').textContent=(state.devices||[]).map(d=>d.name).join(' · ')||'未检测到输入设备，仍可使用 SimHub 游戏数据';$('#live').textContent=`方向 ${state.angle.toFixed(0)}°　油门 ${state.throttle.toFixed(0)}%　刹车 ${state.brake.toFixed(0)}%　手刹 ${state.handbrake.toFixed(0)}%`;
 if(learning)for(const d of state.devices||[])for(const[a,v]of Object.entries(d.axes)){const sample=learning.samples[d.id+':'+a];if(sample){sample.min=Math.min(sample.min,v);sample.max=Math.max(sample.max,v);sample.last=v;}}
 if(buttonLearning){const wheel=bindings.steering?.deviceId;for(const d of state.devices||[]){if(wheel&&d.id!==wheel)continue;const b=d.buttons.find(b=>!previousButtons.includes(d.id+':'+b));if(b){const slot=Number($('#slot').value);cfg.buttonMap??=[];cfg.buttonMap[slot]=b;$('#buttonResult').textContent=`位置 ${slot+1} ← 按钮 ${b}`;buttonLearning=false;message('已学习按键。请保存设置。');break;}}}
 }catch{message('本机服务暂未连接，正在重试…');}setTimeout(poll,80);}
(async()=>{try{cfg=await(await fetch('/api/settings')).json();cfg.inputs??={};for(const k in names){const m=mapping(k);if(m)bindings[k]=m;}$('#range').value=cfg.steeringRange||900;$('#led').checked=!!cfg.ledObserver;refreshLabels();}catch(e){message(e.message);}poll();})();
