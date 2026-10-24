'use strict';
(function(root){
 const palettes={response:[[0,'#ff183c'],[.15,'#ff623f'],[.4,'#ffc34e'],[.7,'#beed65'],[1,'#66f0c3']],ambient:['#e5a0b0','#e6b184','#e0cd83','#aed498','#8bd3bc','#91bfe6','#b4aae6','#d5a4df']};
 palettes.slip={
 drive:[[0,'#6ef4df'],[.10,'#65f3b2'],[.25,'#c9f45b'],[.50,'#ffe15b'],[.75,'#ffac45'],[1,'#ff6ac7'],[1.5,'#dc74ff'],[2.5,'#aa87ff'],[4,'#7bb8ff']],
 brake:[[0,'#6ef4df'],[.10,'#66d9ff'],[.25,'#8fafff'],[.50,'#c48aff'],[.75,'#e575ec'],[1,'#ff70bb'],[1.5,'#d276ff'],[2.5,'#9b8cff'],[4,'#73c1ff']]
};
 palettes.handling={understeer:['#edfaff','#6ce6dd','#e2ef69','#ffb147','#ff653d','#ff2047'],oversteer:['#edfaff','#87cbff','#a89dff','#df77e0','#ff558e','#ff234d'],both:['#edfaff','#aee893','#f0e56b','#ffac48','#ff5e42','#ff1749']};
 const theme=Object.freeze({palettes,dashboard:Object.freeze({gear:128,value:56,caption:26}),version:'ue-editor-v1',font:'"Cascadia Mono","Microsoft YaHei UI",monospace',colors:Object.freeze({text:'#edf5ff',muted:'#a4b7cc',track:'#1c2938',border:'#73879d',panel:'#111923',accent:'#62d9ff',brake:'#ff5673',throttle:'#65e3ad',warning:'#ffc75a',danger:'#ff365d',estimateFront:'#83d7f2',estimateRear:'#f6bd84'}),sizes:Object.freeze({caption:16,label:20,value:32,secondary:24,primary:28,headline:40,wheelKnob:29,wheelButton:23,flagTitle:28,flagHint:18}),radii:Object.freeze({bar:6,badge:10,panel:12})});
 if(typeof module!=='undefined'&&module.exports)module.exports=theme;else root.OverlayTheme=theme;
})(typeof window!=='undefined'?window:globalThis);
