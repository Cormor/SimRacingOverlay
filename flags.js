'use strict';
// iRacing SessionFlags -> a short Chinese flag name and a plain-language hint.
// Priority is explicit so one banner can be shown without stacking.
(function(root){
 const DEF=[
  {bits:0x10,name:'红旗',short:'停车',desc:'比赛停止，立即减速停车',color:'#ff4d4d',priority:100},
  {bits:0x100|0x8000,name:'黄旗挥动',short:'准备停车',desc:'严重危险，准备停车',color:'#ffb020',priority:95},
  {bits:0x8|0x4000,name:'黄旗',short:'减速禁超',desc:'前方危险，减速且禁止超车',color:'#ffd23f',priority:90},
  {bits:0x20000,name:'取消资格',short:'退出比赛',desc:'已被取消本场比赛资格',color:'#f2f4f8',priority:99},
  {bits:0x100000,name:'维修旗',short:'进站维修',desc:'车辆损伤，需要进站维修',color:'#ff9f5a',priority:88},
  {bits:0x10000,name:'黑旗',short:'进站/处罚',desc:'必须进站或接受处罚',color:'#f2f4f8',priority:85},
  {bits:0x20,name:'蓝旗',short:'让车',desc:'后方快车接近，让出赛车线',color:'#4da3ff',priority:80},
  {bits:0x2,name:'白旗',short:'最后一圈',desc:'进入比赛最后一圈',color:'#f5f7fa',priority:70},
  {bits:0x40,name:'杂物旗',short:'避让碎片',desc:'赛道有碎片，注意避让',color:'#ff9f5a',priority:60},
  {bits:0x4,name:'绿旗',short:'恢复比赛',desc:'赛道恢复，继续比赛',color:'#38e07b',priority:50},
  {bits:0x1,name:'方格旗',short:'结束',desc:'比赛结束',color:'#eef2f6',priority:40},
  {bits:0x200,name:'一圈后绿旗',short:'准备重启',desc:'准备重新开始',color:'#38e07b',priority:30},
 ];
 function current(flags){
  const n=flags;
  if(!Number.isInteger(n)||n<0||n>0xffffffff)return null;
  const v=n>>>0,hits=DEF.filter(f=>(v&f.bits)!==0).sort((a,b)=>b.priority-a.priority);
  return hits[0]||null;
 }
 function forGame(game,fresh=true){return fresh&&game?.available===true&&game.source==='iRacing-SDK'&&game.paused!==true&&game.inMenu!==true?current(game.statuses?.sessionFlags):null;}
 const api={current,forGame,DEF};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Flags=api;
})(typeof window!=='undefined'?window:globalThis);
