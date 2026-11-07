'use strict';
// Windows icon uses the same parametrically drawn wheel as the tray.
const fs=require('node:fs'),path=require('node:path');
const {makePNG}=require('../tray-wheel-icon');
const sizes=[16,24,32,48,64,128,256],images=sizes.map(size=>makePNG(size,true));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
images.forEach((data,i)=>{const at=6+i*16;header[at]=header[at+1]=sizes[i]%256;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(data.length,at+8);header.writeUInt32LE(offset,at+12);offset+=data.length;});
fs.writeFileSync(path.join(__dirname,'../assets/app.ico'),Buffer.concat([header,...images]));
