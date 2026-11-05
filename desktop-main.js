'use strict';
const {app,BrowserWindow,screen,ipcMain,globalShortcut,Tray,Menu,nativeImage,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {createDisplayController}=require('./desktop-display');
const {watchFiles}=require('./desktop-files');
const root=__dirname,config=path.join(root,'runtime','desktop.json'),statusFile=path.join(root,'runtime','desktop-status.json');
app.setPath('userData',path.join(root,'runtime','desktop-profile'));app.setName('SimRacingOverlay');
const port=(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8')).httpPort||18764;}catch{return 18764;}})();
const baseUrl='http://127.0.0.1:'+port+'/',managerUrl=baseUrl+'manager.html';
const {createStore,createElectronRequest}=require('./wheel-store');
const {createDesktopTray}=require('./desktop-tray');
const wheelCatalog=JSON.parse(fs.readFileSync(path.join(root,'assets','wheel-catalog.json'),'utf8'));
const wheelStore=createStore({request:createElectronRequest(net),root,catalog:wheelCatalog,validate:require('./wheel-profile').validate});
if(!app.requestSingleInstanceLock())app.quit();else{
 let win,manager,tray,trayController,timer,displays,loadedRevision=null,closingManager=false,closeBusy=false,managerDisplayId=null;
 let revision=Date.now(),lastScene='',lastBounds='',lastPage=null,lastPresentation=null,lastStatus='',quitting=false;
 let reloadTimer=null,reloadAttempts=0,navigation=0,hudUrl=null,configRetry=null,quitAfterManager=false,closingReference=null;
 const unwatch=[];
 const controlSession=require('node:crypto').randomBytes(16).toString('hex');
 const controlFile=path.join(root,'runtime','desktop-control.json'),controlResult=path.join(root,'runtime','desktop-control-result.json');
 let seenControl=null,shutdownRequest=null,shutdownTimer=null;
 let observedLayout=null,obsStage=null,obsRevision=0,obsStateText=null,obsStateRetry=null;
 const obsStateFile=path.join(root,'runtime','obs-state.json'),pendingPackIds=new Set();
 let desktopSettings={visible:false,width:600,x:-1,y:-1,monitor:0,page:1};
 let reference={active:false,paused:false,mode:'ghost'},hudNavigating=true;
 const DEFAULT_LAYOUT_SHORTCUT='Control+Alt+M';
 let layoutShortcut=DEFAULT_LAYOUT_SHORTCUT,layoutShortcutError=null,shortcutReady=false,shortcutRecording=false;
 let sceneInputCaptured=false,referenceInteracting=false,quitProcess=null,allowHudClose=false;
 let directEditor={active:false,compact:false,fullScreen:false,toolbarRect:null},directSaved=null,directRegions=[],directLayoutKey='';
 let referenceGestureActive=false,sceneDragging=false;
 let applying=false,applyAgain=false,directChanging=false,lastManagerState='',lastHostState='',lastReferenceState='';
 let persistTimer=null,lastPersistAt=-Infinity,pendingStatusText=null;
 const sceneDiagnostics={epoch:controlSession,counts:{},events:[]};let lastMouseMoveRecord=-Infinity;
 function recordSceneInput(type,detail={}){
  sceneDiagnostics.counts[type]=(sceneDiagnostics.counts[type]||0)+1;
  const now=performance.now();if(type==='mouseMove'&&now-lastMouseMoveRecord<50)return;
  if(type==='mouseMove')lastMouseMoveRecord=now;
  sceneDiagnostics.events.push({wallTime:Date.now(),t:Math.round(now*1000)/1000,type,...detail});
  if(sceneDiagnostics.events.length>64)sceneDiagnostics.events.shift();
 }

 function normalizeLayoutShortcut(value){
  if(typeof value!=='string'||value.length>100)throw Error('请输入有效的组合键');
  const parts=value.split('+').map(part=>part.trim());
  if(parts.length<2||parts.some(part=>!part))throw Error('组合键需要修饰键和一个按键');
  const aliases={control:'Control',ctrl:'Control',commandorcontrol:'Control',cmdorctrl:'Control',alt:'Alt',option:'Alt',shift:'Shift',super:'Super',meta:'Super',command:'Super',cmd:'Super'};
  const modifiers=new Set();let key=null;
  const named={space:'Space',tab:'Tab',escape:'Escape',esc:'Escape',enter:'Enter',return:'Enter',backspace:'Backspace',delete:'Delete',insert:'Insert',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',up:'Up',down:'Down',left:'Left',right:'Right',plus:'Plus',minus:'-',equal:'=',comma:',',period:'.',slash:'/',semicolon:';',quote:"'",backslash:'\\',bracketleft:'[',bracketright:']','-':'-','=':'=',',':',','.':'.','/':'/',';':';',"'":"'",'\\':'\\','[':'[',']':']'};
  for(const part of parts){const lower=part.toLowerCase(),modifier=aliases[lower];
   if(modifier){if(modifiers.has(modifier))throw Error('修饰键不能重复');modifiers.add(modifier);continue;}
   if(key)throw Error('组合键只能包含一个普通按键');
   key=/^[a-z0-9]$/i.test(part)?part.toUpperCase():/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part)?part.toUpperCase():named[lower];
   if(!key)throw Error('不支持这个按键，请使用字母、数字、F1–F24或常用控制键');
  }
  if(!key||!modifiers.size)throw Error('组合键需要修饰键和一个按键');
  return ['Control','Alt','Shift','Super'].filter(part=>modifiers.has(part)).concat(key).join('+');
 }
 function shortcutState(){return {ok:shortcutReady&&(shortcutRecording||globalShortcut.isRegistered(layoutShortcut)),accelerator:layoutShortcut,error:layoutShortcutError,recording:shortcutRecording};}
 function shortcutLabel(){return layoutShortcut.replace(/Control/g,'Ctrl');}
 function layoutShortcutAction(){if(quitting||closeBusy||closingManager||shortcutRecording)return;if(manager&&!manager.isDestroyed()&&reference.active&&!manager.isMinimized())manager.webContents.executeJavaScript('window.OverlayManager?.finishEditing()').catch(reportError);else void openManager('layout');}
 function registerLayoutShortcut(value,persist=true){
  let next;try{next=normalizeLayoutShortcut(value);}catch(error){return {ok:false,accelerator:layoutShortcut,error:error.message};}
  // The current registration belongs to us, so setting it again is a success.
  if(next===layoutShortcut&&globalShortcut.isRegistered(next))return {ok:true,accelerator:layoutShortcut,error:null};
  let registered=false;
  try{registered=globalShortcut.register(next,layoutShortcutAction);}catch{}
  if(!registered)return {ok:false,accelerator:layoutShortcut,error:'该组合键已被占用或系统不允许注册，请换一个组合键'};
  const previous=layoutShortcut;
  try{
   if(persist){const updated={...desktopSettings,layoutShortcut:next};fs.writeFileSync(config+'.tmp',JSON.stringify(updated,null,2));fs.renameSync(config+'.tmp',config);desktopSettings=updated;}
  }catch(error){globalShortcut.unregister(next);return {ok:false,accelerator:previous,error:'快捷键保存失败：'+error.message};}
  layoutShortcut=next;layoutShortcutError=null;shortcutReady=true;shortcutRecording=false;
  if(previous!==next)globalShortcut.unregister(previous);
  refreshTrayMenu();publish();persistStatus();
  return {ok:true,accelerator:layoutShortcut,error:null};
 }
 function setLayoutShortcutRecording(active){
  if(active===shortcutRecording)return shortcutState();
  if(active){
   if(!manager||manager.isDestroyed()||!manager.isFocused()||manager.isMinimized()||closeBusy||closingManager||quitting)return {ok:false,accelerator:layoutShortcut,error:'管理窗口当前无法录入快捷键'};
   globalShortcut.unregister(layoutShortcut);shortcutRecording=true;layoutShortcutError=null;
  }else{
   shortcutRecording=false;
   if(!globalShortcut.isRegistered(layoutShortcut)){
    let restored=false;try{restored=globalShortcut.register(layoutShortcut,layoutShortcutAction);}catch{}
    layoutShortcutError=restored?null:'原快捷键恢复失败，该组合键已被占用或系统不允许注册';
   }
  }
  refreshTrayMenu();publish();return shortcutState();
 }
 function requestOverlayQuit(){
  if(quitting||closeBusy||closingManager||quitProcess)return;
  // The shared stop entry point requests this desktop's normal save-and-close,
  // then pauses its own launcher and stops only this installation's services.
  // Never await it here: the stop script waits for Electron to exit.
  try{
   // DETACHED_PROCESS makes Windows PowerShell exit 0 without running -File;
   // sharing Electron's console instead kills the stop script when we exit.
   // A short launcher creates a separate hidden console for the complete stop.
   const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
   const quote=value=>"'"+value.replace(/'/g,"''")+"'";
   const args='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+path.join(root,'Stop-Overlay.ps1')+'"';
   const command='Start-Process -FilePath '+quote(ps)+' -WindowStyle Hidden -ArgumentList '+quote(args);
   const child=spawn(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{cwd:root,windowsHide:true,stdio:'ignore'});
   quitProcess=child;
   child.once('error',error=>{if(quitProcess===child)quitProcess=null;reportError(error);});
   child.once('exit',code=>{if(quitProcess===child)quitProcess=null;if(code!==0&&!quitting)reportError(Error('退出叠加程序未完成（'+code+'）；当前编辑和运行状态已保留，可重试。'));});
   child.unref();
  }catch(error){quitProcess=null;reportError(error);}
 }
 function refreshTrayMenu(){
  if(!tray||tray.isDestroyed())return;
  trayController?.setTooltipSuffix(shortcutState().ok?shortcutLabel()+' 编辑':'编辑快捷键未注册');
  tray.setContextMenu(Menu.buildFromTemplate([
   {label:'打开管理窗口',click:()=>openManager('overview')},
   {label:'编辑布局 ('+shortcutLabel()+')',click:()=>openManager('layout')},
   {label:'盘面与设备输入',click:()=>openManager('inputs')},
   {label:'显示 / 隐藏桌面叠加',click:()=>writeSettings({visible:!settings().visible})},
   {label:'重置本段 G 峰值',click:()=>{if(win&&!win.isDestroyed()&&!hudNavigating)win.webContents.executeJavaScript('window.OverlayUIHost?.resetGPeak()').catch(reportError);}},
   {type:'separator'},
   {label:'退出叠加程序',click:requestOverlayQuit}
  ]));
 }
 function directRequested(){return !quitting&&!hudNavigating&&!closingManager&&!!manager&&!manager.isDestroyed()&&!manager.isMinimized()&&reference.active&&!reference.paused&&reference.mode==='normal';}
 function sceneInteractive(){return directRequested()&&!closeBusy;}
 function managerBounds(){
  if(!win||win.isDestroyed()||!manager||manager.isDestroyed()||!manager.isVisible()||manager.isMinimized())return null;
  const bounds=manager.getBounds(),host=win.getContentBounds();return {x:bounds.x-host.x,y:bounds.y-host.y,width:bounds.width,height:bounds.height};
 }
 function cleanSceneRegions(value){
  if(!Array.isArray(value)||value.length>64)throw Error('现场布局区域必须为不超过64项的数组');
  return value.map(row=>{
   const x=row?.x,y=row?.y,width=row?.width??row?.w,height=row?.height??row?.h;
   if(![x,y,width,height].every(Number.isFinite)||Math.abs(x)>1000000||Math.abs(y)>1000000||width<0||height<0||width>1000000||height>1000000)throw Error('现场布局区域无效');
   return {x,y,width,height};
  }).filter(row=>row.width>0&&row.height>0);
 }
 function findDirectSpace(width,height,preferred=null){
  const host=win.getContentBounds(),work=selectedDisplay().workArea;
  const area={left:Math.max(0,work.x-host.x)+12,top:Math.max(0,work.y-host.y)+12,right:Math.min(host.width,work.x+work.width-host.x)-12,bottom:Math.min(host.height,work.y+work.height-host.y)-12};
  if(width>area.right-area.left||height>area.bottom-area.top)return null;
  const obstacles=directRegions.map(r=>({left:r.x-12,right:r.x+r.width+12,top:r.y-12,bottom:r.y+r.height+12}));
  const clear=r=>r.x>=area.left&&r.y>=area.top&&r.x+width<=area.right&&r.y+height<=area.bottom&&!obstacles.some(o=>r.x<o.right&&r.x+width>o.left&&r.y<o.bottom&&r.y+height>o.top);
  if(preferred&&preferred.width===width&&preferred.height>=height&&clear(preferred))return {x:preferred.x,y:preferred.y,width,height};
  const xs=[...new Set([area.left,area.right-width,...obstacles.map(o=>o.right)].map(Math.ceil))].filter(x=>x>=area.left&&x+width<=area.right);
  let best=null,score=Infinity;
  for(const x of xs){
   const intervals=obstacles.filter(o=>x<o.right&&x+width>o.left).sort((a,b)=>a.top-b.top);let y=area.top;
   for(const o of [...intervals,{top:area.bottom,bottom:area.bottom}]){
    if(y+height<=Math.min(o.top,area.bottom)){
     const rect={x:Math.ceil(x),y:Math.ceil(y),width,height};
     const distance=Math.abs(area.right-width-rect.x)+Math.abs(area.top-rect.y);
     if(clear(rect)&&distance<score){best=rect;score=distance;}
     break;
    }
    y=Math.max(y,o.bottom);if(y+height>area.bottom)break;
   }
  }
  return best;
 }
 function expandDirectHeight(rect){
  if(!rect)return null;
  const host=win.getContentBounds(),work=selectedDisplay().workArea;
  const bottomLimit=Math.min(host.height,work.y+work.height-host.y)-12;
  let bottom=rect.y+Math.max(rect.height,Math.min(directSaved.normalBounds.height,960,bottomLimit-rect.y));
  // Keep the same safe top-left anchor and width. Only the empty vertical
  // corridor below the minimum rectangle can add module-list height.
  for(const region of directRegions){
   const left=region.x-12,right=region.x+region.width+12,top=region.y-12;
   if(rect.x<right&&rect.x+rect.width>left&&top>=rect.y+rect.height)bottom=Math.min(bottom,top);
  }
  return {...rect,height:Math.max(rect.height,Math.floor(bottom-rect.y))};
 }
 function commitWindowLayers(){
  if(!win||win.isDestroyed()||quitting)return;
  const panel=manager&&!manager.isDestroyed()?manager:null;
  // The manager is an independent taskbar window. Commit the two native
  // levels in order without native ownership or activating either window.
  win.setAlwaysOnTop(true,'screen-saver');
  if(panel&&!panel.isMinimized())panel.setAlwaysOnTop(true,'screen-saver');
 }
 function restoreDirectEditor(){
  // Iconic geometry belongs to Windows until restore. Keep the original
  // editor snapshot and compact placement; never resize the minimized HWND.
  if(manager&&!manager.isDestroyed()&&manager.isMinimized())return;
  if(!directSaved){directEditor={active:false,compact:false,fullScreen:false,toolbarRect:null};return;}
  const saved=directSaved;directSaved=null;directLayoutKey='';
  directEditor={active:false,compact:false,fullScreen:false,toolbarRect:null};sceneDragging=false;
  if(!manager||manager.isDestroyed())return;
  directChanging=true;
  try{
   manager.setResizable(saved.resizable);manager.setMaximizable(saved.maximizable);
   manager.setMinimumSize(...saved.minimumSize);manager.setBounds(saved.normalBounds);
   if(saved.maximized&&!manager.isMinimized())manager.maximize();
   if(saved.visible&&!closingManager&&!quitting&&!manager.isMinimized())manager.showInactive();
   commitWindowLayers();
  }finally{directChanging=false;}
 }
 function reconcileDirectEditor(){
  if(directChanging)return;
  if(!directRequested()){restoreDirectEditor();return;}
  const entering=!directSaved,managerWasFocused=manager.isFocused();
  if(!directSaved){
   directSaved={bounds:manager.getBounds(),normalBounds:manager.getNormalBounds(),minimumSize:manager.getMinimumSize(),maximized:manager.isMaximized(),resizable:manager.isResizable(),maximizable:manager.isMaximizable(),visible:manager.isVisible()};
   directEditor={active:true,compact:false,fullScreen:true,toolbarRect:null};directChanging=true;
   try{if(manager.isMaximized())manager.unmaximize();manager.setMinimumSize(600,480);manager.setAlwaysOnTop(true,'screen-saver');manager.setResizable(false);manager.setMaximizable(false);}finally{directChanging=false;}
  }
  // Pointer-down alone does not hide or reposition the panel. The real HUD
  // drag owns the hide; its mouse-up carries final regions in the same IPC.
  if(sceneDragging){if(manager.isVisible()){directChanging=true;try{manager.hide();}finally{directChanging=false;}}return;}
  if(referenceGestureActive)return;
  const host=win.getContentBounds(),key=JSON.stringify([host,selectedDisplay().workArea,directRegions]);
  if(key===directLayoutKey)return;directLayoutKey=key;
  const previous=manager.getBounds(),old={x:previous.x-host.x,y:previous.y-host.y,width:previous.width,height:previous.height};
  const compact=expandDirectHeight(findDirectSpace(620,500,old)||findDirectSpace(600,480,old));
  const enterFullScreen=!compact&&(entering||!directEditor.fullScreen);
  directEditor={active:true,compact:!!compact,fullScreen:!compact,toolbarRect:compact?null:findDirectSpace(220,44)};
  directChanging=true;
  try{
   if(compact){manager.setBounds({x:host.x+compact.x,y:host.y+compact.y,width:compact.width,height:compact.height});if(!manager.isVisible())manager.showInactive();}
   else{
    if(manager.isVisible())manager.hide();
    // This is an explicit hand-off from the focused editor, not a hover or a
    // temporary drag hide. Escape must work even before the first HUD click.
    if(enterFullScreen&&managerWasFocused){referenceInteracting=true;setSceneFocusable(true);if(!win.isFocused())win.focus();recordSceneInput('fallbackFocus',{focused:win.isFocused()});}
   }
   commitWindowLayers();
  }finally{directChanging=false;}
 }
 function setSceneFocusable(value){
  if(!win||win.isDestroyed()||win.isFocusable()===value)return;
  win.setFocusable(value);
  // Electron's Windows setFocusable also changes skipTaskbar. The HUD keeps
  // its overlay identity even while explicit editing makes it activatable.
  win.setSkipTaskbar(true);
 }
 function endReferenceInteraction(){
  const active=referenceInteracting;referenceInteracting=false;
  if(active&&win&&!win.isDestroyed()&&win.isFocused())win.blur();
  // Losing keyboard ownership does not revoke the next click's ability to
  // activate a normal editor. Only leaving that mode makes the HUD passive.
  setSceneFocusable(sceneInteractive());
 }
 function setSceneInputCapture(_value,reason='现场编辑已暂停'){
  // Native input belongs to the mode. Renderer hover messages cannot turn it
  // off between the first mouse move and the first actual button press.
  const capture=sceneInteractive();
  if(!win||win.isDestroyed())return false;
  const changed=sceneInputCaptured!==capture,cancelled=!capture&&referenceInteracting;
  if(changed){sceneInputCaptured=capture;win.setIgnoreMouseEvents(!capture,{forward:true});recordSceneInput('capture',{captured:capture,mode:reference.mode,reason});}
  if(capture)setSceneFocusable(true);else endReferenceInteraction();
  if(cancelled)win.webContents.send('scene-input-cancelled',{reason});
  if(changed&&!applying){publish();persistStatus();}
  return capture;
 }
 function updateSceneInput(){setSceneInputCapture(sceneInteractive());}
 function setSceneDragging(value,regions){
  if(value&&!sceneInteractive())return {ok:false,error:'现场编辑当前不可用'};
  let next=directRegions;
  try{if(regions!==undefined)next=cleanSceneRegions(regions);}catch(error){return {ok:false,error:error.message};}
  const changed=sceneDragging!==value||JSON.stringify(next)!==JSON.stringify(directRegions);
  directRegions=next;sceneDragging=value;
  if(!value){referenceGestureActive=false;directLayoutKey='';}
  if(changed||!value){recordSceneInput('dragging',{active:value,regionCount:directRegions.length});apply();}
  return {ok:true,directEditor:{...directEditor}};
 }

 function reportError(error) {
  if(quitting)return;
  try {fs.writeFileSync(path.join(root,'runtime','desktop-error.txt'),String(error?.stack||error));} catch {}
 }
 function finishShutdownRequest(state,error=null){
  if(!shutdownRequest)return;
  writeControlResult(shutdownRequest,state,error);
  clearTimeout(shutdownTimer);shutdownTimer=null;
  if(state==='cancelled')shutdownRequest=null;
 }
 function writeControlResult(request,state,error=null){
  const temp=controlResult+'.'+process.pid+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify({...request,state,error}));fs.renameSync(temp,controlResult);}catch(failure){reportError(failure);try{fs.unlinkSync(temp);}catch{}}
 }
 async function readControl(){
  let value;
  try{value=JSON.parse(fs.readFileSync(controlFile,'utf8'));}catch(error){if(error.code!=='ENOENT')reportError(error);return;}
  if(value?.pid!==process.pid||value.session!==controlSession||!['quit','open-layout'].includes(value.action)||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||value.id===seenControl)return;
  seenControl=value.id;
  const request={id:value.id,session:controlSession,expiresAt:value.expiresAt};
  const remaining=request.expiresAt-Date.now();
  if(value.action==='open-layout'){
   const ready=Number.isFinite(request.expiresAt)&&remaining>0&&remaining<=10000&&!quitting&&!hudNavigating&&!closeBusy&&!closingManager&&!shutdownRequest;
   const opened=ready&&await openManager('layout',request.expiresAt);
   if(seenControl===request.id&&Date.now()<request.expiresAt)writeControlResult(request,opened?'opened':'declined',opened?null:'The desktop kept its current page. Complete any pending edit and retry.');
   return;
  }
  shutdownRequest=request;
  if(!Number.isFinite(remaining)||remaining<=0||remaining>30000){finishShutdownRequest('cancelled','The close request expired; the current edit was kept.');return;}
  shutdownTimer=setTimeout(()=>finishShutdownRequest('cancelled','Saving or closing timed out; the current edit was kept.'),remaining);
  if(closeBusy||closingManager){finishShutdownRequest('cancelled','Another close operation is in progress; the edit was kept.');return;}
  app.quit();
 }
 function publishLayoutChange(){
  let contents,stage;
  try{
   contents=fs.readFileSync(path.join(root,'assets','layout.json'),'utf8');
   if(contents===observedLayout)return;
   stage=JSON.parse(contents)?.stage;
  }catch(error){reportError(error);return;}
  observedLayout=contents;obsStage=stage;
  publishObsState();
  if(win&&!win.isDestroyed()&&!hudNavigating)win.webContents.send('layout-change');
 }
 function publishObsState(retry=true){
  clearTimeout(obsStateRetry);obsStateRetry=null;
  if(quitting||hudNavigating)return;
  const dimension=value=>Number.isInteger(value)&&value>0?value:0;
  const contents=JSON.stringify({port,width:dimension(obsStage?.monitorPixelWidth),height:dimension(obsStage?.monitorPixelHeight),revision:controlSession+'-'+obsRevision});
  if(contents===obsStateText)return;
  const temp=obsStateFile+'.'+process.pid+'.tmp';
  try{fs.writeFileSync(temp,contents);fs.renameSync(temp,obsStateFile);obsStateText=contents;}
  catch(error){reportError(error);try{fs.unlinkSync(temp);}catch{}if(retry)obsStateRetry=setTimeout(()=>publishObsState(false),250);}
 }
 function publishWheelResources(){
  if(!pendingPackIds.size||hudNavigating||!win||win.isDestroyed())return;
  win.webContents.send('wheel-resources-change',[...pendingPackIds]);
  pendingPackIds.clear();
 }
 function readSettings(attempt=0) {
  clearTimeout(configRetry);
  try {
   const next=JSON.parse(fs.readFileSync(config,'utf8'));
   if(!next||typeof next!=='object'||Array.isArray(next))throw Error('Invalid desktop settings');
   for(const key of ['width','x','y','monitor','page'])if(next[key]!=null&&!Number.isFinite(next[key]))throw Error('Invalid desktop setting: '+key);
   if(next.monitor!=null&&(!Number.isInteger(next.monitor)||next.monitor<0))throw Error('Invalid display selection');
   if(next.page!=null&&![1,2].includes(next.page))throw Error('Invalid dashboard page');
   if(next.width!=null&&next.width<=0)throw Error('Invalid desktop width');
   if(next.visible!=null&&typeof next.visible!=='boolean')throw Error('Invalid visibility');
   if(next.placement!=null){
    if(typeof next.placement!=='object'||Array.isArray(next.placement))throw Error('Invalid desktop placement');
    for(const key of ['anchorX','bottomRatio','heightRatio','edgeRatio'])if(next.placement[key]!=null&&!Number.isFinite(next.placement[key]))throw Error('Invalid placement: '+key);
   }
   if(JSON.stringify(next)===JSON.stringify(desktopSettings))return;
   if(next.layoutShortcut!=null)normalizeLayoutShortcut(next.layoutShortcut);
   if(shortcutReady&&next.layoutShortcut!=null&&normalizeLayoutShortcut(next.layoutShortcut)!==layoutShortcut){const result=registerLayoutShortcut(next.layoutShortcut,false);if(!result.ok)throw Error(result.error);}
   desktopSettings=next;
  }catch(error){
   reportError(error);
   const delay=[50,150,500][attempt];
   if(delay!==undefined&&!quitting)configRetry=setTimeout(()=>readSettings(attempt+1),delay);
   return;
  }
  apply();
 }
 function settings(){return desktopSettings;}
 function writeSettings(patch,refreshDisplay=false){
  const next={...desktopSettings,...patch};
  fs.writeFileSync(config+'.tmp',JSON.stringify(next,null,2));
  fs.renameSync(config+'.tmp',config);
  desktopSettings=next;
  if(refreshDisplay)syncDisplays(true);
  apply();
 }
 function selectedDisplay(){const s=settings(),ds=screen.getAllDisplays();return s.monitor>0?ds[Math.min(ds.length-1,s.monitor-1)]:(manager&&!manager.isDestroyed()?ds.find(d=>d.id===managerDisplayId):null)||screen.getDisplayNearestPoint(screen.getCursorScreenPoint());}
 function desktopScene(s,d){const width=Math.max(1,Math.min(1600,Math.round(s.width||600),d.bounds.width,Math.floor(d.bounds.height/.85))),area=d.bounds,p=displays?.get(d);return {...(s.placement?.mode==='relative'?require('./layout.js').screenStage(area.width,area.height,s.placement):{width:area.width,height:area.height,originX:Number.isFinite(s.x)&&s.x!==-1?s.x:area.width-width-24,originY:Number.isFinite(s.y)&&s.y!==-1?s.y:area.height-Math.round(width*.85)-24,scale:width/1000}),pixelWidth:p?.width||Math.round(area.width*d.scaleFactor),pixelHeight:p?.height||Math.round(area.height*d.scaleFactor),monitorPixelWidth:p?.width||Math.round(area.width*d.scaleFactor),monitorPixelHeight:p?.height||Math.round(area.height*d.scaleFactor)};}
 function saveScene(scene){const target=path.join(root,'assets','layout.json');try{const old=JSON.parse(fs.readFileSync(target,'utf8'));if(JSON.stringify(old.stage)===JSON.stringify(scene))return;const value=require('./layout.js').clean({...old,stage:scene});fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2));fs.renameSync(target+'.tmp',target);}catch(e){fs.writeFileSync(path.join(root,'runtime','layout-error.txt'),String(e.message));}}
 function syncDisplays(refresh=false){if(!quitting&&win&&!win.isDestroyed())displays.request(selectedDisplay(),refresh);}
 function status(){const s=settings(),d=selectedDisplay();return {control:{pid:process.pid,session:controlSession,ready:!hudNavigating,managerOpen:!!manager&&!manager.isDestroyed()},visible:!!s.visible,page:Math.max(1,Math.min(2,s.page||1)),reference:{...reference},layoutShortcut,layoutShortcutState:shortcutState(),sceneInteractive:sceneInteractive(),sceneInputCaptured,directEditor:{...directEditor},managerBounds:managerBounds(),monitor:s.monitor||0,selectedDisplayId:d.id,displays:screen.getAllDisplays().map((d,i)=>({index:i+1,id:d.id,label:d.label||'显示器 '+(i+1),bounds:d.bounds,scaleFactor:d.scaleFactor})),maximized:!!manager&&!manager.isDestroyed()&&manager.isMaximized(),baseUrl};}
 function publish(){
  if(manager&&!manager.isDestroyed()){
   const value=status(),text=JSON.stringify(value);if(text!==lastManagerState){lastManagerState=text;manager.webContents.send('manager-state',value);}
  }
  if(win&&!win.isDestroyed()){
   const interaction={sceneInteractive:sceneInteractive(),sceneInputCaptured,directEditor:{...directEditor},managerBounds:managerBounds()};
   const hostText=JSON.stringify(interaction);if(hostText!==lastHostState){lastHostState=hostText;win.webContents.send('manager-state',interaction);}
   const value={...reference,...interaction},text=JSON.stringify(value);if(text!==lastReferenceState){lastReferenceState=text;win.webContents.send('ui-reference',value);}
  }
 }
 function hudPresentation(){
  const active=reference.active&&!reference.paused;
  const visible=active?reference.mode!=='hidden':!!settings().visible;
  // The manager consumes this renderer's canvas. A hidden native window can
  // stop its animation frames even with backgroundThrottling:false, so keep
  // the same window shown transparently while a visible manager needs frames.
  const preview=!!manager&&!manager.isDestroyed()&&manager.isVisible()&&!manager.isMinimized()&&!closingManager;
  return {visible,windowShown:visible||preview,opacity:visible?1:0,previewOnly:!visible&&preview};
 }
 function persistStatus(){
  if(quitting||!win||win.isDestroyed())return;
  const d=selectedDisplay(),scene=desktopScene(settings(),d),snapshot=status(),presentation=hudPresentation();
  const value=JSON.stringify({control:snapshot.control,pid:process.pid,visible:presentation.visible&&win.isVisible(),configuredVisible:snapshot.visible,presentation:{...presentation,windowShown:win.isVisible(),opacity:win.getOpacity()},bounds:win.getBounds(),alwaysOnTop:win.isAlwaysOnTop(),transparent:true,clickThrough:!sceneInputCaptured,sceneInteractive:sceneInteractive(),referenceInteracting,directEditor:{...directEditor},sceneDragging,layoutShortcut:shortcutState(),scene,reference:{...reference},tray:trayController?.getStatus()||null,displays:snapshot.displays});
  if(value===lastStatus){pendingStatusText=null;return;}
  pendingStatusText=value;
  const flush=()=>{persistTimer=null;const text=pendingStatusText;pendingStatusText=null;if(text===null||text===lastStatus||quitting)return;try{fs.writeFileSync(statusFile,text);lastStatus=text;lastPersistAt=performance.now();}catch(error){reportError(error);}};
  if(persistTimer)return;
  const remaining=100-(performance.now()-lastPersistAt);if(remaining>0)persistTimer=setTimeout(flush,remaining);else flush();
 }
 function loadHud(){
  if(quitting||!win||win.isDestroyed()||manager&&!manager.isDestroyed())return;
  if(loadedRevision===revision)return;
  loadedRevision=revision;reloadAttempts=0;clearTimeout(reloadTimer);
  const s=settings(),scene=desktopScene(s,selectedDisplay());
  navigateHud(baseUrl+'?page='+Math.max(1,Math.min(2,s.page||1))+'&edit=0&desktop=1&stage='+encodeURIComponent(JSON.stringify(scene))+'&v='+revision);
 }
 function navigateHud(url){
  const epoch=++navigation;hudUrl=url;clearTimeout(reloadTimer);recordSceneInput('navigation-start',{epoch});
  hudNavigating=true;updateSceneInput();trayController?.invalidate();
  win.loadURL(url).then(()=>{
   if(quitting||epoch!==navigation||win.isDestroyed())return;
   clearTimeout(reloadTimer);reloadAttempts=0;hudNavigating=false;lastHostState='';lastReferenceState='';recordSceneInput('navigation-ready',{epoch});
   win.webContents.send('scene-change',desktopScene(settings(),selectedDisplay()));
   win.webContents.send('ui-page',Math.max(1,Math.min(2,settings().page||1)));publish();persistStatus();publishObsState();publishWheelResources();
  }).catch(error=>{
   if(quitting||epoch!==navigation)return;
   // Only superseded loads are disposable. The current load must report and
   // recover even when Electron aborts it, otherwise readiness stays false.
   recordSceneInput('navigation-failed',{epoch,code:error.code||null,errno:error.errno??null});reportError(error);scheduleRecovery();
  });
 }
 function apply(){
  if(quitting||!win||win.isDestroyed())return;
  if(applying){applyAgain=true;return;}applying=true;
  try{
  const s=settings(),d=selectedDisplay(),scene=desktopScene(s,d);
  const boundsKey=JSON.stringify([d.id,d.bounds,d.scaleFactor]);
  if(boundsKey!==lastBounds){
   lastBounds=boundsKey;
   win.setBounds({...d.bounds});
   const actual=win.getBounds();
   if(actual.width>d.bounds.width||actual.height>d.bounds.height)win.setBounds({x:d.bounds.x,y:d.bounds.y,width:Math.max(1,d.bounds.width-Math.max(0,actual.width-d.bounds.width)),height:Math.max(1,d.bounds.height-Math.max(0,actual.height-d.bounds.height))});
  }
  const sceneKey=JSON.stringify(scene);
  if(sceneKey!==lastScene){
   lastScene=sceneKey;saveScene(scene);
   if(!hudNavigating)win.webContents.send('scene-change',scene);
  }
  const page=Math.max(1,Math.min(2,s.page||1));
  if(page!==lastPage){lastPage=page;if(!hudNavigating)win.webContents.send('ui-page',page);}
  reconcileDirectEditor();updateSceneInput();
  const presentation=hudPresentation();
  if(!lastPresentation||presentation.opacity!==lastPresentation.opacity)win.setOpacity(presentation.opacity);
  if(!lastPresentation||presentation.windowShown!==lastPresentation.windowShown){if(presentation.windowShown)win.showInactive();else win.hide();commitWindowLayers();}
  lastPresentation=presentation;
  loadHud();syncDisplays();publish();persistStatus();
  }finally{applying=false;if(applyAgain){applyAgain=false;queueMicrotask(apply);}}
 }
 function requestReload(){revision++;obsRevision++;apply();publishObsState();}
 function scheduleRecovery(){
  clearTimeout(reloadTimer);
  if(quitting||!win||win.isDestroyed())return;
  const delays=[250,1000,3000,10000],attempt=Math.min(reloadAttempts++,delays.length-1),epoch=navigation;
  // One outstanding recovery, capped at one request per ten seconds while the
  // local bridge is unavailable. Successful navigation resets the backoff.
  reloadTimer=setTimeout(()=>{
   reloadTimer=null;
   if(quitting||epoch!==navigation||!win||win.isDestroyed())return;
   if(manager&&!manager.isDestroyed()){loadedRevision=null;return;}
   navigateHud(hudUrl);
  },delays[attempt]);
 }
 function trustedFrame(e,target,pathname){
  if(!target||target.isDestroyed()||e.sender!==target.webContents||e.senderFrame!==target.webContents.mainFrame)return false;
  try{const url=new URL(e.senderFrame.url);return url.origin===new URL(baseUrl).origin&&url.pathname===pathname;}catch{return false;}
 }
 function trustedManager(e){return trustedFrame(e,manager,'/manager.html');}
 function trustedHost(e){return trustedFrame(e,win,'/');}
 async function showManagerAfterCloseDeclined(target,request=null){
  const current=()=>target===manager&&!target.isDestroyed()&&(!request||shutdownRequest?.id===request.id&&Date.now()<request.expiresAt);
  if(!current())return;
  // A hidden full-screen editor must reveal the page that owns save errors.
  // Change the page's mode too, so a later draft cannot reopen direct mode.
  if(directEditor.active){const live=request?'Date.now()<'+request.expiresAt:'true';await target.webContents.executeJavaScript(live+' && window.OverlayManager?.setReferenceMode?.("ghost")');}
  if(current()){if(target.isMinimized())target.restore();target.show();}
 }
 async function closeManager(quit=false){
  if(!manager||manager.isDestroyed()||closingManager||closeBusy)return;
  const target=manager,previousReference={...reference},externalRequest=quit?shutdownRequest:null;setLayoutShortcutRecording(false);closeBusy=true;updateSceneInput();publish();
  try{
   const expression=externalRequest?'Date.now()<'+externalRequest.expiresAt+' && window.OverlayManager?.requestClose()':'window.OverlayManager?.requestClose()';
   const ok=await target.webContents.executeJavaScript(expression);
   if(externalRequest&&(shutdownRequest?.id!==externalRequest.id||Date.now()>=externalRequest.expiresAt)){quitAfterManager=false;reference=previousReference;apply();if(!target.isDestroyed())target.webContents.send('manager-suspended',false);if(shutdownRequest?.id===externalRequest.id)finishShutdownRequest('cancelled','The close request expired; the current edit was kept.');return;}
   if(ok!==true){quitAfterManager=false;await showManagerAfterCloseDeclined(target,externalRequest);if(quit&&(!externalRequest||shutdownRequest?.id===externalRequest.id))finishShutdownRequest('cancelled','Saving or closing was declined; finish the current edit and retry.');return;}
   quitAfterManager=quit;closingReference=previousReference;closingManager=true;
   reference={active:false,paused:false,mode:'ghost'};apply();target.close();
  }catch(error){quitAfterManager=false;reportError(error);try{await showManagerAfterCloseDeclined(target,externalRequest);}catch(failure){reportError(failure);}if(quit&&(!externalRequest||shutdownRequest?.id===externalRequest.id))finishShutdownRequest('cancelled',String(error.message||error));}
  finally{closingManager=false;closeBusy=false;apply();}
 }
 async function openManager(page='layout',expiresAt=null){
  if(expiresAt!==null&&Date.now()>=expiresAt)return false;
  const argument=JSON.stringify(page),beforeExpiry=expiresAt===null?'true':'Date.now()<'+expiresAt;
  try{
   if(manager&&!manager.isDestroyed()){
    if(manager.isMinimized())manager.restore();if(!directEditor.active){manager.show();manager.focus();}
    return await manager.webContents.executeJavaScript(beforeExpiry+' && window.OverlayManager?.navigate('+argument+')')===true;
   }
   if(!win||win.isDestroyed())return false;
   const invoked=await win.webContents.executeJavaScript(beforeExpiry+' && !!window.OverlayUIHost && (window.OverlayUIHost.open('+argument+'),true)',true);
   return invoked===true&&!!manager&&!manager.isDestroyed();
  }catch(error){reportError(error);return false;}
 }
 app.whenReady().then(()=>{
  readSettings();
  displays=createDisplayController({screen,root,onChange:result=>{try{fs.writeFileSync(path.join(root,'runtime','display-sync.json'),JSON.stringify(result,null,2));}catch(error){reportError(error);}apply();},onError:reportError});
  win=new BrowserWindow({width:600,height:510,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,thickFrame:false,webPreferences:{preload:path.join(root,'desktop-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.setMenu(null);win.setAlwaysOnTop(true,'screen-saver');win.setIgnoreMouseEvents(true,{forward:true});win.setFocusable(false);
  win.webContents.setWindowOpenHandler(({url})=>url.split('?')[0]===managerUrl?{action:'allow',overrideBrowserWindowOptions:{width:1440,height:960,minWidth:960,minHeight:640,frame:false,transparent:false,backgroundColor:'#101112',show:true,focusable:true,alwaysOnTop:true,skipTaskbar:false,resizable:true,minimizable:true,maximizable:true,fullscreenable:false,webPreferences:{preload:path.join(root,'desktop-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}}}:{action:'deny'});
  win.webContents.on('did-create-window',child=>{if(manager&&!manager.isDestroyed()){child.close();manager.show();return;}managerDisplayId=selectedDisplay().id;manager=child;lastManagerState='';child.setMenu(null);child.setParentWindow(null);child.setFocusable(true);child.setSkipTaskbar(false);commitWindowLayers();child.webContents.setWindowOpenHandler(()=>({action:'deny'}));child.webContents.on('will-navigate',(e,url)=>{if(url.split('?')[0]!==managerUrl)e.preventDefault();});child.on('close',e=>{if(closingManager)return;e.preventDefault();closeManager();});child.webContents.on('will-prevent-unload',()=>{finishShutdownRequest('cancelled','The edit stayed open because saving or closing was declined.');quitAfterManager=false;closingManager=false;if(closingReference)reference=closingReference;apply();child.webContents.send('manager-suspended',false);});child.on('blur',()=>setLayoutShortcutRecording(false));child.on('closed',()=>{setLayoutShortcutRecording(false);endReferenceInteraction();directSaved=null;directEditor={active:false,compact:false,fullScreen:false,toolbarRect:null};sceneDragging=false;referenceGestureActive=false;manager=null;managerDisplayId=null;reference={active:false,paused:false,mode:'ghost'};if(quitAfterManager){app.quit();return;}apply();if(win&&!win.isDestroyed())win.webContents.executeJavaScript('window.OverlayUIHost?.managerClosed()').catch(reportError);});
   child.on('minimize',()=>{setLayoutShortcutRecording(false);sceneDragging=false;referenceGestureActive=false;reference.paused=true;apply();child.webContents.send('manager-suspended',true);});child.on('restore',()=>{reference.paused=false;apply();commitWindowLayers();child.webContents.send('manager-suspended',false);});for(const event of ['maximize','unmaximize'])child.on(event,publish);child.webContents.on('did-finish-load',()=>{lastManagerState='';apply();});for(const event of ['move','resize'])child.on(event,()=>{if(!directChanging){updateSceneInput();publish();persistStatus();}});for(const event of ['show','hide'])child.on(event,()=>{if(!directChanging)apply();});apply();
  });
  win.on('show',()=>{if(!hudNavigating&&!quitting)win.webContents.send('ui-draw-demand',true);});
  // Activating the direct editor raises the HUD. Re-stack its independent
  // panel once for this focus event without transferring keyboard focus.
  win.on('focus',()=>{
   if(!directRequested())return;
   commitWindowLayers();
   // moveTop uses SWP_SHOWWINDOW on Windows: never reveal a full-screen or
   // drag-hidden panel, and never touch the native iconic presentation.
   if(manager&&!manager.isDestroyed()&&manager.isVisible()&&!manager.isMinimized())manager.moveTop();
  });
  win.on('close',event=>{if(!allowHudClose&&!quitting){event.preventDefault();requestOverlayQuit();}});
  win.on('blur',()=>{if(referenceInteracting){endReferenceInteraction();recordSceneInput('blur');win.webContents.send('scene-input-cancelled',{reason:'现场编辑已失去焦点'});publish();persistStatus();}});
  win.webContents.on('before-mouse-event',(_event,mouse)=>{if(!directEditor.active)return;const type=['mouseMove','mouseDown','mouseUp','mouseWheel','mouseEnter','mouseLeave'].includes(mouse.type)?mouse.type:'mouseOther';recordSceneInput(type,{x:mouse.x,y:mouse.y,button:mouse.button,captured:sceneInputCaptured,focused:win.isFocused()});});
  win.webContents.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument){hudNavigating=true;updateSceneInput();trayController?.invalidate();}});
  win.webContents.on('render-process-gone',(_event,details)=>{recordSceneInput('renderer-gone',{reason:details.reason,exitCode:details.exitCode});hudNavigating=true;updateSceneInput();trayController?.invalidate();scheduleRecovery();});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(baseUrl))event.preventDefault();});
  ipcMain.on('tray-input-state',(e,value)=>{if(!hudNavigating&&trustedHost(e)&&e.senderFrame===win.webContents.mainFrame)trayController?.acceptState(value);});
  ipcMain.handle('layout-shortcut-get',e=>trustedManager(e)?shortcutState():{ok:false,accelerator:layoutShortcut,error:'非当前管理页面'});
  ipcMain.handle('layout-shortcut-recording',(e,value)=>trustedManager(e)&&typeof value==='boolean'?setLayoutShortcutRecording(value):{ok:false,accelerator:layoutShortcut,error:'非当前管理页面'});
  ipcMain.handle('layout-shortcut-set',(e,value)=>trustedManager(e)?registerLayoutShortcut(value):{ok:false,accelerator:layoutShortcut,error:'非当前管理页面'});
  ipcMain.handle('scene-dragging',(e,value,regions)=>trustedHost(e)&&typeof value==='boolean'?setSceneDragging(value,regions):{ok:false,error:'非当前现场页面'});
  ipcMain.handle('scene-input-diagnostics',e=>trustedHost(e)||trustedManager(e)?{ok:true,epoch:sceneDiagnostics.epoch,counts:{...sceneDiagnostics.counts},events:sceneDiagnostics.events.map(value=>({...value})),state:{reference:{...reference},directEditor:{...directEditor},sceneInputCaptured,referenceInteracting,sceneDragging}}:{ok:false,error:'非当前桌面页面'});
  ipcMain.handle('scene-input-capture',(e,value)=>{if(!trustedHost(e)||typeof value!=='boolean')return {ok:false,captured:false,error:'非当前现场页面'};return {ok:true,captured:setSceneInputCapture(value),interactive:sceneInteractive()};});
  ipcMain.handle('reference-interaction',(e,value)=>{
   if(!trustedHost(e)||typeof value!=='boolean')return {ok:false,error:'非当前现场页面'};
   if(!value){endReferenceInteraction();publish();persistStatus();return {ok:true};}
   if(!sceneInteractive()||!sceneInputCaptured)return {ok:false,error:'现场编辑当前不可用'};
   referenceInteracting=true;setSceneFocusable(true);if(!win.isFocused())win.focus();recordSceneInput('interaction',{active:true,focused:win.isFocused()});publish();persistStatus();return {ok:true};
  });
  ipcMain.handle('manager-state',e=>trustedManager(e)?{ok:true,...status()}:{ok:false,error:'非当前管理页面'});
  ipcMain.handle('window-action',async(e,action)=>{if(!trustedManager(e))return {ok:false,error:'非当前管理页面'};if(action==='minimize')manager.minimize();else if(action==='maximize')manager.isMaximized()?manager.unmaximize():manager.maximize();else if(action==='close'){closeManager();return {ok:true};}else return {ok:false,error:'未知窗口操作'};return {ok:true,...status()};});
  ipcMain.handle('desktop-visible',(e,value)=>{if(!trustedManager(e))return {ok:false};writeSettings({visible:!!value});return {ok:true,...status()};});ipcMain.handle('display-select',(e,index)=>{if(!trustedManager(e)||!Number.isInteger(index)||index<0||index>screen.getAllDisplays().length)return {ok:false,error:'显示器已不可用'};writeSettings({monitor:index},true);return {ok:true,...status()};});
  ipcMain.handle('dashboard-page',(e,page)=>{if(!trustedManager(e)||![1,2].includes(page))return {ok:false};writeSettings({page});return {ok:true,...status()};});
  ipcMain.handle('ui-reference',(e,value)=>{
   if(!trustedManager(e))return {ok:false,error:'非当前管理页面'};
   const mode=['ghost','normal','hidden'].includes(value?.mode)?value.mode:'ghost',active=value?.active===true;
   let regions=directRegions;
   try{if(value?.regions!==undefined)regions=cleanSceneRegions(value.regions);else if(active&&mode==='normal'&&!directEditor.active)throw Error('现场布局区域尚未就绪');}catch(error){return {ok:false,error:error.message};}
   if(value?.gestureActive!==undefined&&typeof value.gestureActive!=='boolean')return {ok:false,error:'现场手势状态无效'};
   const returnManagerFocus=directEditor.active&&!(active&&mode==='normal')&&!closeBusy&&!closingManager&&!quitting&&!manager.isMinimized();
   const enterSceneFocus=!directEditor.active&&active&&mode==='normal'&&!closeBusy&&!closingManager&&!quitting&&!manager.isMinimized();
   directRegions=regions;referenceGestureActive=value?.gestureActive===true;
   reference={active,paused:manager.isMinimized(),mode};
   if(!active||mode!=='normal'){referenceGestureActive=false;sceneDragging=false;}
   apply();
   // This hand-off belongs to the explicit mode request. Layout changes and
   // automatic panel placement keep using showInactive without refocusing.
   if(enterSceneFocus&&sceneInteractive()){
    referenceInteracting=true;setSceneFocusable(true);if(!win.isFocused())win.focus();
    recordSceneInput('modeFocus',{focused:win.isFocused()});publish();persistStatus();
   }
   if(returnManagerFocus&&manager&&!manager.isDestroyed()){manager.show();manager.focus();}
   return {ok:true,...status()};
  });
  ipcMain.handle('wheel-list',e=>{if(!trustedManager(e))return {ok:false,error:'非当前管理页面'};try{return {ok:true,faces:wheelStore.list()};}catch(err){return {ok:false,error:err.message};}});ipcMain.handle('wheel-download',async(e,id)=>{if(!trustedManager(e))return {ok:false,error:'非当前管理页面'};try{return await wheelStore.install(id);}catch(err){return {ok:false,error:err.message};}});
  function writeLayout(input){try{const value=require('./layout.js').clean({...input,stage:desktopScene(settings(),selectedDisplay())}),target=path.join(root,'assets','layout.json');fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2));fs.renameSync(target+'.tmp',target);return {ok:true};}catch(err){return {ok:false,error:String(err.message)};}}
  ipcMain.handle('layout-save',(e,input)=>trustedManager(e)?writeLayout(input):{ok:false,error:'非当前管理页面'});ipcMain.on('layout-save-sync',(e,input)=>{e.returnValue=trustedManager(e)?writeLayout(input):{ok:false,error:'非当前管理页面'};});ipcMain.on('edit-finish',e=>{if(trustedManager(e))closeManager();});ipcMain.on('manager-open',(e,page)=>{if(trustedHost(e))openManager(page);});
  let initialShortcut=DEFAULT_LAYOUT_SHORTCUT;
  try{initialShortcut=normalizeLayoutShortcut(settings().layoutShortcut??DEFAULT_LAYOUT_SHORTCUT);}catch(error){layoutShortcutError=error.message;}
  const registration=registerLayoutShortcut(initialShortcut,false);
  if(!registration.ok){layoutShortcut=initialShortcut;layoutShortcutError=registration.error;shortcutReady=true;}
  trayController=createDesktopTray({Tray,nativeImage,root,tooltipSuffix:shortcutState().ok?shortcutLabel()+' 编辑':'编辑快捷键未注册',onChange:persistStatus});tray=trayController.tray;refreshTrayMenu();
  const displayChanged=()=>{syncDisplays(true);apply();};
  for(const event of ['display-added','display-removed','display-metrics-changed']){
   screen.on(event,displayChanged);unwatch.push(()=>screen.removeListener(event,displayChanged));
  }
  unwatch.push(watchFiles(path.dirname(config),[path.basename(config)],()=>readSettings(),reportError));
  unwatch.push(watchFiles(path.dirname(controlFile),[path.basename(controlFile)],readControl,reportError));
  const isSource=file=>/\.(js|css|html)$/i.test(file)&&!file.startsWith('desktop-')&&file!=='tray-wheel-icon.js';
  unwatch.push(watchFiles(root,fs.readdirSync(root).filter(isSource),requestReload,reportError,isSource));
  const assets=path.join(root,'assets'),isAsset=file=>/\.(js|css|html|png|svg|json)$/i.test(file);
  unwatch.push(watchFiles(assets,fs.readdirSync(assets).filter(isAsset),files=>{
   if(files.includes('layout.json'))publishLayoutChange();
   if(files.some(file=>file!=='layout.json'))requestReload();
  },reportError,isAsset));
  for(const folder of ['materials','wheel-packs']){
   const directory=path.join(assets,folder);
   const files=fs.existsSync(directory)?fs.readdirSync(directory).filter(isAsset):[];
   if(folder==='wheel-packs')for(const {id} of wheelCatalog)files.push(id+'.json');
   unwatch.push(watchFiles(directory,files,filesChanged=>{
    if(folder==='materials'){requestReload();return;}
    const ids=filesChanged.filter(file=>file.endsWith('.json')).map(file=>file.slice(0,-5));
    if(!ids.length)return;
    for(const id of ids)pendingPackIds.add(id);
    obsRevision++;publishObsState();publishWheelResources();
   },reportError,isAsset));
  }
  apply();publishLayoutChange();publishObsState();
  let autoDisplay=selectedDisplay().id;
  // Preserve “automatic: mouse display”. This timer reads only cursor/display
  // metadata; no files, subprocesses or window work unless the target changes.
  timer=setInterval(()=>{
   if(quitting||settings().monitor>0||manager&&!manager.isDestroyed())return;
   const id=selectedDisplay().id;
   if(id!==autoDisplay){autoDisplay=id;apply();}
  },300);

 });
 app.on('before-quit',event=>{if(manager&&!manager.isDestroyed()){event.preventDefault();closeManager(true);}else allowHudClose=true;});
 app.on('will-quit',()=>{finishShutdownRequest('exiting');quitting=true;clearInterval(timer);clearTimeout(reloadTimer);clearTimeout(configRetry);clearTimeout(obsStateRetry);clearTimeout(persistTimer);for(const stop of unwatch)stop();displays?.dispose();trayController?.dispose();globalShortcut.unregisterAll();});app.on('window-all-closed',()=>{clearInterval(timer);app.quit();});
}
