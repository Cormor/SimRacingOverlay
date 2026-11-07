'use strict';
importScripts('telemetry-context.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js');
let model=null,session=null;
self.onmessage=({data})=>{
 const start=performance.now();
 try{
  if(!model||session!==data.session){model=new DrivingAssist.Model();session=data.session;}
  // data.now is the renderer's receive time. Worker performance.now has a
  // different origin and is used only for this local duration.
  const view=model.update(data.state,data.now);
  self.postMessage({id:data.id,session:data.session,ok:true,view,costMs:performance.now()-start});
 }catch(error){
  model=null;session=null;
  self.postMessage({id:data.id,session:data.session,ok:false,error:{code:'model-error',message:String(error?.message||error).slice(0,256)}});
 }
};
