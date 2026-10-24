'use strict';
const assert=require('node:assert/strict'),{Observer}=require('../chassis-response');
function game(steer,yaw,v=20,beta=.002){return {available:true,speedKmh:v*3.6,localVelocity:[Math.tan(beta)*v,0,v],steeringWheelAngle:steer,yawRate:yaw,vehicleGeometry:{wheelbaseM:2.5,steeringRatio:20,source:'synthetic-known-geometry'},gas:.4,brake:0};}
function warm(m,start=0,v=20,length=50){let out;for(let t=0;t<=2400;t+=20)out=m.update(game(.3,v*.3/length,v),start+t);assert(out.evidence.neutralYawRate,'known geometry defines a neutral yaw reference');return start+2400;}
// A low body slip angle is not proof of unused steering response.
{
 const m=new Observer();let t=warm(m),out,firstWarning=null;
 for(let i=1;i<=80;i++){const steer=.3+i*.012,yaw=20*Math.min(steer,.5)/50;out=m.update(game(steer,yaw),t+i*20);if(out.understeer>.5&&firstWarning===null)firstWarning=i;}
 assert(firstWarning!==null&&firstWarning<65,'front response loss is detected while beta stays at 0.11 degrees');
 assert(out.frontRemaining<.2&&out.understeer>.8,JSON.stringify(out));
}
// Productive steering with a realistic 120ms response delay must not look saturated.
{
 const m=new Observer();let t=warm(m),worst=0;
 for(let i=1;i<=80;i++){const steer=.3+i*.008,old=.3+Math.max(0,i-6)*.008;const out=m.update(game(steer,20*old/50),t+i*20);worst=Math.max(worst,out.understeer);}
 assert(worst<.3,'normal lagged turn-in remains productive: '+worst);
}
// Rear yaw excess/body slip growth must be detected before any countersteer.
{
 const m=new Observer();let t=warm(m),seen=false;
 for(let i=1;i<=35;i++){const beta=-.002-i*.0013,out=m.update(game(i<20?.3:-.15,.12+i*.012,20,beta),t+i*20);if(i<20&&Math.abs(beta)<.05&&out.oversteer>.45)seen=true;}
 assert(seen,'rear instability is visible before three degrees body sideslip');
}
// Missing kinematic observations/geometry are unknown, not a full-green claim.
{
 const m=new Observer(),out=m.update(game(.6,.12),0);assert.equal(out.frontRemaining,null);assert.equal(out.reason,'kinematics-settling');
 const missing=m.update({...game(.6,.12),yawRate:null},20);assert.equal(missing.available,false);assert.equal(missing.frontRemaining,null);
 const reverse=m.update(game(.6,.12,-20),40);assert.equal(reverse.available,false);
}
// Ordinary correctly-followed S bends do not become rear oscillation warnings.
{
 const m=new Observer();let t=warm(m),sway=0;
 for(let i=1;i<=200;i++){const at=i*.02,steer=.3*Math.sin(at*3),old=.3*Math.sin((at-.12)*3);const o=m.update(game(steer,20*old/50,20,.002),t+i*20);sway=Math.max(sway,o.sway);}
 assert(sway<.2,'commanded steering reversals are not uncontrolled sway: '+sway);
}
// Actual alternating residual yaw and body slip produces a distinct sway state.
{
 const m=new Observer();let t=warm(m),sway=0;
 for(let i=1;i<=120;i++){const p=i*.02*10;const o=m.update(game(.1,.04+.4*Math.sin(p),20,-.07*Math.sin(p)),t+i*20);sway=Math.max(sway,o.sway);}
 assert(sway>.4,'alternating yaw error and body slip are identified');
}
// Derivatives do not depend on packet arrival timing or mutate source fields.
{
 const a=new Observer(),b=new Observer();for(let t=0;t<=3000;t+=20){const g=game(.3,.12),raw=JSON.stringify(g);assert.deepEqual(a.update(g,t),b.update(structuredClone(g),t));assert.equal(JSON.stringify(g),raw);}
}
console.log('PASS: small-beta front saturation, productive lagged turn-in, pre-countersteer rear growth, unknown kinematics, commanded S bends vs sway, producer time and input immutability.');

// Identical present kinematics must not depend on the driver's old grip history.
{const a=new Observer(),b=new Observer();for(let t=0;t<2000;t+=20){a.update(game(.8,.8,20,-.1),t);b.update(game(.1,.04,20,.002),t);}let x,y;for(let t=2000;t<=4000;t+=20){const g=game(.3,.12);x=a.update(g,t);y=b.update({...g,gripCoefficient:.2,driverStyle:"different",weather:"rain"},t);}assert.deepEqual(x,y);}
{const m=new Observer();let v;for(let t=0;t<=400;t+=20){const g=game(.4,.16);delete g.vehicleGeometry;v=m.update(g,t);}assert.equal(v.reason,'learned-ratio-wheelbase','missing geometry uses the runtime-learned ratio, not a fixed car table');assert(v.frontRemaining!==null);assert.equal(v.evidence.geometrySource,null);}

// Pure actuator/tyre relaxation at an abrupt turn entry is not front saturation.
{const m=new Observer();for(let t=0;t<=300;t+=20)m.update(game(0,0),t);for(let t=320;t<=400;t+=20){const o=m.update(game(.6,0),t);assert(o.understeer<.2);}const o=m.update(game(.6,.24),440);assert(o.understeer<.2);}

// A wide, low-curvature correction at a real steering angle is normal tyre
// sideslip, not front saturation; the same angle on a tight arc still warns.
{const m=new Observer();let t=warm(m),o;for(let i=1;i<=40;i++)o=m.update(game(.32,.16,35),t+i*20);assert(o.understeer<.2,'wide correction is not understeer: '+o.understeer);assert(o.frontRemaining>.3,'wide correction retains front response');}
{const m=new Observer();let t=warm(m),o;for(let i=1;i<=40;i++)o=m.update(game(1.2,.2,20),t+i*20);assert(o.understeer>.4,'tight arc still reports front saturation: '+o.understeer);assert(o.frontRemaining<.7,'tight arc lowers front response');}
