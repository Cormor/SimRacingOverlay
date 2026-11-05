'use strict';
// Steering-wheel icon 1.0. Canonical reusable source: SoftwareCompany/design/icons/steering-wheel/.
// Project copies are vendors. Geometry/PNG generation only; no Electron, device or IPC state.
const {deflateSync}=require('node:zlib');
const VERSION='1.0';
const SIZES=Object.freeze([16,20,24,32]);
const PALETTE=Object.freeze({
  gray:Object.freeze({foreground:'#D6D6D6',edge:'#5B5B5B'}),
  gold:Object.freeze({foreground:'#F4D06F',edge:'#876400'})
});
const SPOKES=Object.freeze([[6,12,13,16],[26,12,19,16],[16,19,16,27]].map(Object.freeze));
const GEOMETRY=Object.freeze({size:32,cx:16,cy:16,rimRadius:12,stroke:3,hubRadius:3,outline:.75,spokes:SPOKES});

function iconSvg({connected=false,size=32}={}) {
  if(!Number.isInteger(size)||size<1||size>1024)throw new RangeError('Invalid icon size');
  const c=PALETTE[connected?'gold':'gray'];
  const spokes=SPOKES.map(([x1,y1,x2,y2])=>`M${x1} ${y1}L${x2} ${y2}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><g fill="none" stroke="${c.edge}" stroke-width="4.5" stroke-linecap="round"><circle cx="16" cy="16" r="12"/><path d="${spokes}"/></g><circle cx="16" cy="16" r="3.75" fill="${c.edge}"/><g fill="none" stroke="${c.foreground}" stroke-width="3" stroke-linecap="round"><circle cx="16" cy="16" r="12"/><path d="${spokes}"/></g><circle cx="16" cy="16" r="3" fill="${c.foreground}"/></svg>\n`;
}
function segmentDistance(x,y,[ax,ay,bx,by]) {
  const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-ax-t*dx,y-ay-t*dy)-1.5;
}
function signedDistance(x,y) {
  const radius=Math.hypot(x-16,y-16);
  let d=Math.min(Math.abs(radius-12)-1.5,radius-3);
  for(const spoke of SPOKES)d=Math.min(d,segmentDistance(x,y,spoke));
  return d;
}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
function makeRGBA(size,connected=false) {
  if(!Number.isInteger(size)||size<1||size>256)throw new RangeError('Invalid raster size');
  const c=PALETTE[connected?'gold':'gray'],foreground=rgb(c.foreground),edge=rgb(c.edge);
  const pixels=Buffer.alloc(size*size*4),samples=4,total=samples*samples;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    let alpha=0,r=0,g=0,b=0;
    for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++) {
      const d=signedDistance((x+(sx+.5)/samples)*32/size,(y+(sy+.5)/samples)*32/size);
      if(d>.75)continue;
      const color=d<=0?foreground:edge;alpha++;r+=color[0];g+=color[1];b+=color[2];
    }
    if(alpha) {const at=(y*size+x)*4;pixels[at]=Math.round(r/alpha);pixels[at+1]=Math.round(g/alpha);pixels[at+2]=Math.round(b/alpha);pixels[at+3]=Math.round(alpha/total*255);}
  }
  return pixels;
}
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let bit=0;bit<8;bit++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data) {let c=0xFFFFFFFF;for(const byte of data)c=CRC_TABLE[(c^byte)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function chunk(type,data) {
  const kind=Buffer.from(type,'ascii'),out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length,0);kind.copy(out,4);data.copy(out,8);
  out.writeUInt32BE(crc32(Buffer.concat([kind,data])),out.length-4);return out;
}
function makePNG(size,connected=false) {
  const rgba=makeRGBA(size,connected),stride=size*4,rows=Buffer.alloc((stride+1)*size);
  for(let y=0;y<size;y++)rgba.copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride);
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={VERSION,SIZES,PALETTE,GEOMETRY,iconSvg,makeRGBA,makePNG};
