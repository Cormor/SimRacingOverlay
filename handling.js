'use strict';
(function(root){
 const clamp=v=>Math.max(0,Math.min(1,v));
 class Handling {
  constructor(){this.state=null;this.candidate=null;this.since=0;this.severity=0;this.last=null;}
  update(s,now,a){
   const grip=a.grip,valid=a.fresh&&Math.abs(s.game.speedKmh||0)>10;
   const tendency=grip?.steeringState;
   if(!tendency)return {state:null,label:'',severity:0,action:''};
   const body=grip?.vehicleResponse;
   if(valid&&body?.available){
    const f=body.understeer||0,r=body.oversteer||0,sway=body.sway||0;
    const state=sway>.35?'sway':f>.35&&r>.35?'both':r>.25&&r>=f?'oversteer':f>.25?'understeer':null;
    return {state,label:state==='sway'?'侧摆':state==='both'?'四轮侧滑':state==='oversteer'?'甩尾倾向':state==='understeer'?'推头倾向':'',severity:Math.max(f,r,sway),action:'',source:'observed-vehicle-response'};
   }
   const measured=valid&&Number.isFinite(tendency.front)&&Number.isFinite(tendency.rear);
   const f=measured?tendency.front:0,r=measured?tendency.rear:0,both=Math.min(f,r)>.55;
   const state=both?'both':r>f+.08&&r>.12?'oversteer':f>r+.08&&f>.12?'understeer':null;
   return {state,label:both?'四轮侧滑':state==='oversteer'?'甩尾倾向':state==='understeer'?'推头倾向':'',severity:Math.max(f,r),action:''};
  }
 }
 const api={Handling};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HandlingState=api;
})(typeof window!=='undefined'?window:globalThis);
