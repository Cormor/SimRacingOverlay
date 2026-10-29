const {app,BrowserWindow,screen,ipcMain,globalShortcut,Tray,Menu,nativeImage,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const root=__dirname,config=path.join(root,'runtime','desktop.json'),statusFile=path.join(root,'runtime','desktop-status.json');
app.setPath('userData',path.join(root,'runtime','desktop-profile'));
app.setName('SimRacingOverlay');
const port=(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8')).httpPort||18764;}catch{return 18764;}})();
const wheelStore=require('./wheel-store').createStore({root,catalog:JSON.parse(fs.readFileSync(path.join(root,'assets','wheel-catalog.json'),'utf8')),validate:require('./wheel-profile').validate});
const baseUrl='http://127.0.0.1:'+port+'/';
if(!app.requestSingleInstanceLock()){app.quit();}else{
 let win,last='',timer,resize=null,move=null,tray,applying=false,suppressUntil=0,exiting=false,exitPrepared=false,displayPixels=null,pixelDisplayId=null,displaySyncBusy=false;
 function settings(){try{return JSON.parse(fs.readFileSync(config,'utf8'));}catch{return {visible:false,width:600,x:-1,y:-1,monitor:0,page:1};}}
 function requestedSize(s,d){const width=Math.max(1,Math.min(1600,Math.round(s.width||600),d.bounds.width,Math.floor(d.bounds.height/.85)));return {width,height:Math.round(width*.85)};}
 function selectedDisplay(){const s=settings(),ds=screen.getAllDisplays();return s.monitor>0?ds[Math.min(ds.length-1,s.monitor-1)]:screen.getDisplayNearestPoint(screen.getCursorScreenPoint());}
 function syncDisplays(){if(displaySyncBusy||!win||win.isDestroyed())return;const d=selectedDisplay(),center={x:d.bounds.x+d.bounds.width/2,y:d.bounds.y+d.bounds.height/2},p=screen.dipToScreenPoint?screen.dipToScreenPoint(center):{x:center.x*d.scaleFactor,y:center.y*d.scaleFactor};displaySyncBusy=true;
  execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'src','Sync-Display.ps1'),'-Root',root,'-CenterX',String(p.x),'-CenterY',String(p.y)],{windowsHide:true,timeout:5000,maxBuffer:65536},(err,stdout)=>{displaySyncBusy=false;if(!win||win.isDestroyed())return;
   try{if(err)throw err;const result=JSON.parse(stdout.trim()),p=result.selected;if(!p||![p.width,p.height,p.workWidth,p.workHeight].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid physical display dimensions');fs.writeFileSync(path.join(root,'runtime','display-sync.json'),JSON.stringify(result,null,2));const changed=pixelDisplayId!==d.id||['x','y','width','height','workX','workY','workWidth','workHeight','device'].some(k=>displayPixels?.[k]!==p[k]);displayPixels=p;pixelDisplayId=d.id;if(changed){last='';apply();}}
   catch(e){fs.writeFileSync(path.join(root,'runtime','display-sync-error.txt'),String(e.message));}
  });
 }
 function desktopScene(s,d){const size=requestedSize(s,d),area=d.bounds,p=pixelDisplayId===d.id?displayPixels:null;return {...(s.placement?.mode==='relative'?require('./layout.js').screenStage(area.width,area.height,s.placement):{width:area.width,height:area.height,originX:Number.isFinite(s.x)&&s.x!==-1?s.x:area.width-size.width-24,originY:Number.isFinite(s.y)&&s.y!==-1?s.y:area.height-size.height-24,scale:size.width/1000}),pixelWidth:p?.width||Math.round(area.width*d.scaleFactor),pixelHeight:p?.height||Math.round(area.height*d.scaleFactor),monitorPixelWidth:p?.width||Math.round(d.bounds.width*d.scaleFactor),monitorPixelHeight:p?.height||Math.round(d.bounds.height*d.scaleFactor)};}
 function saveScene(scene){const target=path.join(root,'assets','layout.json');try{const old=JSON.parse(fs.readFileSync(target,'utf8'));if(JSON.stringify(old.stage)===JSON.stringify(scene))return;const value=require('./layout.js').clean({...old,stage:scene});fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2));fs.renameSync(target+'.tmp',target);}catch(err){fs.writeFileSync(path.join(root,'runtime','layout-error.txt'),String(err));}}
 function apply(){if(!win||win.isDestroyed())return;if(move||resize)return;const s=settings();
  if(win.webContents.getURL().includes('&edit=1')&&!s.edit&&!exitPrepared){
   if(!exiting){exiting=true;win.webContents.executeJavaScript('window.overlayEditor?.flushSaveNow() ?? ({ok:true})').then(result=>{if(result?.ok)exitPrepared=true;else{const current=settings();current.edit=true;fs.writeFileSync(config,JSON.stringify(current));}exiting=false;last='';apply();}).catch(()=>{const current=settings();current.edit=true;fs.writeFileSync(config,JSON.stringify(current));exiting=false;last='';});}return;
  }
  const display=selectedDisplay();
  const revision=['wheel-profile.js','ui.css','ui-theme.js','flags.js','legacy-chassis-response.js','component-paint.js','telemetry-worker.js','telemetry-processor.js','overlay.js','assist.js','chassis-response.js','realtime-response.js','grip.js','steering-advisor.js','reserve.js','telemetry-context.js','tyre-response.js','handling.js','dashboard.js','index.html','g-ball.js','layout-preset.js','layout.js','editor.js','paint-context.js'].reduce((sum,file)=>sum+fs.statSync(path.join(root,file)).mtimeMs,0),key=JSON.stringify(s)+revision+JSON.stringify([display.id,display.bounds,display.workArea,display.scaleFactor]);if(key===last)return;last=key;
  const displays=screen.getAllDisplays(),d=s.monitor>0?displays[Math.min(displays.length-1,s.monitor-1)]:screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area=d.bounds,scene=desktopScene(s,d);saveScene(scene);
  applying=true;suppressUntil=Date.now()+500;win.setBounds({...area});
  const actual=win.getBounds();if(actual.width>area.width||actual.height>area.height)win.setBounds({x:area.x,y:area.y,width:Math.max(1,area.width-Math.max(0,actual.width-area.width)),height:Math.max(1,area.height-Math.max(0,actual.height-area.height))});
  applying=false;win.setAlwaysOnTop(true,'screen-saver');win.setIgnoreMouseEvents(!s.edit,{forward:true});win.setResizable(false);win.setFocusable(!!s.edit);
  const url=baseUrl+'?page='+Math.max(1,Math.min(2,s.page||1))+'&edit='+(s.edit?'1':'0')+'&stage='+encodeURIComponent(JSON.stringify(scene))+'&v='+revision;if(win.webContents.getURL()!==url){win.loadURL(url);exitPrepared=false;}
  if(s.visible||s.edit)win.showInactive();else win.hide();
  fs.writeFileSync(statusFile,JSON.stringify({pid:process.pid,visible:win.isVisible(),bounds:win.getBounds(),alwaysOnTop:win.isAlwaysOnTop(),transparent:true,clickThrough:!s.edit,scene,displays:displays.map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}))},null,2));
 }
 app.whenReady().then(()=>{
  win=new BrowserWindow({width:600,height:510,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,thickFrame:false,webPreferences:{preload:path.join(root,'desktop-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  // Full-monitor transparent surface; moving a control never changes native window bounds.

  function writeLayout(input){try{const d=screen.getDisplayMatching(win.getBounds()),value=require('./layout.js').clean({...input,stage:desktopScene(settings(),d)}),target=path.join(root,'assets','layout.json'),temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,target);return {ok:true};}catch(err){return {ok:false,error:String(err.message)};}}
  const canEdit=e=>e.sender===win.webContents&&settings().edit&&win.webContents.getURL().startsWith(baseUrl)&&win.webContents.getURL().includes('&edit=1');
  ipcMain.handle('wheel-list',e=>{if(!canEdit(e))return {ok:false,error:'编辑模式未开启'};try{return {ok:true,faces:wheelStore.list()};}catch(err){return {ok:false,error:err.message};}});
  ipcMain.handle('wheel-download',async(e,id)=>{if(!canEdit(e))return {ok:false,error:'编辑模式未开启'};try{return await wheelStore.install(id);}catch(err){return {ok:false,error:err.message};}});
  ipcMain.handle?.('layout-save',(e,input)=>e.sender===win.webContents&&settings().edit?writeLayout(input):{ok:false,error:'编辑模式未开启'});
  ipcMain.on('layout-save-sync',(e,input)=>{e.returnValue=e.sender===win.webContents&&win.webContents.getURL().includes('&edit=1')?writeLayout(input):{ok:false,error:'非当前编辑页面'};});
  ipcMain.on('edit-finish',e=>{if(e.sender!==win.webContents)return;const s=settings();s.edit=false;fs.writeFileSync(config,JSON.stringify(s));apply();});
  ipcMain.on('move-start',(e,p)=>{if(e.sender===win.webContents&&settings().edit){const s=settings(),scene=desktopScene(s,screen.getDisplayMatching(win.getBounds()));move={...p,originX:scene.originX,originY:scene.originY};}});
  ipcMain.on('move-move',(e,p)=>{if(e.sender!==win.webContents||!move)return;const s=settings();s.x=move.originX+p.x-move.x;s.y=move.originY+p.y-move.y;fs.writeFileSync(config,JSON.stringify(s));const scene=desktopScene(s,screen.getDisplayMatching(win.getBounds()));saveScene(scene);win.webContents.send('scene-change',scene);});
  ipcMain.on('move-end',()=>{move=null;last='';apply();});
  ipcMain.on('resize-start',(e,p)=>{if(e.sender===win.webContents&&settings().edit)resize={...p,width:settings().width};});
  ipcMain.on('resize-move',(e,p)=>{if(e.sender!==win.webContents||!resize)return;const dx=p.x-resize.x,dy=(p.y-resize.y)/.85,delta=Math.abs(dx)>Math.abs(dy)?dx:dy,s=settings();s.width=Math.max(250,Math.min(1600,Math.round(resize.width+delta)));fs.writeFileSync(config,JSON.stringify(s));const scene=desktopScene(s,screen.getDisplayMatching(win.getBounds()));saveScene(scene);win.webContents.send('scene-change',scene);});
  ipcMain.on('resize-end',()=>{resize=null;last='';apply();});
  // Bounded first-run readback. Captures this overlay only, never the desktop.
  win.webContents.on('did-finish-load',()=>setTimeout(async()=>{
   try{const info=await win.webContents.executeJavaScript('JSON.stringify({ui:overlayDiagnostics.getUi(),performance:overlayDiagnostics.getPerformance(),editor:overlayEditor.getStatus(),image:{loaded:image.complete&&image.naturalWidth>0,width:image.naturalWidth,height:image.naturalHeight},dashError:window.DashRenderer?.getError(),canvas:[canvas.width,canvas.height]})');fs.writeFileSync(path.join(root,'runtime','desktop-render-state.json'),info);if(win.isVisible()){const screenshot=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'runtime','desktop-render.png'),screenshot.toPNG());}}
   catch(error){fs.writeFileSync(path.join(root,'runtime','desktop-error.txt'),String(error.message));}
  },2000));
  win.setMenu(null);win.setIgnoreMouseEvents(true,{forward:true});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(baseUrl))event.preventDefault();});
  win.webContents.on('did-fail-load',()=>setTimeout(()=>win.webContents.reload(),1000));
  function toggleEdit(){const s=settings();s.edit=!s.edit;fs.writeFileSync(config,JSON.stringify(s));apply();}
  globalShortcut.register('Control+Alt+M',toggleEdit);
  tray=new Tray(nativeImage.createFromPath(path.join(root,'assets','wheel.svg')).resize({width:24,height:24}));tray.setToolTip('SimRacingOverlay · Ctrl+Alt+M 编辑');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'设备校准与设置',click:()=>shell.openExternal(baseUrl+'setup')},{label:'切换拖动 / 缩放 (Ctrl+Alt+M)',click:toggleEdit},{label:'显示 / 隐藏桌面叠加',click:()=>{const s=settings();s.visible=!s.visible;fs.writeFileSync(config,JSON.stringify(s));apply();}}]));
  // DPI / work-area / topology changes must invalidate settings-only caching. No changes during an ordinary drag.
  const displayChanged=()=>{move=null;resize=null;pixelDisplayId=null;last='';apply();syncDisplays();};
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,displayChanged);
  apply();syncDisplays();timer=setInterval(apply,300);setInterval(syncDisplays,10000);
 });
 app.on('will-quit',()=>globalShortcut.unregisterAll());
 app.on('window-all-closed',()=>{clearInterval(timer);app.quit();});
}
