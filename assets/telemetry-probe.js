// Read-only SimHub property snapshot. Detect field schemas, never GameName.
var base='DataCorePlugin.',raw=base+'GameRawData.',motion=raw+'PacketMotionExData.';
function p(k){var v=$prop(base+k);return v===undefined?null:v;}
function r(k){var v=$prop(raw+k);return v===undefined?null:v;}
function m(k){var v=$prop(motion+k);return v===undefined?null:v;}
function xyz(prefix,keys){return keys.split(',').map(function(k){return r(prefix+k);});}
function four(k){return [1,2,3,4].map(function(i){return m(k+'0'+i);});}
var start=m('m_header.m_overallFrameIdentifier'),n={},fb={};
'SpeedKmh,Rpms,MaxRpm,Gear,CarModel,Throttle,Brake,Clutch,Handbrake,ABSActive,TCActive,AccelerationSway,AccelerationHeave,AccelerationSurge,TemperatureUnit,TyrePressureUnit'.split(',').forEach(function(k){n[k]=p('GameData.NewData.'+k);});
['FrontLeft','FrontRight','RearLeft','RearRight'].forEach(function(w){
 ['WheelSlip','WheelLock','WheelSpeed'].forEach(function(k){fb[w+k]=p('GameData.NewData.FeedbackData.'+w+k);});
 ['TyrePressure','TyreTemperature'].forEach(function(k){n[k+w]=p('GameData.NewData.'+k+w);});
});
n.FeedbackData=fb;
var native={frameBefore:start,frame:m('m_header.m_overallFrameIdentifier'),session:String(m('m_header.m_sessionUID')),time:m('m_header.m_sessionTime'),worldFrame:r('PacketMotionData.m_header.m_overallFrameIdentifier'),
 ratio:four('m_wheelSlipRatio'),angle:four('m_wheelSlipAngle'),fx:four('m_wheelLongForce'),fy:four('m_wheelLatForce'),load:four('m_wheelVertForce'),speedMs:four('m_wheelSpeed'),
 localVelocity:xyz('PacketMotionExData.','m_localVelocityX,m_localVelocityY,m_localVelocityZ'),angularVelocity:xyz('PacketMotionExData.','m_angularVelocityX,m_angularVelocityY,m_angularVelocityZ'),
 roadWheelAngle:m('m_frontWheelsAngle'),steerInput:r('PlayerCarTelemetryData.m_steer'),
 velocity:xyz('PlayerMotionData.','m_worldVelocityX,m_worldVelocityY,m_worldVelocityZ'),
 forward:xyz('PlayerMotionData.','m_worldForwardDirX,m_worldForwardDirY,m_worldForwardDirZ'),right:xyz('PlayerMotionData.','m_worldRightDirX,m_worldRightDirY,m_worldRightDirZ'),
 accG:xyz('PlayerMotionData.','m_gForceLateral,m_gForceVertical,m_gForceLongitudinal')};
native.frame=m('m_header.m_overallFrameIdentifier');
return JSON.stringify({GameRunning:p('GameRunning'),GamePaused:p('GamePaused'),GameInMenu:p('GameInMenu'),NewData:n,NativeMotion:native});
