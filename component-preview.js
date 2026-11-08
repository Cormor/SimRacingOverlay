'use strict';
(function(root){
 const copy=value=>structuredClone(value);
 function createFactory({getLive,buildScene,paint,selection}){
  let cached=null,epoch=0,demo=null,liveDashboard=null,controllers=0;const diagnostics={controllers:0,draws:0,samples:0,last:null};
  function destroyDemo(){demo?.model.dispose?.();demo=null;cached=null;}
  function demoState(at,packet,component){
   const phase=at/1200,within=at%2400,stage=Math.floor(within/600),progress=(within%600)/600,braking=component==='brake'||component==='decel';
   const handbrake=component==='handbrake'?30+15*Math.sin(at/550):0,input=component==='handbrake'?0:.55+.025*Math.sin(at/700),gas=braking?0:input,brake=braking?input:0;
   const steer=component==='handling'?.12+.01*Math.sin(at/900):.13*Math.sin(phase),speed=26+3*Math.sin(at/1600);
   const ratio=(braking?-1:1)*(stage===0?.06+.18*progress:stage===1?.24+.18*progress:stage===2?.25+.2*progress:.75),force=stage===0?500+500*progress:stage===1?1000-600*progress:stage===2?450:null;

   return {connected:true,angle:steer*180/Math.PI*12,throttle:gas*100,brake:brake*100,handbrake,buttons:Math.sin(phase)>.2?[17,26]:[],leds:{available:false},game:{available:true,source:'iRacing-SDK',carModel:'演示输入',vehicleIdentity:'component-preview',streamEpoch:'preview-'+epoch+'-'+component,packet,sampleTime:at,paused:false,inMenu:false,gear:3,rpm:4200+1800*Math.sin(at/1000),maxRpm:7500,rpmPercent:65+20*Math.sin(at/1000),speedKmh:speed*3.6,gas,brake,clutch:0,roadWheelAngle:steer,wheelbase:2.6,localVelocity:[component==='handling'?0:2*Math.sin(phase),0,speed],velocity:[7*Math.sin(phase),0,speed],yawRate:component==='handling'?(speed/2.6*Math.tan(steer))*(.3+.08*Math.sin(at/700)):steer*speed/2.6,accGFrame:'body',accG:[.7*Math.sin(phase),0,-.4*Math.cos(at/1600)],roadBasis:{forward:[0,0,1],right:[1,0,0]},capabilities:{forces:true,loads:true,slipRatio:true,longitudinalForceConvention:'wheel-forward-positive'},statuses:{absActive:braking||component==='statuses'&&Math.floor(at/900)%3===0,tcActive:component==='statuses'?Math.floor(at/900)%3===1:!braking&&Math.sin(phase)>.5,escActive:component==='statuses'&&Math.floor(at/900)%3===2,sessionFlags:[0x8,0x20,0x4,0x1][Math.floor(at/2000)%4]},wheels:Array.from({length:4},(_,i)=>({load:3200+200*Math.sin(phase+i),fx:force===null?null:(braking?-1:1)*force,fy:1500*Math.sin(phase+i*.08),ratio:ratio*(1+i*.05),angle:.09*Math.sin(phase+i*.2),omega:speed/.32,speedMs:speed,contact:true,grounded:true,contactPoint:[i%2?.8:-.8,0,i<2?1.3:-1.3],contactNormal:[0,1,0],contactHeading:[Math.sin(steer),0,Math.cos(steer)],surface:'sealed'}))}};
  }
  function sample(time,source,component){
   const tick=Math.floor(Math.max(0,time)*30/1000),key=epoch+':'+source+':'+component+':'+tick;if(cached?.key===key)return cached;
   const live=source==='auto'?getLive():null;
   if(live?.input.online&&live.input.state.game?.available){const input=copy(live.input),history=copy(live.history);cached={key,input,history,source:'live',label:'实际遥测 · 同一输入快照',sampleId:'live:'+input.state.game.packet+':'+input.sampleAt};}
   else{
    const targetTick=30+tick,target=targetTick*(1000/30);
    if(!demo||demo.component!==component||targetTick<demo.tick){destroyDemo();demo={component,model:new root.DrivingAssist.Model({componentSelection:selection}),ball:new root.GBall.Model(null),dashboard:root.DashRenderer.createRenderer(),tick:Math.max(0,targetTick-12),packet:0,history:[]};}
    const step=at=>{const state=demoState(at,++demo.packet,component),assist=demo.model.update(state,at),ball=demo.ball.update(state.game,at),input=copy({state,assist,ball,now:at,online:true,sampleAt:at,locks:[{},{},{},{}],latches:{}});demo.history.push(input);while(demo.history.length>48||demo.history.length>1&&at-demo.history[0].now>1000)demo.history.shift();demo.input=input;};
    if(!demo.input)step(demo.tick*(1000/30));
    // Keep the same 30Hz input history independent of which comparison side draws.
    for(let at=demo.tick+1;at<=targetTick;at++)step(at*(1000/30));demo.tick=targetTick;
    cached={key,input:copy(demo.input),history:copy(demo.history),source:'demo',label:'演示输入 · 不写入实际遥测',sampleId:'demo:'+epoch+':'+component+':'+target,dashboard:demo.dashboard};
   }
   cached.scene=buildScene(cached.input,{dashboard:cached.dashboard||(liveDashboard||=root.DashRenderer.createRenderer()),sampleId:cached.sampleId});cached.input=cached.scene.input;diagnostics.samples++;return cached;
  }
  function createController(){let renderer=null,signature=null,algorithmSignature=null,lastSample=null,lastComponent=null,disposed=false;controllers++;diagnostics.controllers=controllers;
   return {reset(){renderer?.dispose();renderer=null;signature=algorithmSignature=lastSample=lastComponent=null;epoch++;destroyDemo();},dispose(){if(disposed)return;disposed=true;renderer?.dispose();renderer=null;controllers--;diagnostics.controllers=controllers;if(!controllers){destroyDemo();liveDashboard=null;}},draw(ctx,{component,selection:draft,time=0,width,height,source='auto'}){
    if(disposed)return {ok:false,error:'预览已释放'};
    try{const current=sample(time,source,component),chosen={...selection,[component]:draft},signatureNext=JSON.stringify(chosen),algorithms=JSON.stringify(Object.entries(chosen).map(([id,s])=>[id,s.algorithm])),reduced=root.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
     if(!renderer||lastComponent!==component||algorithms!==algorithmSignature){renderer?.dispose();renderer=new root.ComponentRenderer.Renderer(chosen,{preview:true});for(const input of current.history)renderer.prepare(input,false);renderer.prepare(current.input,reduced);algorithmSignature=algorithms;lastSample=current.sampleId;lastComponent=component;}
     else if(signatureNext!==signature)renderer.reconfigure(chosen);
     signature=signatureNext;
     if(lastSample!==current.sampleId){renderer.prepare(current.input,reduced);lastSample=current.sampleId;}
     else renderer.frames=renderer.presenter.prepare(Object.fromEntries(Object.entries(renderer.frames).map(([id,f])=>[id,f.semantic])),current.input.now,reduced);
     const job=current.scene.rawGroups.find(j=>j.id===component);if(!job)throw Error('当前组件没有可绘制内容');
     paint(ctx,{job,renderer,input:current.input,width,height});diagnostics.draws++;diagnostics.last={component,time,source:current.source,sampleId:current.sampleId};return {ok:true,source:current.source,label:current.label,sampleId:current.sampleId};
    }catch(error){return {ok:false,error:error.message,source:'demo',label:'预览未完成'};}
   }};
  }
  createController.diagnostics=()=>({...diagnostics,last:diagnostics.last&&{...diagnostics.last}});return createController;
 }
 root.ComponentPreview={createFactory};
})(globalThis);
