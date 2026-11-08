'use strict';
(function(root){
 const kinds=['component','algorithm','presentation','animation','theme'];
 const axes=['algorithm','presentation','animation','theme'];
 const assistances=[{id:'none',label:'默认',description:''},{id:'colorblind',label:'色弱显示辅助',description:'显示响应、轴向和测量点标记。'},{id:'contrast',label:'高对比显示辅助',description:'为文字加黑底。'}];
 const idPattern=/^[a-z][a-z0-9.-]{0,79}$/;
 function createRegistry(){
  const tables=Object.fromEntries(kinds.map(k=>[k,new Map()]));let baselineKeys=new Set();
  function register(kind,definition){
   if(!tables[kind]||!definition||!(kind==='component'?/^[a-z][a-zA-Z0-9.-]{0,79}$/:idPattern).test(definition.id)||typeof definition.label!=='string'||!definition.label||typeof definition.version!=='string'||typeof definition.contract!=='string')throw Error('组件定义格式无效');
   if(tables[kind].has(definition.id))throw Error('组件定义重复：'+definition.id);
   if(['algorithm','animation'].includes(kind)&&typeof definition.create!=='function'||kind==='presentation'&&typeof definition.draw!=='function')throw Error('组件定义缺少实现：'+definition.id);
   if(kind==='component'&&(!definition.defaults||axes.some(axis=>typeof definition.defaults[axis]!=='string')))throw Error('组件缺少完整默认选择');
   if(kind==='theme'&&(!definition.tokens||typeof definition.tokens!=='object'))throw Error('主题缺少样式令牌');
   for(const key of ['requires','provides'])if(definition[key]!==undefined&&(!Array.isArray(definition[key])||definition[key].some(v=>typeof v!=='string')))throw Error('组件能力声明无效');
   if(definition.components!==undefined&&(!Array.isArray(definition.components)||definition.components.some(id=>typeof id!=='string')))throw Error('组件适用范围无效');
   if(definition.execution!==undefined&&!['host','worker'].includes(definition.execution))throw Error('组件计算阶段无效');
   tables[kind].set(definition.id,Object.freeze({...definition,requires:Object.freeze([...(definition.requires||[])]),provides:Object.freeze([...(definition.provides||[])])}));
  }
  const get=(kind,id)=>tables[kind]?.get(id);
  function validateSelection(input={}){
   if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,error:'组件选择必须为对象'};
   const selection={};
   for(const key of Object.keys(input))if(!get('component',key))return {ok:false,error:'未知组件：'+key};
   for(const component of tables.component.values()){
    const selected={...component.defaults,...input[component.id]},algorithm=get('algorithm',selected.algorithm);
    selected.assistance=selected.assistance??'none';
    if(!assistances.some(a=>a.id===selected.assistance))return {ok:false,error:component.label+'的显示辅助模式无效'};
    if(!algorithm||algorithm.contract!==component.contract||algorithm.components&&!algorithm.components.includes(component.id))return {ok:false,error:component.label+'的功能算法不兼容'};
    for(const axis of axes){const definition=get(axis,selected[axis]);
     if(!definition||definition.contract!==component.contract||definition.components&&!definition.components.includes(component.id))return {ok:false,error:component.label+'的'+axis+'不兼容'};
     if(axis!=='algorithm'&&definition.requires.some(cap=>!algorithm.provides.includes(cap)))return {ok:false,error:definition.label+'需要当前算法未提供的能力'};
    }
    selection[component.id]=selected;
   }
   return {ok:true,selection};
  }
  const metadata=d=>({id:d.id,label:d.label,description:d.description||'',version:d.version,contract:d.contract,requires:[...d.requires],provides:[...d.provides],fixed:d.fixed===true,deprecated:d.deprecated===true,replacement:d.replacement||null,execution:d.execution||'worker',family:d.family||null,type:d.type||null,capabilityNote:d.capabilityNote||'',components:d.components||null});
  function catalog(input={}){
   const checked=validateSelection(input),selection=checked.ok?checked.selection:validateSelection({}).selection;
   return {schema:1,selection,error:checked.ok?null:checked.error,components:[...tables.component.values()].map(c=>({...metadata(c),selection:selection[c.id],assistances:assistances.map(a=>({...a})),...Object.fromEntries(axes.map(axis=>[axis+'s',[...tables[axis].values()].filter(d=>d.contract===c.contract&&(!d.components||d.components.includes(c.id))).map(d=>({...metadata(d),...(d.id===c.defaults[axis]&&c.defaultLabels?.[axis]?{label:c.defaultLabels[axis]}:{})}))]))}))};
  }
  class Algorithms{
   constructor(selection={}){const v=validateSelection(selection);if(!v.ok)throw Error(v.error);this.selection=v.selection;this.instances=new Map();this.closed=false;
    try{for(const [id,s]of Object.entries(this.selection)){if(get('algorithm',s.algorithm).execution==='host')continue;const instance=get('algorithm',s.algorithm).create({component:id});if(!instance||typeof instance.update!=='function')throw Error('算法实例缺少update');this.instances.set(id,instance);}}catch(error){this.dispose();throw error;}
   }
   update(input){
    if(this.closed)throw Error('组件计算实例已释放');const output={};
    for(const [id,selected]of Object.entries(this.selection)){
     if(get('algorithm',selected.algorithm).execution==='host')continue;
     let instance=this.instances.get(id);if(!instance){instance=get('algorithm',selected.algorithm).create({component:id});if(!instance||typeof instance.update!=='function')throw Error('算法实例缺少update');this.instances.set(id,instance);}
     const semantic=instance.update(input);
     if(!semantic||semantic.contract!==get('component',id).contract||!['available','unavailable'].includes(semantic.status))throw Error('算法输出契约不匹配：'+id);
     output[id]=semantic;
    }
    return output;
   }
   reset(){for(const x of this.instances.values())x.reset?.();}
   dispose(){if(this.closed)return;this.closed=true;for(const x of this.instances.values())try{x.dispose?.();}catch(error){this.lastDisposeError=String(error.message);}this.instances.clear();}
  }
  class Presenter{
   constructor(selection={}){const v=validateSelection(selection);if(!v.ok)throw Error(v.error);this.selection=v.selection;this.instances=new Map();this.frames={};this.errors={};
    try{for(const [id,s]of Object.entries(this.selection)){const instance=get('animation',s.animation).create({component:id});if(!instance||typeof instance.sample!=='function')throw Error('动画实例缺少sample');this.instances.set(id,instance);}}catch(error){this.dispose();throw error;}
   }
   prepare(semantics,now,reducedMotion=false){
    const frames={};
    for(const [id,s]of Object.entries(this.selection)){
     const definition=get('component',id);let semantic=semantics?.[id];
     if(!semantic||semantic.status!=='available'||!Number.isFinite(semantic.validUntil)||now>=semantic.validUntil)semantic={...semantic,contract:definition.contract,status:'unavailable',signal:null,reason:'no-current-evidence'};
     let instance=this.instances.get(id);if(!instance){instance=get('animation',s.animation).create({component:id});this.instances.set(id,instance);}
     if(semantic.status!=='available')instance.reset?.();
     const motion=semantic.status==='available'?instance.sample(semantic,now,reducedMotion):{opacity:1,glow:0,nextAt:null};
     frames[id]={semantic,motion,tokens:get('theme',s.theme).tokens,selection:s};
    }
    this.frames=frames;return frames;
   }
   draw(id,context){const frame=this.frames[id];if(!frame)return;
    const {ctx,geometry:g}=context;ctx.save();
    try{ctx.beginPath();ctx.rect(g.x-g.w/2-4,g.y-4,g.w+8,g.h+8);ctx.clip();get('presentation',frame.selection.presentation).draw({...context,...frame});}
    finally{ctx.restore();}
   }
   render(id,context){const frame=this.frames[id];if(!frame)return context.paintBase();get('presentation',frame.selection.presentation).draw({...context,...frame});}
   dispose(){for(const x of this.instances.values())try{x.dispose?.();}catch(error){this.lastDisposeError=String(error.message);}this.instances.clear();this.frames={};}
  }
  return {apiVersion:1,register,get,validateSelection,catalog,Algorithms,Presenter,definitions:kind=>[...tables[kind].values()],markBaseline(){baselineKeys=new Set(kinds.flatMap(k=>[...tables[k].keys()].map(id=>k+':'+id)));},extensionKeys:()=>kinds.flatMap(k=>[...tables[k].keys()].map(id=>k+':'+id)).filter(key=>!baselineKeys.has(key))};
 }
 const api=createRegistry();api.createRegistry=createRegistry;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ComponentRuntime=api;
})(globalThis);
