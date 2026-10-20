const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const calls=[],ctx=new Proxy({fillStyle:'#000'},{get(o,k){if(k in o)return o[k];if(k==='createRadialGradient'||k==='createLinearGradient')return ()=>({addColorStop(){}});if(k==='arc')return (...args)=>calls.push({kind:'arc',args});if(k==='fillRect')return (...rect)=>calls.push({kind:'fill',rect,color:o.fillStyle});if(k==='lineTo')return (...args)=>calls.push({kind:'line',args,color:o.strokeStyle});if(k==='moveTo')return (...args)=>calls.push({kind:'move',args});if(k==='roundRect')return (...rect)=>calls.push({kind:'rect',rect,color:o.fillStyle});if(k==='fillText')return function(t,x,y){calls.push({text:t,x,y,color:o.fillStyle});};return ()=>{};},set(o,k,v){o[k]=v;return true;}});
let now=1000;
const sandbox={DrivingAssist:require('../assist.js'),document:{getElementById:()=>({getContext:()=>ctx})},Image:class{},URLSearchParams,location:{search:'?demo=1'},window:{},performance:{now:()=>now},requestAnimationFrame:()=>{},setTimeout:()=>{},fetch:()=>Promise.resolve({json:()=>({})}),console};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../overlay.js'),'utf8'),sandbox);
function draw(fn,input){calls.length=0;sandbox.input=input;vm.runInContext(fn+'(input,true)',sandbox);return [...calls];}
const state={game:{available:true,statuses:{absActive:true,tcActive:false,escActive:null}},handbrake:0};
assert.equal(draw('statuses',state).find(x=>x.text==='ABS').color,'#ffda56');
state.game.statuses.absActive=false;now=1100;
assert.equal(draw('statuses',state).find(x=>x.text==='ABS').color,'#ffda56');
assert.equal(state.game.statuses.absActive,false,'rendering must never change the incoming ABS state');
now=1600;assert(!draw('statuses',state).some(x=>x.text==='ABS'),'ABS must disappear after the hold time');
const wheelState={game:{available:true,speedKmh:60,brake:1,wheels:Array.from({length:4},()=>({ratio:0,omega:35}))}};
wheelState.game.wheels[0]={ratio:-.96,omega:.1};now=2000;assert(!draw('wheelSlip',wheelState).some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'));
now=2085;assert(draw('wheelSlip',wheelState).some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'));
wheelState.game.wheels[0]={ratio:-.2,omega:25};now=2500;assert(!draw('wheelSlip',wheelState).some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'),'warning must clear after recovery');
wheelState.game.speedKmh=0;wheelState.game.wheels[1]={ratio:-1,omega:0};now=3000;draw('wheelSlip',wheelState);now=3200;assert(!draw('wheelSlip',wheelState).some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'),'stationary wheels are not a wheel lock');
wheelState.game.speedKmh=50;wheelState.game.wheels[1]={ratio:-.2,omega:30};now=3500;draw('wheelSlip',wheelState);now=3800;assert(!draw('wheelSlip',wheelState).some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'),'ordinary ABS slip is not a sustained lock');
wheelState.game.wheels[0]={ratio:-1,omega:0};sandbox.airState={fresh:true,unloaded:[true,false,false,false]};calls.length=0;sandbox.input=wheelState;vm.runInContext('wheelSlip(input,true,airState)',sandbox);assert(!calls.some(x=>x.text==='-100%'),'airborne replaces slip/lock percentage');
const f1State={game:{available:true,telemetryVersion:1,speedKmh:209,brake:.61,wheels:[-.021,.034,.078,-.109].map(ratio=>({ratio}))}};
const f1Slip=draw('wheelSlip',f1State);
for(const value of ['-2%','+3%','+8%','-11%'])assert(f1Slip.some(x=>x.text===value),`F1 25 display-only wheel slip must render ${value}`);
assert(!f1Slip.some(x=>x.kind==='rect'&&x.rect[3]===210&&x.color==='#ff1024'),'F1 signed slip must not enter the ACR-only wheel-lock threshold');
const statuses=draw('statuses',state).map(x=>x.text);assert(!statuses.includes('发动机')&&!statuses.includes('限速'));
console.log('PASS: ABS on/hold/off; input immutability; sustained single-wheel lock; recovery; stationary and normal-ABS exclusions; F1 25 signed wheel-slip display; requested indicator set.');

calls.length=0;vm.runInContext('drivingUi({},false,{fresh:false})',sandbox);assert(!calls.some(x=>x.kind==='arc'&&x.args[2]===87),'no ambiguous needle frame in any state');assert(!calls.some(x=>['转向状态','推头','甩尾','转向平衡','待数据'].includes(x.text)));assert(!calls.some(x=>x.text?.includes('°')||x.text?.includes('行程余')),'auxiliary angles and redundant remaining-travel numbers are not rendered');
calls.length=0;vm.runInContext('pedalAssist(930,{mode:"trend",severity:.4})',sandbox);assert(calls.some(x=>x.kind==='move'&&x.args[0]===911&&x.args[1]===406)&&calls.some(x=>x.kind==='line'&&x.args[0]===949&&x.args[1]===406),'release cue starts at TOP, extending down');
console.log('PASS: persistent steering needle frame; no auxiliary degree/travel numbers; top-down pedal-release cue.');

// Front rail is centred exactly at the needle pivot; rear rail is below the rim, not in side gutters.
calls.length=0;vm.runInContext('drivingUi({},false,{fresh:false})',sandbox);
for(const y of [119,787])assert(calls.some(x=>x.kind==='move'&&x.args[0]===260&&x.args[1]===y));
assert(!calls.some(x=>x.kind==='rect'&&x.rect[2]===480),'lateral rails have no filled background panel');
assert(!calls.some(x=>['前轮侧滑','后轮侧滑','左','右'].includes(x.text)));
console.log('PASS: centred 480px unbacked front/rear rails; front aligned with pivot; no lateral explanatory labels.');

// Handling wording and severity colour are visible output, independent of the steering-angle number.
function label(state,severity){calls.length=0;sandbox.a={fresh:true,steering:{mode:'dynamic'},grip:{available:true,needle:.5},handling:{state,label:state==='oversteer'?'甩尾倾向':'推头倾向',severity,action:''}};vm.runInContext('steeringNeedle({},true,a)',sandbox);return calls.find(c=>c.text===aLabel(state));}
function aLabel(state){return state==='oversteer'?'甩尾':'推头';}
assert.notEqual(label('understeer',.2).color,label('understeer',.9).color);assert.notEqual(label('oversteer',.9).color,label('understeer',.9).color);
calls.length=0;vm.runInContext('bar(70,50,"#fff","刹车",true);pedalAssist(70,{label:"松刹",mode:"release",severity:.5})',sandbox);
assert(!calls.some(c=>c.text==='制动滑移'));assert(calls.some(c=>c.text===' 50%'),'actual pedal percentage retained');
console.log('PASS: understeer/oversteer visible labels, severity-dependent palettes, cue card centered below pedal percentage.');

// Current-response palette is independent of confidence; transitions affect presentation only.
assert.equal(vm.runInContext('responseColor(0)',sandbox),'#ff183c');
assert.equal(vm.runInContext('responseColor(1)',sandbox),'#66f0c3');
const visual={fresh:true,grip:{needle:.7,axles:{front:{reserve:{value:.9,low:.7,high:1},support:1,reason:'realtime'}}},drive:{severity:.1},brake:null};
sandbox.visual=visual;vm.runInContext('presentation=null;presentationAt=null;presentationView(visual,1000)',sandbox);
visual.grip.axles.front.reserve={value:.1,low:0,high:.3};visual.grip.needle=.1;
const presented=vm.runInContext('presentationView(visual,1025)',sandbox);
assert(presented.grip.axles.front.reserve.value>.1&&presented.grip.axles.front.reserve.value<.9);
assert.equal(visual.grip.axles.front.reserve.value,.1,'drawing must not mutate raw response');
visual.grip.needle=-.2;visual.drive=null;
const reversed=vm.runInContext('presentationView(visual,1050)',sandbox);assert.equal(reversed.grip.needle,-.2);assert.equal(reversed.drive,null);
assert.equal(vm.runInContext('presentationView({fresh:false},1060).fresh',sandbox),false);
console.log('PASS: continuous green/red palette; 25ms presentation-only transition; no raw mutation; immediate reversal/input exit/stale reset.');

// The semantic endpoints must be visible without reading a guide.
calls.length=0;sandbox.semantic={fresh:true,steering:{mode:'dynamic'},grip:{available:true,needle:-.6,steeringState:{front:.8,rear:.1}},handling:{label:'推头倾向',severity:.8,state:'understeer'}};
vm.runInContext('steeringNeedle({},true,semantic)',sandbox);
assert(calls.some(c=>c.text==='推头'&&c.y===72));for(const label of ['转向状态','推头倾向','转向平衡'])assert(!calls.some(c=>c.text===label));assert(!calls.some(c=>c.kind==='arc'&&c.args[2]===87),'state word replaces the needle and arc, not a second label');
assert(!calls.some(c=>c.text==='收方向'));
console.log('PASS: explicit push/rotate endpoint labels, tendency wording, no steering command.');
// Each side is a FRONT/REAR pair, filling in one shared inward direction.
const direction=(current,estimate=current,danger=0)=>({available:true,current,danger,estimate:{value:estimate,evidence:estimate===current?0:1}});
function railDraw(part,side=0,unloaded=false){calls.length=0;sandbox.part=part;sandbox.side=side;sandbox.air=unloaded;vm.runInContext('wheelLateral(245,40,part,air,true,side)',sandbox);return [...calls];}
const measured={directions:{lateral:direction(.25),longitudinal:direction(.75)}};
let trace=railDraw(measured);
assert(trace.some(c=>c.kind==='fill'&&c.rect[0]===150&&c.rect[2]===47.5&&c.rect[3]===18),'left rail fills inward from left');
trace=railDraw(measured,1);assert(trace.some(c=>c.kind==='fill'&&c.rect[0]===292.5&&c.rect[2]===47.5),'right rail fills inward from right');
const original=trace.filter(c=>c.kind==='fill');const fitted=structuredClone(measured);fitted.directions.lateral=direction(.25,0,1);trace=railDraw(fitted,1);
assert.deepEqual(trace.filter(c=>c.kind==='fill'),original,'outline inference never repaints the measured rail');
trace=railDraw(measured,0,true);assert(trace.some(c=>c.kind==='rect'&&c.rect[2]===190&&c.rect[3]===18));assert(!trace.some(c=>c.kind==='fill'),'unload is a whole empty white outline');
sandbox.rv={fresh:true,grip:{axles:{front:{sides:[{available:true,...measured},{available:true,...measured}],unloadedSides:[false,false]},rear:{sides:[{available:true,...measured},{available:true,...measured}],unloadedSides:[false,false]}}}};
// Distinct four values catch front/rear and left/right swaps, not merely rectangle count.
sandbox.rv.grip.axles.front.sides[0].directions={lateral:direction(.2)};
sandbox.rv.grip.axles.front.sides[1].directions={lateral:direction(.4)};
sandbox.rv.grip.axles.rear.sides[0].directions={lateral:direction(.6)};
sandbox.rv.grip.axles.rear.sides[1].directions={lateral:direction(.8)};
calls.length=0;vm.runInContext('sideLateral(true,rv,0,245);sideLateral(true,rv,1,755)',sandbox);
for(const [x,y,w] of [[150,25,38],[150,51,114],[774,25,76],[698,51,152]])assert(calls.some(c=>c.kind==='fill'&&Math.abs(c.rect[0]-x)<1e-8&&c.rect[1]===y&&Math.abs(c.rect[2]-w)<1e-8),'four tyre routing and symmetric fill');
assert(!calls.some(c=>c.text?.includes('%')),'no false precision');
assert(!calls.some(c=>c.kind==='rect'&&c.rect[2]<c.rect[3]),'no independent longitudinal arm');
for(const x of [70,930]){calls.length=0;sandbox.px=x;vm.runInContext('pedalAssist(px,{severity:.5})',sandbox);assert(calls.some(c=>c.kind==='line'&&c.args[0]===x+19&&c.args[1]===450));}
calls.length=0;vm.runInContext('drivingUi({},true,semantic)',sandbox);assert(!calls.some(c=>c.text?.includes('余度')||c.text?.includes('驱/刹')));
calls.length=0;vm.runInContext('steeringNeedle({},true,{fresh:true,steering:{mode:"static",delta:20},grip:{available:true},handling:{}})',sandbox);assert.equal(calls.length,0);
console.log('PASS: paired 190px lateral rails, upper front/lower rear, symmetric inward fill, outline-only inference, whole empty unloaded rail, no longitudinal arms, pedal border retained.');

// Single, fixed pending location: other widgets never repeat a wait message.
calls.length=0;vm.runInContext('drivingUi({},false,{fresh:false});waitingBadge(true)',sandbox);
const waits=calls.filter(c=>c.text==='待数据');assert.equal(waits.length,1);assert.equal(waits[0].y,283);
calls.length=0;vm.runInContext('waitingBadge(false);steeringNeedle({},true,{fresh:true,steering:{mode:"dynamic"},grip:{available:true,needle:0,steeringState:{front:0,rear:0}},handling:{label:""}})',sandbox);
assert.equal(calls.length,0,'quiet steering area is entirely empty');
assert.equal(vm.runInContext('buttonLightsAvailable({available:true,buttons:Array(8).fill("#000000")})',sandbox),true,'real OFF must not become rainbow');
assert.equal(vm.runInContext('buttonLightsAvailable({available:false,buttons:Array(8).fill("#abcdef")})',sandbox),false,'stale disconnected colours must not be trusted');
assert.equal(vm.runInContext('buttonLightsAvailable({available:true,buttons:Array(8).fill(null)})',sandbox),false);
const colors=vm.runInContext('controls.filter(c=>c.led!==undefined).map(c=>ambientButtonColor(c,1000))',sandbox);
assert(new Set(colors).size>=4,'ambient rainbow is spatially varied, not one solid hue');
assert.notEqual(vm.runInContext('ambientButtonColor(controls[0],1000)',sandbox),vm.runInContext('ambientButtonColor(controls[0],3000)',sandbox));
const input=JSON.stringify(state);vm.runInContext('ambientButtonColor(controls[0],2000,true)',sandbox);assert.equal(JSON.stringify(state),input);
calls.length=0;vm.runInContext('wheelSlip({game:{available:true,speedKmh:30,wheels:Array.from({length:4},()=>({ratio:0,omega:10}))}},true,{fresh:true,unloaded:[false,false,false,false]})',sandbox);assert(!calls.some(c=>c.text==='0%'),'zero slip text does not occupy the corners');
console.log('PASS: one fixed waiting badge; quiet neutral state; conditional handling labels; muted spatial rainbow/time flow; actual OFF preserved; no input mutation or zero-slip labels.');

// Lighting must not be confused with game telemetry; packet advance is the canonical signal.
vm.runInContext('telemetryPresence={packet:null,key:null,lastAdvance:null}',sandbox);
assert.equal(vm.runInContext('telemetryWaiting(null,0)',sandbox),true);
sandbox.tg={available:true,packet:1,carModel:'test',source:'fixture'};
assert.equal(vm.runInContext('telemetryWaiting(tg,100)',sandbox),false);
assert.equal(vm.runInContext('telemetryWaiting(null,500)',sandbox),false,'brief transport gap is not a waiting banner');
assert.equal(vm.runInContext('telemetryWaiting(tg,1500)',sandbox),false);
assert.equal(vm.runInContext('telemetryWaiting(tg,1700)',sandbox),true,'frozen packets remain detectable');
sandbox.tg.packet=2;assert.equal(vm.runInContext('telemetryWaiting(tg,1720)',sandbox),false);
assert(!fs.readFileSync(path.join(__dirname,'../overlay.js'),'utf8').includes('!assistView.fresh||!liveButtonLights'));
console.log('PASS: pending follows game packets, not lights/assist freshness; brief gap tolerance; real stall and immediate recovery.');
