'use strict';
// Theme-based instruments. Only finite game values enter the display; the
// photographed wheel and its calibrated display rectangle remain unchanged.
window.DashRenderer=(()=>{
 const canvas=document.createElement('canvas');canvas.width=780;canvas.height=248;
 const c=canvas.getContext('2d'),theme=window.OverlayTheme;
 const colors=theme.colors,fonts=theme.dashboard;let previous=null,paints=0,reuses=0,totalMs=0,maxMs=0;
 function label(value,x,y,size,color=colors.text){c.font=`600 ${size}px ${theme.font}`;c.fillStyle=color;c.fillText(String(value),x,y);}
 function prepare(state,page=1){
  const g=state.game||{},live=g.available===true,known=v=>live&&Number.isFinite(v);
  const gear=live&&(Number.isFinite(g.gear)||typeof g.gear==='string')?(Number(g.gear)===-1?'R':Number(g.gear)===0?'N':g.gear):'—';
  const rpm=known(g.rpm)?Math.round(g.rpm):'—',speed=known(g.speedKmh)?Math.round(g.speedKmh):'—';
  const pct=known(g.rpmPercent)?g.rpmPercent/100:known(g.rpm)&&known(g.maxRpm)&&g.maxRpm>0?g.rpm/g.maxRpm:null;
  const fill=pct===null?0:Math.max(0,Math.min(1,pct));
  return {gear,rpm,speed,fill,page,key:JSON.stringify([gear,rpm,speed,fill,page])};
 }
 function paint({gear,rpm,speed,fill,page,key},angle=null){
  const marker=page===1&&Number.isFinite(angle)?angle:null,paintKey=key+':'+marker;
  if(paintKey===previous){reuses++;return canvas;}previous=paintKey;paints++;const started=performance.now();
  c.clearRect(0,0,780,248);c.fillStyle=colors.panel;c.fillRect(0,0,780,248);c.textAlign='center';c.textBaseline='middle';
  c.strokeStyle=colors.border+'66';c.lineWidth=2;c.beginPath();for(const x of [263,517]){c.moveTo(x,52);c.lineTo(x,190);}c.stroke();
  label(rpm,140,107,fonts.value);label(speed,640,107,fonts.value);
  label('RPM',140,164,fonts.caption,colors.muted);label('km/h',640,164,fonts.caption,colors.muted);
  c.save();c.translate(390,116);c.rotate(-(marker??0)*Math.PI/180);label(gear,0,0,fonts.gear);c.restore();
  c.fillStyle=colors.track;c.fillRect(18,220,744,14);c.fillStyle=fill>.95?colors.danger:fill>.8?colors.warning:colors.throttle;c.fillRect(18,220,744*fill,14);
  if(marker!==null){const x=Math.max(22,Math.min(758,390-marker*3));c.fillStyle=colors.accent;c.fillRect(x-3,12,6,18);}
  const elapsed=performance.now()-started;totalMs+=elapsed;maxMs=Math.max(maxMs,elapsed);
  return canvas;
 }
 return {prepare,paint,render:(state,page)=>paint(prepare(state,page),state.angle),getError:()=>'',getPaintCount:()=>paints,getPerformance:()=>({builds:paints,reuses,totalMs,maxMs,pixels:780*248})};
})();
