'use strict';
// Observed force response under comparable inputs, not a tyre peak estimate.
(function(root){
 const finite=Number.isFinite;
 const HISTORY_MS=240,EDGE_MS=55;
 const mean=(rows,key)=>rows.reduce((total,row)=>total+row[key],0)/rows.length;

 function sample(g,unloaded,direction,time,input){
  let mask=0,slip=0,force=0,load=0,sideSlip=0,complete=true;
  for(let i=0;i<4;i++){
   const w=g.wheels[i];
   if(unloaded[i]||w.contact===false||w.grounded===false)continue;
   mask|=1<<i;
   if(finite(w.ratio)&&finite(w.load)&&w.load>=400)slip=Math.max(slip,direction*w.ratio);
   if(!finite(w.fx)||!finite(w.load)||w.load<=0||!finite(w.angle)){complete=false;continue;}
   force+=direction*w.fx;
   load+=w.load;
   sideSlip+=Math.abs(w.angle)*w.load;
  }
  return {time,input,mask,slip,force,load,sideSlip:load>0?sideSlip/load:0,
   comparable:complete&&load>0,mu:load>0?force/load:0};
 }

 function forceResponse(rows){
  const first=rows[0],last=rows.at(-1);
  if(last.time-first.time<150)return null;
  const early=rows.filter(row=>row.time-first.time<=EDGE_MS);
  const late=rows.filter(row=>last.time-row.time<=EDGE_MS);
  if(early.length<2||late.length<2||!rows.every(row=>row.comparable))return null;
  const fromSlip=mean(early,'slip'),toSlip=mean(late,'slip');
  if(toSlip<.06||toSlip-fromSlip<.018||mean(late,'input')<mean(early,'input')-.04)return null;
  const loadFrom=mean(early,'load');
  if(Math.abs(mean(late,'load')-loadFrom)>.15*loadFrom||Math.abs(mean(late,'sideSlip')-mean(early,'sideSlip'))>.035)return null;
  const forceFrom=mean(early,'force'),forceTo=mean(late,'force');
  if(forceFrom<100)return null;
  const muFrom=mean(early,'mu'),deltaMu=mean(late,'mu')-muFrom,deltaForce=forceTo-forceFrom;
  const forceBand=Math.max(50,.06*forceFrom),muBand=Math.max(.012,.06*muFrom);
  if(deltaForce>forceBand&&deltaMu>muBand)return 'green';
  if(deltaForce< -forceBand&&deltaMu< -muBand)return 'red';
  if(toSlip>=.10&&Math.abs(deltaForce)<=forceBand&&Math.abs(deltaMu)<=muBand)return 'yellow';
  return null;
 }

 class Observer {
  constructor({severeSlip=true}={}){this.severeSlip=severeSlip;this.reset();}
  reset(){this.rows=[];this.key=null;this.highSince=null;this.result=null;}
  update(s,unloaded,now){
   const g=s.game,time=g.sampleTime;
   const drive=g.gas>=.10&&finite(g.brake)&&g.brake<.05;
   const brake=g.brake>=.10&&finite(g.gas)&&g.gas<.05;
   const normalizedForce=g.capabilities?.longitudinalForceConvention==='wheel-forward-positive';
   // The force/slip sign pairing for this shared-memory adapter was checked on two ACR recordings.
   const observedACR=g.source==='acpmf_physics'&&g.capabilities?.forces===true&&g.capabilities?.slipRatio===true;
   if((!drive&&!brake)||(!normalizedForce&&!observedACR)||!finite(time)||!finite(now)||
     !Number.isInteger(g.gear)||g.gear<=0||g.speedKmh<12||g.localVelocity?.[2]<0||s.handbrake>1){
    this.reset();return null;
   }
   const row=sample(g,unloaded,drive?1:-1,time,drive?g.gas:g.brake);
   const key=JSON.stringify([g.source,g.carModel,g.vehicleIdentity,g.streamEpoch,g.gear,drive,row.mask]);
   const prior=this.rows.at(-1);
   if(key!==this.key||prior&&(time<prior.time||time-prior.time>HISTORY_MS)){this.reset();this.key=key;}
   else if(prior&&time===prior.time)return this.result;
   this.rows=this.rows.filter(old=>time-old.time<=HISTORY_MS).slice(-63);
   this.rows.push(row);
   const highSlip=row.slip>=(drive?.45:.65);
   this.highSince=highSlip?this.highSince??time:null;
   // A severe-slip symptom can raise yellow on its own, never red.
   const response=forceResponse(this.rows);
   const state=response??(this.severeSlip&&this.highSince!==null&&time-this.highSince>=80?'yellow':null);
   this.result=state?{pedal:drive?'drive':'brake',state,observedAt:now,evidence:response?'force-response':'sustained-slip'}:null;
   return this.result;
  }
 }
 const api={Observer};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.PedalTraction=api;
})(typeof globalThis!=='undefined'?globalThis:this);
