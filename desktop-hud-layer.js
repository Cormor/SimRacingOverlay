'use strict';

const path=require('node:path');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');

function createHudLayer(win,root,reportError){
 let visible=false,generation=0,watcher=null,started=false,disposed=false;
 function raise(){
  if(visible&&!disposed&&!win.isDestroyed()&&win.isVisible())win.moveTop();
 }
 function watch(){
  if(started||process.platform!=='win32')return;
  started=true;
  const handle=win.getNativeWindowHandle().readBigUInt64LE().toString();
  const child=spawn(path.join(root,'runtime','SimRacingHudLayer.exe'),[String(process.pid),handle],{
   windowsHide:true,stdio:['pipe','pipe','ignore']
  });
  watcher=child;
  child.stdin.on('error',()=>{}); // The process error/exit supplies the diagnostic.
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
   const [request,observedGeneration,action]=line.split(' ');
   try{
    if(Number(observedGeneration)!==generation||!visible||disposed||win.isDestroyed()||!win.isVisible())return;
    if(action==='restore'){
     // Chromium caches the level. Apply it again if the native style was removed.
     win.setAlwaysOnTop(false);
     win.setAlwaysOnTop(true,'screen-saver');
    }
    if(action==='raise'||action==='restore')raise();
   }finally{
    if(child.stdin.writable)child.stdin.write('done '+request+'\n');
   }
  });
  child.on('error',error=>{if(!disposed)reportError(error);});
  child.on('close',(code,signal)=>{
   watcher=null;
   if(!disposed&&(code!==null||signal))reportError(Error('HUD layer observer exited ('+(signal||code)+')'));
  });
 }
 return {
  setVisible(value){
   if(disposed||value===visible)return;
   visible=value;
   generation++;
   win.setAlwaysOnTop(visible,'screen-saver');
   if(visible)watch();
   if(watcher?.stdin.writable)watcher.stdin.write((visible?'on ':'off ')+generation+'\n');
  },
  raise,
  dispose(){
   if(disposed)return;
   disposed=true;
   if(!watcher)return;
   const child=watcher;
   const stopped=new Promise(resolve=>child.once('close',resolve));
   child.stdin.end();
   return stopped;
  }
 };
}

module.exports={createHudLayer};
