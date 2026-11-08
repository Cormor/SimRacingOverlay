'use strict';
ComponentRuntime.register('animation', {
 id:'example.calm',version:'1.0.0',label:'柔和呼吸（示例）',
 description:'1200毫秒周期，只改变反馈的明暗。',
 contract:'pedal-traction.v1',requires:['signal','duration'],provides:[],
 create(){
  let signal=null,since=null;
  return {
   reset(){signal=null;since=null;},
   sample(semantic,now,reduced){
    if(reduced){this.reset();return {opacity:1,glow:0,nextAt:null};}
    if(signal!==semantic.signal||since===null){signal=semantic.signal;since=now;}
    const pulse=.5+.5*Math.cos((now-since)/1200*Math.PI*2);
    return {opacity:.8+.2*pulse,glow:2*pulse,nextAt:now+1000/30};
   }
  };
 }
});
