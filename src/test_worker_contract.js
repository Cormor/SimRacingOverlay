'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{Model}=require('../assist');
const root=path.resolve(__dirname,'..'),messages=[],scope={performance,console};scope.self=scope;
vm.createContext(scope);scope.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope,{filename:file});};
vm.runInContext(fs.readFileSync(path.join(root,'telemetry-worker.js'),'utf8'),scope,{filename:'telemetry-worker.js'});scope.postMessage=value=>messages.push(value);
const inline=new Model();let id=0;
for(const adaptive of [false,true])for(let t=0;t<=3000;t+=20){const state={connected:true,game:{available:true,source:'fixture',carModel:String(adaptive),packet:++id,sampleTime:t,speedKmh:72,gas:.4,brake:0,localVelocity:[.04,0,20],yawRate:.12,steeringWheelAngle:.4,capabilities:adaptive?{kinematicsProfile:'adaptive-steering-v1'}:{},wheels:Array.from({length:4},()=>({load:null,ratio:null,angle:null}))}};scope.self.onmessage({data:{id,state,now:id*20}});const row=messages.pop(),expected=inline.update(structuredClone(state),id*20);assert.equal(row.id,id);assert.equal(JSON.stringify(row.view),JSON.stringify(expected));}
console.log('PASS: actual classic worker import chain and 302 neutral/adaptive samples equal the inline model');
