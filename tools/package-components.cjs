#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {inspectPackage}=require('../component-host');
const args=process.argv.slice(2),manifestAt=args.indexOf('--manifest'),outputAt=args.indexOf('--out');
if(manifestAt<0||outputAt<0||!args[manifestAt+1]||!args[outputAt+1])throw Error('用法：node tools/package-components.cjs --manifest <manifest.json> --out <组件包.json>');
const manifest=path.resolve(args[manifestAt+1]),output=path.resolve(args[outputAt+1]),input=JSON.parse(fs.readFileSync(manifest,'utf8'));
if(!Array.isArray(input.entries))throw Error('清单缺少entries');
const files={};for(const name of input.entries){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.js$/.test(name))throw Error('入口必须是同目录JS文件名');files[name]=fs.readFileSync(path.join(path.dirname(manifest),name),'utf8');}
const pack=inspectPackage({...input,files});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(pack,null,2)+'\n');
process.stdout.write('已生成组件包：'+output+'\n');
