'use strict';
(function(root){
 const signalLabels={'response-increasing':'↑ 响应增加','response-plateau':'＝ 响应持平','response-decreasing':'↓ 响应减少','sustained-slip':'! 持续滑移'};
 function mapColor(value,tokens){
  if(tokens.mode==='standard'||!tokens.mode||typeof value!=='string')return value;
  let rgb,alpha=1;
  const hex=value.match(/^#([a-f0-9]{3,8})$/i),rgba=value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\s*\)$/i);
  if(hex){let h=hex[1];if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');if(h.length!==6&&h.length!==8)return value;rgb=[0,2,4].map(n=>parseInt(h.slice(n,n+2),16));if(h.length===8)alpha=parseInt(h.slice(6),16)/255;}
  else if(rgba){rgb=rgba.slice(1,4).map(Number);alpha=rgba[4]===undefined?1:Number(rgba[4]);}else return value;
  if(alpha===0)return value;
  const [r,g,b]=rgb,high=Math.max(...rgb),low=Math.min(...rgb),light=(r*.2126+g*.7152+b*.0722)/255,saturation=(high-low)/Math.max(1,high);
  let mapped=light<.26?tokens.surface:saturation<.22?tokens.text:r>g*1.35&&r>b*1.05?tokens.danger:r>120&&g>85&&b<g*.8?tokens.caution:tokens.normal;
  if(alpha<1)return mapped+Math.round(alpha*255).toString(16).padStart(2,'0');return mapped;
 }
 function context(native,tokens){
  if(!tokens.mode||tokens.mode==='standard')return native;
  const cache=new Map();return new Proxy(native,{get(target,key){const value=target[key];if(typeof value!=='function')return value;
   if(!cache.has(key))cache.set(key,key==='createLinearGradient'||key==='createRadialGradient'?function(...args){const gradient=value.apply(target,args),add=gradient.addColorStop.bind(gradient);gradient.addColorStop=(at,color)=>add(at,mapColor(color,tokens));return gradient;}:value.bind(target));return cache.get(key);
  },set(target,key,value){if(['fillStyle','strokeStyle','shadowColor'].includes(key))value=mapColor(value,tokens);target[key]=value;return true;}});
 }
 class Renderer{
  constructor(selection={}, {preview=false}={}){
   const R=root.ComponentRuntime,v=R.validateSelection(selection);if(!v.ok)throw Error(v.error);this.selection=v.selection;this.presenter=new R.Presenter(v.selection);this.algorithms=preview?new R.Algorithms(v.selection):null;this.hosts=new Map();this.frames={};
   for(const [id,s]of Object.entries(v.selection)){const d=R.get('algorithm',s.algorithm);if(d.execution==='host')this.hosts.set(id,d.create({component:id}));}
  }
  prepare(input,reduced=false){const semantics={...(this.algorithms?this.algorithms.update({state:input.state,unloaded:input.assist?.unloaded||[false,false,false,false],now:input.now,baseline:input.assist?.drive||input.assist?.brake}):input.assist?.components)};
   for(const [id,instance]of this.hosts)semantics[id]=instance.update(input);this.frames=this.presenter.prepare(semantics,input.now,reduced);return this.frames;
  }
  reconfigure(selection){const R=root.ComponentRuntime,v=R.validateSelection(selection);if(!v.ok)throw Error(v.error);
   for(const [id,s]of Object.entries(v.selection)){const old=this.selection[id];if(old.algorithm!==s.algorithm)throw Error('更换算法需要新的独立预览实例');if(old.animation!==s.animation){this.presenter.instances.get(id)?.dispose?.();this.presenter.instances.set(id,R.get('animation',s.animation).create({component:id}));}}
   this.selection=v.selection;this.presenter.selection=v.selection;
  }
  paint(id,native,bounds,paintBase,scale=1){
   const frame=this.frames[id];if(!frame)return paintBase(native);
   const {tokens,semantic,selection}=frame,[x,y,w,h]=bounds,pedal=id==='throttle'||id==='brake';
   native.save();
   try{
    const paintNative=style=>{
     if(style==='framed'){native.fillStyle=tokens.surface||'#191b1d';native.beginPath();native.roundRect(x-8,y-8,w+16,h+16,10);native.fill();}
     paintBase(id==='wheel'?native:context(native,tokens));
     if(style==='labelled'){
      const label=pedal?signalLabels[semantic.signal]||'— 暂无响应提示':semantic.summary||'— 暂无数据';
      if(label){native.font='600 '+(w<150?15:17)+'px "Microsoft YaHei UI",sans-serif';native.textAlign='center';native.textBaseline='middle';const labelWidth=Math.min(w+32,native.measureText(label).width+16);native.fillStyle=tokens.surface||'#191b1d';native.fillRect(x+w/2-labelWidth/2,y+h+8,labelWidth,24);native.fillStyle=tokens.text||'#f4f1e8';native.fillText(label,x+w/2,y+h+20);}
     }
     if(style==='framed'){native.strokeStyle=tokens.boundary||'#a6b6c8';native.lineWidth=2;native.strokeRect(x-8,y-8,w+16,h+16);}
    };
    if(pedal)paintNative('standard');else this.presenter.render(id,{ctx:native,geometry:{x,y,w,h},scale,paintNative,paintBase:()=>paintBase(context(native,tokens))});
   }finally{native.restore();}
  }
  dispose(){this.presenter.dispose();this.algorithms?.dispose();for(const h of this.hosts.values())try{h.dispose?.();}catch(error){this.lastDisposeError=String(error.message);}this.hosts.clear();}
 }
 root.ComponentRenderer={Renderer,context,mapColor};
})(globalThis);
