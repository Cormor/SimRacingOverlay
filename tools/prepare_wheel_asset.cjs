// Deterministic official-photo cutout. No generated or repainted product pixels.
// Run: runtime\electron\electron.exe tools\prepare_wheel_asset.cjs <pack directory>
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const directory=path.resolve(process.argv[2]||path.join(__dirname,'../wheel-packs/simagic-gt-pro-round'));
const geometry=JSON.parse(fs.readFileSync(path.join(directory,'geometry.json'))),photo=fs.readFileSync(path.join(directory,'source.jpg'));
if(crypto.createHash('sha256').update(photo).digest('hex')!==geometry.sourceSha256)throw Error('Official source image differs from the measured source');
app.setPath('userData',path.resolve(process.argv[3]||path.join(directory,'../../build/asset-profile')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 try{
  await win.loadURL('data:text/html,<canvas id="c" width="1315" height="1197"></canvas>');
  const source='data:image/jpeg;base64,'+photo.toString('base64');
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const g=${JSON.stringify(geometry)},image=new Image();image.src=${JSON.stringify(source)};await image.decode();
   if(image.naturalWidth!==g.sourceSize[0]||image.naturalHeight!==g.sourceSize[1])throw Error('Source dimensions differ');
   const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');c.save();c.translate(...g.outputCenter);const scale=g.outputRadius/g.radius;c.scale(scale,scale);c.translate(-g.center[0],-g.center[1]);
   c.beginPath();c.arc(...g.center,g.radius,0,Math.PI*2);c.clip();c.drawImage(image,0,0,...g.measurementSize);
   if(g.indicatorClean){const repair=g.indicatorClean;c.save();c.beginPath();c.rect(...repair.targetRect);c.clip();c.drawImage(image,...repair.sourceRect.map(v=>v*2),...repair.targetRect);c.restore();}
   const uncut=c.getImageData(0,0,1315,1197);
   c.globalCompositeOperation='destination-out';c.fill(new Path2D(g.top));const side=new Path2D(g.left);c.fill(side);if(g.right)c.fill(new Path2D(g.right));else{c.save();c.translate(g.center[0]*2,0);c.scale(-1,1);c.fill(side);c.restore();}
   const cut=c.getImageData(0,0,1315,1197);if(g.preserveRedSeam){for(let y=0;y<1197;y++)for(let x=0;x<1315;x++){const n=(y*1315+x)*4,dx=(x-g.outputCenter[0])/scale,dy=(y-g.outputCenter[1])/scale,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx)*180/Math.PI;if(r<270||r>330||Math.abs(a+90)<3)continue;const R=uncut.data[n],G=uncut.data[n+1],B=uncut.data[n+2];if(R>35&&R-G>12&&R-B>12&&uncut.data[n+3]>0){for(let k=0;k<4;k++)cut.data[n+k]=uncut.data[n+k];}}c.putImageData(cut,0,0);}
   const pixels=cut.data;let transparent=0;for(let i=3;i<pixels.length;i+=4)if(!pixels[i])transparent++;
   const imageData=canvas.toDataURL('image/png'),material=new Image();material.src=imageData;await material.decode();c.restore();c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.fillStyle='#edf0f3';c.fillRect(0,0,1315,1197);c.drawImage(material,0,0);const light=canvas.toDataURL('image/png').split(',')[1];for(let y=0;y<1197;y+=48)for(let x=0;x<1315;x+=48){c.fillStyle=(x/48+y/48)%2?'#8b929a':'#d7dce1';c.fillRect(x,y,48,48);}c.drawImage(material,0,0);return {image:imageData.split(',')[1],transparent,light,checker:canvas.toDataURL('image/png').split(',')[1]};
  })()`);
  if(process.argv[4]){const output=path.resolve(process.argv[4]);fs.mkdirSync(output,{recursive:true});for(const name of ['light','checker'])fs.writeFileSync(path.join(output,'wheel-'+name+'.png'),Buffer.from(result[name],'base64'));}
  const png=Buffer.from(result.image,'base64');fs.writeFileSync(path.join(directory,'wheel.png'),png);
  const packFile=path.join(directory,'profile.json');if(fs.existsSync(packFile)){const pack=JSON.parse(fs.readFileSync(packFile));pack.image='data:image/png;base64,'+png.toString('base64');require('../wheel-profile').validate(pack);const bytes=Buffer.from(JSON.stringify(pack,null,2)+'\n');fs.writeFileSync(packFile,bytes);const catalogFile=path.join(__dirname,'../assets/wheel-catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogFile));const entry=catalog.find(v=>v.id===pack.id);if(entry){entry.sha256=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');}}
  console.log(JSON.stringify({sourceSha256:geometry.sourceSha256,outputSha256:crypto.createHash('sha256').update(png).digest('hex'),transparentPixels:result.transparent,sourceUrl:geometry.sourceUrl}));
 }catch(e){console.error(e);process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
});
