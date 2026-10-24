'use strict';
// Optional telemetry is evidence, not an assertion that the game supports a field.
(function(root){
 const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const number=(v,a,b)=>finite(v)&&v>=a&&v<=b?v:null;
 const vector=(v,b)=>Array.isArray(v)&&v.length===3&&v.every(x=>number(x,-b,b)!==null)?v.slice():null;
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
 const unit=v=>Math.hypot(...v)>1e-6?v.map(x=>x/Math.hypot(...v)):null;
 function roadBasis(g){
  const reported=g.roadBasis;
  if(reported&&vector(reported.forward,1.1)&&vector(reported.right,1.1)){
   const forward=unit(reported.forward),right=forward&&unit(sub(reported.right,forward.map(x=>x*dot(reported.right,forward))));
   if(forward&&right)return {forward,right};
  }
  const w=g.wheels;if(!Array.isArray(w)||w.length!==4||w.some(x=>!vector(x.contactPoint,1e7)||!vector(x.contactNormal,1.1)))return null;
  const n=unit(w.reduce((s,x)=>s.map((v,i)=>v+x.contactNormal[i]),[0,0,0]));if(!n)return null;
  const project=v=>sub(v,n.map(x=>x*dot(v,n)));
  const forward=unit(project(w[0].contactPoint.map((v,i)=>v+w[1].contactPoint[i]-w[2].contactPoint[i]-w[3].contactPoint[i])));
  if(!forward)return null;
  const track=project(w[1].contactPoint.map((v,i)=>v+w[3].contactPoint[i]-w[0].contactPoint[i]-w[2].contactPoint[i]));
  const right=unit(sub(track,forward.map(x=>x*dot(track,forward))));return right?{forward,right}:null;
 }
 function sanitize(s){
  if(!s||typeof s!=='object'||!s.game||typeof s.game!=='object')return {...s,game:{available:false}};
  const src=s.game;
  if(!Array.isArray(src.wheels)||src.wheels.length!==4||src.wheels.some(w=>!w||typeof w!=='object'))return {...s,game:{available:false}};
  const g={...src};
  for(const [k,lo,hi] of [['speedKmh',0,650],['gas',0,1],['brake',0,1],['clutch',0,1],['sampleTime',0,1e15],['roadWheelAngle',-Math.PI/2,Math.PI/2],['wheelbase',1,5]])g[k]=number(src[k],lo,hi);
  for(const [k,lo,hi] of [['yawRate',-30,30],['steeringWheelAngle',-20,20],['steeringShaftTorqueNm',-200,200],['pitchRate',-30,30],['rollRate',-30,30]])g[k]=number(src[k],lo,hi);
  for(const [k,b] of [['velocity',250],['localVelocity',250],['angularVelocity',100],['accG',30]])g[k]=vector(src[k],b);
  g.wheels=src.wheels.map(w=>{
   const n={...w};
   for(const [k,lo,hi] of [['load',0,100000],['fx',-200000,200000],['fy',-200000,200000],['mz',-100000,100000],['angle',-Math.PI,Math.PI],['ratio',-100,1000],['omega',-5000,5000],['speedMs',-400,400],['pressurePsi',.1,150],['temperatureRaw',1,600],['temperatureC',-80,250],['camberRaw',-1.6,1.6],['suspensionTravelRaw',-1,2],['slipFeedback',-100,100],['lockFeedback',0,100]])n[k]=number(w[k],lo,hi);
   for(const [k,b] of [['contactPoint',1e7],['contactNormal',1.1],['contactHeading',1.1]])n[k]=vector(w[k],b);
   // A false or absent grass flag is not affirmative evidence of a sealed road.
   n.surface=typeof w.surface==='string'&&w.surface.length<40?w.surface:w.onLooseSurface===true?'loose':null;
   return n;
  });
  if(g.speedKmh===null)g.available=false;
  if(g.speedKmh===0&&src.rpm===0&&g.wheels.every(w=>w.load===0&&w.fx===0&&w.fy===0&&w.contactPoint?.every(v=>v===0)&&w.contactHeading?.every(v=>v===0))){g.available=false;g.reason='empty-physics-state';}
  return {...s,game:g};
 }
 function condition(w){return {surface:w.surface||null,pressure:w.pressurePsi??null,temp:w.temperatureC??w.temperatureRaw??null,tempKind:finite(w.temperatureC)?'C':'raw',camber:w.camberRaw??null};}
 function compatible(a,b){
  if(!a||!b)return false;
  if(a.surface&&b.surface&&a.surface!==b.surface)return false;
  if(finite(a.pressure)&&finite(b.pressure)&&Math.abs(a.pressure-b.pressure)>Math.max(1.5,Math.max(a.pressure,b.pressure)*.12))return false;
  if(a.tempKind===b.tempKind&&finite(a.temp)&&finite(b.temp)&&Math.abs(a.temp-b.temp)>18)return false;
  if(finite(a.camber)&&finite(b.camber)&&Math.abs(a.camber-b.camber)>.05)return false;
  return true; // Similar conditions are necessary, not sufficient, for peer pooling.
 }
 function anchor(a,b){
  if(!a||!compatible(a,b))return {...b};
  const next={...a};for(const key of ['surface','pressure','temp','camber'])if(next[key]===null||next[key]===undefined)next[key]=b[key];
  if(a.temp===null||a.temp===undefined)next.tempKind=b.tempKind;
  return next;
 }
 class Context {
  constructor(){this.reset();}
  reset(){this.history=[];this.last=null;this.lastSample=-Infinity;this.lastFit=-Infinity;this.gFit=null;this.suspendUntil=-Infinity;this.states=Array.from({length:4},()=>({epoch:0,condition:null}));}
  update(g,now){
   const prev=this.last,dt=prev?(now-prev.now)/1000:0,validDt=dt>0&&dt<=.25;
   if(prev&&!validDt){this.history=[];this.gFit=null;}
   let impulse=false,shift=false;
   if(validDt){
    shift=finite(g.gear)&&finite(prev.gear)&&g.gear!==prev.gear;
    const loadJump=g.wheels.some((w,i)=>finite(w.load)&&finite(prev.loads[i])&&Math.abs(w.load-prev.loads[i])/Math.max(300,w.load,prev.loads[i])>.35);
    const gJump=g.accG&&prev.accG?Math.hypot(...sub(g.accG,prev.accG))/dt:0;
    impulse=loadJump&&gJump>25;
   }
   if(impulse||shift)this.suspendUntil=now+(impulse?220:180);
   const states=g.wheels.map((w,i)=>{
    const st=this.states[i],c=condition(w),changed=st.condition&&!compatible(st.condition,c);
    if(changed)st.epoch++;
    st.condition=anchor(st.condition,c);
    return {epoch:st.epoch,changed:!!changed,condition:c};
   });
   let acceleration=null;
   if(now-this.lastSample>=35){
    this.lastSample=now;this.history.push({time:now,velocity:g.velocity,accG:g.accG,speed:g.speedKmh});
    this.history=this.history.filter(x=>now-x.time<=6500).slice(-192);
    const anchor=this.history.find(x=>now-x.time<=160),span=anchor?(now-anchor.time)/1000:0;
    if(span>=.08&&g.velocity&&anchor.velocity){
     const direction=unit(g.velocity);
     if(direction)acceleration=dot(sub(g.velocity,anchor.velocity),direction)/span/9.80665;
    }
    this.history.at(-1).longG=finite(acceleration)&&Math.abs(acceleration)<10?acceleration:null;
   }
   // Calibrate only a recent scalar relationship. This does NOT certify gravity semantics,
   // identify mass/aero, or treat the game's G field as an independent tyre-force truth.
   if(now-this.lastFit>=400){this.lastFit=now;this.fit(now);}
   const fit=this.gFit&&now-this.gFit.time<2500?this.gFit:null;
   let disagreement=null;
   if(fit&&g.accG&&acceleration!==null){
    const old=this.history.filter(h=>h.time<=now-fit.lag).at(-1);
    if(old?.accG)disagreement=Math.abs(acceleration-(old.accG[fit.axis]*fit.scale+fit.bias));
   }
   this.last={now,gear:g.gear,loads:g.wheels.map(w=>w.load),accG:g.accG};
   return {states,learningAllowed:now>=this.suspendUntil,actionAllowed:now>=this.suspendUntil&&finite(g.gas)&&finite(g.brake),
    reason:impulse?'impact':shift?'gear-change':now<this.suspendUntil?'settling':'ready',
    g:{available:!!g.accG,calibration:fit,observedLongG:acceleration,disagreement,
     interpretation:'recent longitudinal agreement only; not a friction limit or gravity certification'}};
  }
  fit(now){
   const candidates=[];
   for(let axis=0;axis<3;axis++)for(const lag of [0,40,80,120,160]){
    let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;const pairs=[];
    for(let i=0;i<this.history.length;i++){
     const p=this.history[i];if(!finite(p.longG))continue;
     let j=i;while(j>=0&&this.history[j].time>p.time-lag)j--;
     const h=this.history[j];if(!h?.accG||p.time-lag-h.time>60)continue;
     const x=h.accG[axis],y=p.longG;pairs.push([x,y]);n++;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
    }
    if(n<35)continue;
    const xx=sxx-sx*sx/n,yy=syy-sy*sy/n,xy=sxy-sx*sy/n;
    if(xx/n<.015||yy/n<.015)continue;
    const scale=xy/xx,bias=(sy-scale*sx)/n,r2=xy*xy/(xx*yy);
    const error=Math.sqrt(pairs.reduce((sum,[x,y])=>sum+(y-scale*x-bias)**2,0)/n);
    if(r2>.82&&Math.abs(scale)>.7&&Math.abs(scale)<1.3&&Math.abs(bias)<.35&&error<.25)candidates.push({axis,lag,scale,bias,r2,error,time:now,samples:n});
   }
   candidates.sort((a,b)=>a.error-b.error);
   const best=candidates[0],other=best&&candidates.find(x=>x.axis!==best.axis);
   if(best&&(!other||other.error>best.error*1.2+.015))this.gFit=best;
  }
 }
 const api={sanitize,roadBasis,condition,compatible,anchor,Context};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TelemetryContext=api;
})(typeof window!=='undefined'?window:globalThis);
