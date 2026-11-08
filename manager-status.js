'use strict';
(function(root,factory){
 const status=factory();
 if(typeof module==='object'&&module.exports)module.exports=status;
 if(root)root.ManagerStatus=status;
})(typeof window==='undefined'?null:window,function(){
 function describe(live={}){
  const state=live.state||{},game=state.game||{},source=typeof game.source==='string'?game.source:'',ui=live.ui||{};
  let gameStatus;
  if(game.paused===true)gameStatus={label:'游戏已暂停',detail:source,tone:'info'};
  else if(game.inMenu===true)gameStatus={label:'游戏菜单中',detail:source,tone:'info'};
  else if(game.available!==true)gameStatus={label:'等待游戏数据',detail:source,tone:'info'};
  else if(ui.waiting===true)gameStatus={label:'等待驾驶数据',detail:source,tone:'info'};
  else gameStatus={label:'正在接收',detail:source,tone:'success'};
  const hardware=state.hardware;
  let device;
  if(!hardware)device={label:'正在读取设备',detail:'',tone:'info'};
  else if(hardware.current!==true||!Number.isFinite(hardware.ageMs)||!Number.isFinite(hardware.validForMs)||hardware.ageMs<0||hardware.ageMs>=hardware.validForMs){
   device={label:'设备状态暂不可用',detail:'',tone:'warning'};
  }else{
   // getHardwareStatus has already filtered each device by its own sample age.
   const devices=Array.isArray(state.devices)?state.devices:[];
   device={label:devices.length?devices.length+' 个输入设备':'未检测到输入设备',detail:devices.map(item=>item.name).filter(name=>typeof name==='string'&&name).join(' · '),tone:devices.length?'success':'info'};
  }
  return {game:gameStatus,device};
 }
 return {describe};
});
