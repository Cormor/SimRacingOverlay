'use strict';
// Remaining combined tyre force, normalized to the same axle at rest. Never writes controls.
(function(root){
 const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),finite=Number.isFinite;
 class Reserve {
  constructor(){this.reference=[null,null];this.filtered={};this.previous=null;}
  snapshot(){return {reference:this.reference};}
  restore(s){if(Array.isArray(s?.reference)&&s.reference.length===2)this.reference=s.reference.map(a=>Array.isArray(a)&&a.length===2&&a.every(v=>finite(v)&&v>100&&v<50000)?a:null);}
  update(s,now,unloaded,loadKnown,models){
   const g=s.game,speed=Math.abs(g.speedKmh||0)/3.6,dt=this.previous===null?20:clamp(now-this.previous,1,100);this.previous=now;
   const total=g.wheels.reduce((a,w)=>a+(finite(w.load)?Math.max(0,w.load):0),0),axles={};
   for(let axle=0;axle<2;axle++){
    const start=axle*2,ws=g.wheels.slice(start,start+2),ground=ws.map((w,j)=>!unloaded[start+j]&&(!loadKnown||w.load>=40)),supported=ground.filter(Boolean).length;
    const measured=loadKnown&&ws.every(w=>finite(w.load)&&w.load>=0),axleLoad=measured?ws.reduce((a,w)=>a+w.load,0):null;
    let ref=this.reference[axle];
    // Near-rest balanced contacts provide the reference. Do not learn one-wheel load transfer as the new 100%.
    const balanced=measured&&supported===2&&Math.min(...ws.map(w=>w.load))>axleLoad*.2;
    if(balanced&&speed<.5&&axleLoad>300){
     ref=ref?ref.map((v,j)=>v+(ws[j].load-v)*(1-Math.exp(-dt/2000))):ws.map(w=>w.load);this.reference[axle]=ref;
    }else if(!ref&&measured&&axleLoad>300){
     const sum=balanced?axleLoad:Math.max(axleLoad,total*.5);ref=[sum/2,sum/2];this.reference[axle]=ref;
    }
    const grounded=measured?supported:2;
    let confidence=1,remaining=0,low=0,high=0,base=0,capacity=0,demand=0,methods=[];
    const loadExponent=.90; // Conditional prior, not a universal tyre constant. Interval also evaluates .8..1.
    for(let j=0;j<2;j++){
     const w=ws[j],model=models[start+j]||{},fz=measured?Math.max(0,w.load):1,reference=measured?ref?.[j]||Math.max(150,axleLoad/2):1;
     const force=measured&&fz>40&&finite(w.fx)&&finite(w.fy),fit=model.available&&finite(model.muX)&&finite(model.muY)&&model.muX>.05&&model.muY>.05&&model.muX<6&&model.muY<6;
     const mux=fit?model.muX:.9,muy=fit?model.muY:.9,mu=Math.sqrt(mux*muy),b=mu*reference;
     base+=b;
     if(measured&&(!ground[j]||fz<40))continue;
     const capScale=measured?reference*Math.pow(fz/reference,loadExponent):1,cap=mu*capScale;
     let utilization,uncertainty,method;
     if(force){
      const factor=capScale/fz;
      utilization=Math.hypot(w.fx/(mux*fz*factor),w.fy/(muy*fz*factor));
      if(!fit&&speed>3){
       const longitudinal=finite(w.ratio)?Math.abs(w.ratio)/.18:0,lateral=finite(w.angle)?Math.abs(w.angle)/.20:0;
       utilization=Math.max(utilization,1-Math.exp(-(Math.max(longitudinal,lateral)**2)));
      }
      uncertainty=fit?clamp(1-(model.confidence||0),.12,.65):.65;method=fit?'force-model':'force-prior';
     }else{
      // Feedback slip/lock are normalized EFFECT levels, not physical slip angles or friction coefficients.
      const k=finite(w.ratio)?Math.abs(w.ratio):null,a=finite(w.angle)?Math.abs(w.angle):null;
      const slip=finite(w.slipFeedback)?clamp(w.slipFeedback):null,lock=finite(w.lockFeedback)?clamp(w.lockFeedback):null;
      const known=k!==null||a!==null||slip!==null||lock!==null;
      utilization=Math.max(k===null?0:clamp(k/.22),a===null?0:clamp(a/.20),slip??0,lock??0);
      uncertainty=known?.7:1;method=known?'slip-proxy':'input-only';
     }
     // Full lock or gross driven spin consumes the force budget even if post-peak measured force has fallen.
     if(speed>3&&finite(w.ratio)&&Math.abs(w.ratio)>.65)utilization=1;
     if(speed>3&&finite(w.lockFeedback)&&w.lockFeedback>.98)utilization=1;
     if(speed<.5)utilization=0; // Requested rest convention, not a claim that static friction was measured.
     // A measured post-peak loss is not newly available grip just because force fell.
     if(speed>3&&(model.localResponse?.pastPeak||model.longitudinalLocalResponse?.pastPeak))utilization=Math.max(1,utilization);
     const margin=clamp(1-utilization);let lo=clamp(1-utilization*(1+uncertainty*1.8)),hi=clamp(1-utilization/(1+uncertainty*2));
     if(force&&fit){
      const scale=capScale/fz,mxl=model.muXLow,myl=model.muYLow,mxh=model.muXHigh,myh=model.muYHigh;
      if([mxl,myl].every(v=>finite(v)&&v>.01))lo=Math.min(lo,clamp(1-Math.hypot(w.fx/(mxl*fz*scale),w.fy/(myl*fz*scale))));
      if([mxh,myh].every(v=>finite(v)&&v>.01))hi=Math.max(hi,clamp(1-Math.hypot(w.fx/(mxh*fz*scale),w.fy/(myh*fz*scale))));
     }
     remaining+=cap*margin;low+=cap*lo;high+=cap*hi;capacity+=cap;demand+=cap*Math.min(1,utilization);methods.push(method);
     const c=method==='force-model'?model.confidence||.2:method==='force-prior'?.12:method==='slip-proxy'?.08:.02;confidence=Math.min(confidence,c);
     if(method!=='force-model'){low-=cap*lo;high+=cap*(1-hi);}
     if(measured&&supported===1){
      // Broaden load-sensitivity uncertainty instead of imposing a fixed 50% penalty.
      const ratio=fz/reference;low-=Math.abs(reference*Math.pow(ratio,.8)-capScale)*mu;high+=Math.abs(reference*ratio-capScale)*mu;
     }
    }
    const raw=base>0?{value:clamp(remaining/base),low:clamp(low/base),high:clamp(high/base)}:{value:0,low:0,high:0};
    if(measured&&grounded===0)Object.assign(raw,{value:0,low:0,high:0});
    if(speed<.5&&grounded===2)Object.assign(raw,{value:1,low:measured?1:0,high:1});
    // Safety-critical endpoints are not hidden by display smoothing.
    const prev=this.filtered[axle],hard=raw.value<.005||(speed<.5&&grounded===2)||grounded===0;
    const smooth=k=>!prev||hard?raw[k]:prev[k]+(raw[k]-prev[k])*(1-Math.exp(-dt/(raw[k]<prev[k]?150:550)));
    const reserve={value:smooth('value'),low:smooth('low'),high:smooth('high')};reserve.low=Math.min(reserve.low,reserve.value);reserve.high=Math.max(reserve.high,reserve.value);this.filtered[axle]=reserve;
    axles[axle===0?'front':'rear']={available:true,reserve,rawReserve:raw,confidence:grounded===0||measured&&speed<.5&&grounded===2?1:confidence,
     support:grounded/2,unloadedSides:measured?ground.map(v=>!v):[false,false],loadKnown:measured,
     referenceLoads:ref,capacity,baselineCapacity:base,demand,methods,loadExponent,
     reason:grounded===0?'unloaded':speed<.5?'low-speed':grounded===1?'single-wheel':methods.includes('input-only')?'input-only':methods.includes('slip-proxy')?'slip-proxy':'estimated'};
   }
   return axles;
  }
 }
 const api={Reserve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GripReserve=api;
})(typeof window!=='undefined'?window:globalThis);
