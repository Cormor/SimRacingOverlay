'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/ALGORITHM-BASELINE.json')));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const changed=Object.entries(manifest.files).filter(([file,sha])=>!fs.existsSync(path.join(root,file))||(hash(file)!==sha&&crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file)).toString('utf8').replace(/\r\n/g,'\n')).digest('hex')!==manifest.normalizedFiles?.[file])).map(([file])=>file);
if(hash(manifest.archive)!==manifest.archiveSha256)changed.push(manifest.archive);
if(changed.length){console.error('Algorithm baseline differs: '+changed.join(', '));process.exitCode=1;}else console.log('PASS: '+manifest.marker+' source and archive match');
