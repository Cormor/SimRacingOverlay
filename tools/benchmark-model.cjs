'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
function load(source){const sandbox={module:{exports:{}},require:createRequire(path.join(root,'assist.js'))};vm.runInNewContext(source,sandbox);return sandbox.module.exports.Model;}
const models={baseline:load(execFileSync('git',['show','HEAD:assist.js'],{cwd:root,encoding:'utf8'})),candidate:load(fs.readFileSync(path.join(root,'assist.js'),'utf8'))};
function measure(Model,calls){
 const model=new Model(),s={connected:true,game:{available:true,source:'synthetic',packet:0,sampleTime:0,speedKmh:80,gas:.5,brake:.1,localVelocity:[1,0,22],wheels:Array.from({length:4},()=>({angle:.08,ratio:.04,load:3000,fx:1000,fy:1000}))}};
 const cpu=process.cpuUsage(),start=performance.now();
 for(let i=0;i<calls;i++){if(i%4===0){s.game.packet++;s.game.sampleTime=i*1000/240;}model.update(s,i*1000/240);}
 return {wallMs:performance.now()-start,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000};
}
for(const Model of Object.values(models))measure(Model,4000);
const results={baseline:[],candidate:[],workload:{calls:60000,uniqueSamples:15000,rounds:4,clock:'60 Hz telemetry / 240 Hz consumers'}};
for(let round=0;round<4;round++)for(const key of round%2?['candidate','baseline']:['baseline','candidate'])results[key].push(measure(models[key],60000));
const median=values=>values.sort((a,b)=>a-b).slice(1,3).reduce((a,b)=>a+b,0)/2;
results.medianCpuMs=Object.fromEntries(['baseline','candidate'].map(key=>[key,median(results[key].map(x=>x.cpuMs))]));
results.cpuReduction=1-results.medianCpuMs.candidate/results.medianCpuMs.baseline;
console.log(JSON.stringify(results,null,2));
