'use strict';
importScripts('module-loader.js');
importScripts(...['telemetry-context.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js'].map(SROModules.resolve));
importScripts('component-runtime.js','component-builtins.js');
try{importScripts(...SROModules.componentEntries);}catch(error){SROModules.reportComponentError(error);}
SROModules.finalizeComponents();
let model=null,session=null;
try{if(SROModules.componentError)throw Error(SROModules.componentError);model=new DrivingAssist.Model({componentSelection:SROModules.componentSnapshot.selection});self.postMessage({type:'components-ready',ok:true,componentRevision:SROModules.componentSnapshot.revision});}
catch(error){self.postMessage({type:'components-ready',ok:false,error:String(error.message),componentRevision:SROModules.componentSnapshot.revision});}
self.onmessage=({data})=>{
 const start=performance.now();
 try{
  if(SROModules.componentError)throw Error(SROModules.componentError);
  if(!model||session!==null&&session!==data.session){model?.dispose?.();model=new DrivingAssist.Model({componentSelection:SROModules.componentSnapshot.selection});}session=data.session;
  // data.now is the renderer's receive time. Worker performance.now has a
  // different origin and is used only for this local duration.
  const view=model.update(data.state,data.now);
  self.postMessage({id:data.id,session:data.session,ok:true,view,componentRevision:SROModules.componentSnapshot.revision,costMs:performance.now()-start});
 }catch(error){
  try{model?.dispose?.();}catch{}model=null;session=null;
  self.postMessage({id:data.id,session:data.session,componentRevision:SROModules.componentSnapshot.revision,ok:false,error:{code:'model-error',message:String(error?.message||error).slice(0,256)}});
 }
};
