'use strict';
(function(root){
 function wrap(native,opacity){const cache=new Map(),kinds={fill:'image',stroke:'image',fillRect:'image',strokeRect:'image',drawImage:'image',fillText:'text',strokeText:'text'};
  return new Proxy(native,{get(target,key){const value=target[key];if(typeof value!=='function')return value;if(!cache.has(key))cache.set(key,kinds[key]?function(...args){const old=Number.isFinite(target.globalAlpha)?target.globalAlpha:1,factor=opacity(kinds[key]);target.globalAlpha=old*factor;try{return value.apply(target,args);}finally{target.globalAlpha=old;}}:value.bind(target));return cache.get(key);},set(target,key,value){target[key]=value;return true;}});
 }
 const api={wrap};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OpacityPaint=api;
})(typeof window!=='undefined'?window:globalThis);
