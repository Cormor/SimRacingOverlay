'use strict';
// This marker identifies a historical archive; current release identity is bound
// separately by its Git tag, native-build receipt and package PAYLOAD manifest.
const path=require('node:path'),{spawnSync}=require('node:child_process');
const result=spawnSync(process.platform==='win32'?'python':'python3',[path.resolve(__dirname,'../tools/verify_algorithm_archive.py')],{stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exitCode=1;}
else process.exitCode=result.status===null?1:result.status;
