'use strict';
// A bounded local response map. Interpolation only inside observed slip/load/combined-slip conditions.
// This does not infer a complete tyre law or an unseen road's friction peak.
(function(root){
 const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const median=a=>{const v=[...a].sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
 function mapResponse(samples,w,now){
  if(!w||!['load','angle','ratio','fy'].every(k=>finite(w[k]))||w.load<200)return null;
  const t=Math.abs(Math.tan(w.angle)),k=w.ratio,condition=Context.condition(w);
  const rows=samples.filter(p=>now-p.time<=22000&&p.load/w.load>.78&&p.load/w.load<1.28&&
   finite(p.k)&&Math.abs(p.k-k)<=.012+Math.abs(k)*.12&&Context.compatible(p.condition,condition));
  if(rows.length<18)return null;
  const bins=new Map();
  for(const p of rows){const key=Math.floor(Math.log1p(p.t/.01)/.23);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}
  const points=[];
  for(const values of bins.values()){
   const events=new Set(values.map(p=>p.event)).size;
   if(values.length<2||events<2)continue;
   const q=median(values.map(p=>p.q)),spread=median(values.map(p=>Math.abs(p.q-q)));
   if(spread>Math.max(.05,q*.15))continue;
   points.push({t:median(values.map(p=>p.t)),q,spread,events});
  }
  points.sort((a,b)=>a.t-b.t);
  if(points.length<4||t<points[0].t||t>points.at(-1).t*1.04)return null;
  const value=x=>{
   let j=1;while(j<points.length-1&&points[j].t<x)j++;
   const a=points[j-1],b=points[j],f=clamp((x-a.t)/(b.t-a.t),0,1);
   return {q:a.q+(b.q-a.q)*f,slope:(b.q-a.q)/(b.t-a.t),j};
  };
  const current=value(t),actual=Math.abs(w.fy)/w.load;
  if(Math.abs(current.q-actual)>Math.max(.08,actual*.18))return null;
  const peak=points.reduce((a,b)=>a.q>b.q?a:b),before=points.filter(p=>p.t<peak.t),after=points.filter(p=>p.t>peak.t);
  const postPeak=before.length>=2&&after.length>=2&&after.at(-1).q<peak.q*.94;
  const tail=points.slice(-3),plateau=tail.length===3&&tail[2].t-tail[0].t>.018&&Math.max(...tail.map(p=>p.q))-Math.min(...tail.map(p=>p.q))<Math.max(.025,peak.q*.035);
  // Never interpolate an action through an unobserved large gap in slip.
  const covered=points.every((p,i)=>!i||p.t-points[i-1].t<=Math.max(.025,p.t*.35));
  let keep=t;
  // Retaining an observed force is a local interpolation question, not proof of an unseen peak.
  // A productive linear curve yields ~3% reduction and therefore no action fraction.
  if(covered){
   const target=Math.max(current.q,actual)*.97;
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(a.t>=t)break;
    if(a.q<=target&&b.q>=target&&b.q>a.q){const candidate=a.t+(b.t-a.t)*(target-a.q)/(b.q-a.q);if(candidate<=t){keep=candidate;break;}}
   }
  }
  const confidence=Math.min(.85,Math.sqrt(clamp(rows.length/100,0,1)),Math.min(...points.map(p=>p.events))/3);
  return {method:'observed-local-response',confidence,current:current.q,slope:current.slope,peak:peak.q,peakT:peak.t,postPeak,plateau,covered,retentionSupported:covered&&keep<t*.90,
   retainAngle:Math.atan(keep),reduction:Math.max(0,Math.abs(w.angle)-Math.atan(keep)),
   fraction:Math.abs(w.angle)>.001?clamp(1-Math.atan(keep)/Math.abs(w.angle)-.035,0,1):0,
   pastPeak:postPeak&&t>peak.t,currentSlip:t,samples:rows.length,bins:points.length,minSlip:points[0].t,maxSlip:points.at(-1).t,
   capacityKnown:(postPeak||plateau)&&covered&&Math.abs(k)<.02};
 }
 const api={mapResponse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TyreResponse=api;
})(typeof window!=='undefined'?window:globalThis);
