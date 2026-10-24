'use strict';
importScripts('telemetry-context.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','assist.js');
const model=new DrivingAssist.Model();
self.onmessage=({data})=>{
 const start=performance.now(),view=model.update(data.state,data.now);
 self.postMessage({id:data.id,view,costMs:performance.now()-start});
};
