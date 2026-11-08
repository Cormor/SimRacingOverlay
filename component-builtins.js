'use strict';
(function(root){
 function install(R,PedalTraction){
  const contract='pedal-traction.v1',provides=['signal','duration','event'];
  for(const [id,label]of [['throttle','油门响应指示'],['brake','刹车响应指示']])R.register('component',{id,label,version:'1.0.0',contract,defaults:{algorithm:'pedal.observed-response',presentation:'pedal.outline',animation:'motion.none',theme:'palette.telemetry'}});
  const names={green:'response-increasing',red:'response-decreasing',yellow:'response-plateau'};
  for(const strict of [false,true])R.register('algorithm',{
   id:strict?'pedal.force-response':'pedal.observed-response',version:'1.0.0',contract,
   label:strict?'仅轮胎力响应':'轮胎响应观察',
   description:strict?'仅在可比较轮胎力响应出现变化时提示，持续严重滑移单独不提示。':'观察可比较的轮胎力与滑移变化；持续严重滑移可单独提示。',
   requires:['telemetry.longitudinal-force','telemetry.slip-ratio'],provides:[...provides,'force-response',...(strict?[]:['sustained-slip-symptom'])],
   create:({component})=>{
    const observer=strict?new PedalTraction.Observer({severeSlip:false}):null;let signal=null,since=null;
    return {update:({state,unloaded,now,baseline})=>{
     const cue=strict?observer.update(state,unloaded,now):baseline;
     if(!cue||cue.pedal!==(component==='throttle'?'drive':'brake')){signal=null;since=null;return {contract,status:'unavailable',signal:null,reason:'no-comparable-response'};}
     const next=cue.evidence==='sustained-slip'?'sustained-slip':names[cue.state];if(signal!==next||since===null){signal=next;since=cue.observedAt;}
     return {contract,status:'available',signal,observedAt:cue.observedAt,validUntil:cue.observedAt+240,eventId:cue.pedal+':'+since+':'+signal,evidence:cue.evidence||'force-response'};
    },reset:()=>{observer?.reset();signal=null;since=null;}};
   }
  });
  const colors={'response-increasing':'#66f0c3','response-plateau':'#ffc34e','response-decreasing':'#ff183c','sustained-slip':'#ffc34e'};
  R.register('theme',{id:'palette.telemetry',version:'1.0.0',label:'标准',family:'standard',description:'保留当前轨道与绿、黄、红提示色。',contract,tokens:{mode:'standard',colors,track:'#20252de0',inactive:'#07090d',lineWidth:6}});
  R.register('theme',{id:'palette.platinum',version:'1.0.0',label:'白金轨道',family:'standard',description:'明亮轨道边缘，保留绿、黄、红提示色。',contract,tokens:{mode:'standard',colors,track:'#29313be0',inactive:'#a8b6c8',lineWidth:6}});
  R.register('animation',{id:'motion.none',version:'1.0.0',label:'默认',description:'随输入与响应即时更新。',fixed:true,contract,requires:['signal'],create:()=>({sample:()=>({opacity:1,glow:0,nextAt:null})})});
  R.register('animation',{id:'motion.pulse',version:'1.0.0',label:'默认',description:'随输入与响应即时更新。',deprecated:true,replacement:'motion.none',fixed:true,contract,requires:['signal','duration'],create:()=>({sample:()=>({opacity:1,glow:0,nextAt:null})})});
  function outline({ctx,geometry:g,semantic,motion,tokens,scale}){
   const active=semantic.status==='available',color=active?tokens.colors[semantic.signal]:tokens.inactive;
   ctx.save();ctx.lineJoin='round';ctx.lineWidth=6;ctx.strokeStyle=color||tokens.inactive;ctx.globalAlpha=active?motion.opacity:1;
   if(active){ctx.shadowColor=color;ctx.shadowBlur=motion.glow*(scale||1);}
   ctx.beginPath();ctx.roundRect(g.x-g.w/2,g.y,g.w,g.h,12);ctx.stroke();ctx.restore();
  }
  R.register('presentation',{id:'pedal.outline',version:'1.0.0',label:'整体边框',contract,requires:['signal'],draw:outline});
  R.register('presentation',{id:'pedal.signal',version:'1.0.0',label:'侧向信号条',description:'踏板数值与填充保持即时；响应以组件内侧细条显示。',contract,requires:['signal'],draw:context=>{
   const {ctx,geometry:g,semantic,motion,tokens,scale}=context;
   outline({...context,semantic:{status:'unavailable'}});if(semantic.status!=='available')return;
   ctx.save();ctx.globalAlpha=motion.opacity;ctx.fillStyle=tokens.colors[semantic.signal];ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=motion.glow*(scale||1);
   ctx.beginPath();ctx.roundRect(g.x-g.w/2+7,g.y+8,5,g.h-16,2.5);ctx.fill();ctx.restore();
  }});
  const accessible=[
   ['protan','红色辨识困难（Protan）','#74c8ff','#ffd27a','#f6b7e3'],
   ['deutan','绿色辨识困难（Deutan）','#8ccbff','#ffe08a','#ffabe1'],
   ['tritan','蓝黄色辨识困难（Tritan）','#72d6a4','#ffb8cc','#ffffff'],
   ['contrast','高对比','#ffffff','#ffff00','#ffffff']
  ];
  for(const [type,label,normal,caution,danger]of accessible){const tokens={mode:type,surface:type==='contrast'?'#000000':'#191b1d',text:type==='contrast'?'#ffffff':'#f4f1e8',muted:'#c8c8c8',boundary:type==='contrast'?'#ffffff':'#c8c8c8',normal,caution,danger,colors:{'response-increasing':normal,'response-plateau':caution,'response-decreasing':danger,'sustained-slip':caution},track:type==='contrast'?'#000000':'#191b1d',inactive:type==='contrast'?'#ffffff':'#c8c8c8',lineWidth:type==='contrast'?7:6};
   for(const [prefix,kind]of [['palette.',contract],['hud.palette.','hud-display.v1']])R.register('theme',{id:prefix+(type==='contrast'?'contrast':'cvd-'+type),version:'1.0.0',label,family:type==='contrast'?'contrast':'colorblind',type:type==='contrast'?null:type,description:type==='contrast'?'使用高对比颜色。文字底色与标记可在“辅助”中开启。':'使用适合所选色弱类型的颜色。文字与标记可在“辅助”中开启。',contract:kind,tokens});
  }
  R.register('presentation',{id:'pedal.segmented',version:'1.0.0',label:'分段响应边框',description:'分段轮廓与响应标记，踏板填充即时跟随输入。',contract,requires:['signal'],draw:context=>{context.ctx.save();context.ctx.setLineDash([10,6]);outline(context);context.ctx.restore();responseTag(context);}});
  const components=[
   ['wheel','方向盘盘面','方向盘转角、按键与盘面。'],['slip0','左前轮滑移','左前轮滑移率与锁止状态。'],['slip1','右前轮滑移','右前轮滑移率与锁止状态。'],['slip2','左后轮滑移','左后轮滑移率与锁止状态。'],['slip3','右后轮滑移','右后轮滑移率与锁止状态。'],
   ['frontResponse','左侧裕度 · 上前／下后','左侧前后轮响应与卸载状态。'],['rearResponse','右侧裕度 · 上前／下后','右侧前后轮响应与卸载状态。'],['frontLateral','前轴侧滑／估计侧偏角','前轴侧滑角；缺少原生值时显示估计。'],['rearLateral','后轴侧滑／估计侧偏角','后轴侧滑角；缺少原生值时显示估计。'],['handling','推头／甩尾／侧摆','推头、甩尾或侧摆提示。'],['decel','实际减速','减速度，单位g。'],['handbrake','手刹','手刹输入百分比。'],['statuses','ABS / TC / ESC','ABS、TC、ESC和车辆告警。'],['gBall','G 力球','横纵向加速度、轨迹与峰值。'],['flags','iRacing 旗语与解释','旗语及对应说明。'],['dashboard','独立仪表','档位、转速与速度。']
  ];
  function hostSemantic(id,{state:s,assist={},displayAssist:shown,ball,now,online,sampleAt=now,latches={},waiting=false}){
   const a=shown||assist;
   const g=s.game||{},wheel=/^slip[0-3]$/.test(id)?Number(id.slice(4)):null;
   let summary='',active=false,known=online;
   if(id==='wheel'){known=online&&Number.isFinite(s.angle);summary=known?'转角 '+s.angle.toFixed(1)+'° · 按键 '+(s.buttons||[]).length:'转向未知';active=known&&Math.abs(s.angle)>.1;}
   else if(wheel!==null){const ratio=g.wheels?.[wheel]?.ratio;known=online&&Number.isFinite(ratio);summary=['左前','右前','左后','右后'][wheel]+' '+(known?(ratio*100).toFixed(0)+'%':'—')+(a.unloaded?.[wheel]?' · 卸载':'');active=known&&Math.abs(ratio)>.01;}
   else if(id==='frontLateral'||id==='rearLateral'){const front=id==='frontLateral',native=a.lateral?.[front?'front':'rear'],estimated=a.grip?.vehicleResponse?.[front?'slipAngleFront':'slipAngleRear'],value=Number.isFinite(native)?native:estimated;known=online&&a.fresh&&Number.isFinite(value);summary=(front?'前轴':'后轴')+' '+(known?value.toFixed(1)+'°'+(Number.isFinite(native)?'':' 估计'):'—');active=known&&Math.abs(value)>.1;}
   else if(id==='frontResponse'||id==='rearResponse'){const side=id==='frontResponse'?0:1,v=[a.lateralSlip?.[side],a.lateralSlip?.[side+2]],unloaded=[a.grip?.axles?.front?.unloadedSides?.[side],a.grip?.axles?.rear?.unloadedSides?.[side]];if(Number.isFinite(v[0])&&a.frontResponse)v[0]*=1-a.frontResponse.reduction;known=online&&a.fresh&&(v.some(Number.isFinite)||unloaded.some(Boolean));const label=i=>unloaded[i]?'卸载':Number.isFinite(v[i])?Math.round(v[i]*100)+'%':'—';summary='前 '+label(0)+' / 后 '+label(1)+(a.frontResponse?.evidenceExpired?' · 观测过期':'');active=known;}
   else if(id==='handling'){known=online&&a.fresh;summary=known?a.handling?.label||'无响应提示':'响应状态 —';active=known&&!!a.handling?.state;}
   else if(id==='decel'){known=online&&a.fresh&&Number.isFinite(a.decel);summary=known?a.decel.toFixed(2)+' g':'减速度 —';active=known;}
   else if(id==='handbrake'){known=online&&Number.isFinite(s.handbrake);summary=known?'手刹 '+Math.round(s.handbrake)+'%':'手刹 —';active=known&&s.handbrake>.5;}
   else if(id==='statuses'){const statuses={...g.statuses},fields=[['absActive','ABS'],['tcActive','TC'],['escActive','ESC'],['waterTempWarning','水温'],['oilPressureWarning','油压'],['fuelPressureWarning','油路'],['engineStalled','熄火'],['pitLimiterActive','限速']];for(const key of ['absActive','tcActive','escActive'])if(online&&now<(latches[key]||0))statuses[key]=true;known=online&&g.available===true&&g.paused!==true&&g.inMenu!==true&&(fields.some(([key])=>typeof statuses[key]==='boolean')||Number.isInteger(statuses.trackSurface));const labels=fields.filter(([key])=>statuses[key]===true).map(([,label])=>label);if(statuses.trackSurface===0)labels.push('离轨');summary=known?labels.slice(0,3).join(' / ')||'暂无触发':'辅助状态 —';active=known&&labels.length>0;}
   else if(id==='gBall'){known=online&&!!ball?.current;summary=known?'横 '+ball.current.lateral.toFixed(2)+' / 纵 '+ball.current.longitudinal.toFixed(2)+' g':'G —';active=known;}
   else if(id==='flags'){known=online&&!waiting&&g.available===true&&g.paused!==true&&g.inMenu!==true&&g.source==='iRacing-SDK'&&Number.isInteger(g.statuses?.sessionFlags);summary=known?(g.statuses.sessionFlags?'有旗语信号':'无旗语信号'):'旗语 —';active=known&&g.statuses.sessionFlags!==0;}
   else if(id==='dashboard'){known=online&&g.available===true;summary=known?(Number.isFinite(g.speedKmh)?Math.round(g.speedKmh):'—')+' km/h · '+(Number.isFinite(g.rpm)?Math.round(g.rpm):'—')+' RPM':'仪表 —';active=known;}
   return {contract:'hud-display.v1',status:known?'available':'unavailable',signal:active?'active':'neutral',summary,observedAt:sampleAt,validUntil:sampleAt+1000,eventId:id+':'+(active?'active':'neutral'),reason:known?null:'no-current-data'};
  }

  for(const [id,label,note]of components){R.register('component',{id,label,version:'1.0.0',contract:'hud-display.v1',defaultLabels:{algorithm:'默认',presentation:'默认',animation:'默认'},defaults:{algorithm:'host.'+id.toLowerCase(),presentation:'hud.standard',animation:'hud.motion.none',theme:'hud.palette.standard'}});
   R.register('algorithm',{id:'host.'+id.toLowerCase(),label:'默认',description:note,version:'1.0.0',contract:'hud-display.v1',components:[id],execution:'host',fixed:true,requires:[],provides:['signal','duration','event','host-renderer'],create:()=>({update:input=>hostSemantic(id,input)})});
  }
  R.register('theme',{id:'hud.palette.standard',version:'1.0.0',label:'标准',family:'standard',contract:'hud-display.v1',tokens:{mode:'standard'}});
  for(const id of ['none','pulse','sweep'])R.register('animation',{id:'hud.motion.'+id,version:'1.0.0',label:'默认',description:'随数据即时更新。',fixed:true,...(id==='none'?{}:{deprecated:true,replacement:'hud.motion.none'}),contract:'hud-display.v1',requires:['signal','duration'],create:()=>({sample:()=>({opacity:1,glow:0,nextAt:null})})});
  for(const [id,label]of [['standard','默认'],['framed','仪表实底'],['labelled','带读数标注']])R.register('presentation',{id:'hud.'+id,version:'1.0.0',label,description:id==='standard'?'':id==='framed'?'为读数增加实色背景，保留原数值与单位。':'显示相关读数、轮位或状态名称。',contract:'hud-display.v1',requires:['host-renderer'],draw:context=>context.paintNative(id)});
  R.markBaseline();return R;
 }
 function responseTag({ctx,geometry:g,semantic,tokens,selection}){
  if(semantic.status!=='available')return;const label={'response-increasing':'响应↑','response-decreasing':'响应↓','response-plateau':'响应＝','sustained-slip':'持续滑移!'}[semantic.signal];if(!label)return;
  const y=g.y+g.h+68;ctx.save();ctx.font='600 19px "Microsoft YaHei UI",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  if(selection?.assistance==='contrast'){const w=ctx.measureText(label).width+8;ctx.fillStyle='#000000';ctx.fillRect(g.x-w/2,y-12,w,24);}
  ctx.lineWidth=3;ctx.strokeStyle='#101820';ctx.strokeText(label,g.x,y);ctx.fillStyle=selection?.assistance==='contrast'?'#ffffff':tokens.text||'#f4f1e8';ctx.fillText(label,g.x,y);ctx.restore();
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={install,responseTag};else {root.ComponentBuiltins={install,responseTag};install(root.ComponentRuntime,root.PedalTraction);}
})(globalThis);
