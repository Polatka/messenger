const test=require('node:test');const assert=require('node:assert/strict');const audio=require('../renderer/audio.js');
test('buffer latency uses an interval, not the lifetime average',()=>{const previous={id:'a',jitterBufferDelay:5,jitterBufferEmittedCount:100};const current={id:'a',jitterBufferDelay:5.2,jitterBufferEmittedCount:110};assert.ok(Math.abs(audio.interval(current,previous)-20)<1e-8)});
test('no fabricated zero for missing samples or reset counters',()=>{const a={id:'a',jitterBufferDelay:2,jitterBufferEmittedCount:10};assert.equal(audio.interval(a,null),null);assert.equal(audio.interval(a,a),null);assert.equal(audio.interval({...a,id:'b'},a),null);assert.equal(audio.interval({...a,jitterBufferEmittedCount:1},a),null)});
test('receiver modes are millisecond targets and auto clears target',()=>{const r={jitterBufferTarget:null};audio.tuneReceiver(r,'fast');assert.equal(r.jitterBufferTarget,20);audio.tuneReceiver(r,'balanced');assert.equal(r.jitterBufferTarget,40);audio.tuneReceiver(r,'auto');assert.equal(r.jitterBufferTarget,null);assert.doesNotThrow(()=>audio.tuneReceiver({},'fast'))});
test('capture respects the chosen device and processing toggle without mandatory hardware timing',()=>{const c=audio.constraints({mic:'my-device',echo:false});assert.deepEqual(c.audio.deviceId,{exact:'my-device'});assert.equal(c.audio.echoCancellation,false);assert.equal(c.audio.noiseSuppression,false);assert.deepEqual(c.audio.latency,{ideal:0.01});assert.equal(c.video,false)});

test('microphone amplifier sends processed audio, preserves video, changes gain and frees devices',async()=>{
 const tracks=[];const track=kind=>{const t={kind,readyState:'live',stop(){this.readyState='ended'}};tracks.push(t);return t};
 class Stream{constructor(list){this.list=list}getTracks(){return this.list}getAudioTracks(){return this.list.filter(t=>t.kind==='audio')}getVideoTracks(){return this.list.filter(t=>t.kind==='video')}}
 const nodes=[];const node=()=>{const n={connections:[],disconnects:0,connect(to){this.connections.push(to)},disconnect(){this.disconnects++}};nodes.push(n);return n};let context;
 class Context{constructor(){context=this;this.currentTime=0;this.state='running';this.destination=node();this.closed=0}createMediaStreamSource(s){this.raw=s;return this.source=node()}createGain(){const n=node();n.gain={value:0,cancelScheduledValues(){},setTargetAtTime(value){this.value=value}};return this.gain=n}createDynamicsCompressor(){const n=node();for(const k of['threshold','knee','ratio','attack','release'])n[k]={value:0};return this.limiter=n}createMediaStreamDestination(){const n=node();n.stream=new Stream([track('audio')]);return this.output=n}resume(){return Promise.resolve()}close(){this.closed++;this.state='closed';return Promise.resolve()}}
 const mic=track('audio'),video=track('video'),raw=new Stream([mic,video]);
 const input=await audio.createInput(raw,180,{AudioContext:Context,MediaStream:Stream});
 assert.notEqual(input.stream.getAudioTracks()[0],mic);assert.equal(input.stream.getVideoTracks()[0],video);assert.equal(input.gain.gain.value,1.8);
 assert.deepEqual(context.source.connections,[context.gain]);assert.deepEqual(context.gain.connections,[context.limiter]);assert.deepEqual(context.limiter.connections,[context.output]);assert.ok(nodes.every(n=>!n.connections.includes(context.destination)));
 input.setGain(300);assert.equal(input.gain.gain.value,3);input.setGain(0);assert.equal(input.gain.gain.value,0);input.setGain(900);assert.equal(input.gain.gain.value,3);input.setGain(-10);assert.equal(input.gain.gain.value,0);
 input.stop();input.stop();assert.ok(tracks.every(t=>t.readyState==='ended'));assert.equal(context.closed,1);assert.equal(context.source.disconnects,1);
});
test('microphone processing failure releases captured devices and context',async()=>{
 const raw={getTracks:()=>[mic],getAudioTracks:()=>[mic],getVideoTracks:()=>[]},mic={stopped:false,stop(){this.stopped=true}};let closed=false;
 class Context{createMediaStreamSource(){throw Error('input unavailable')}close(){closed=true;return Promise.resolve()}}
 await assert.rejects(audio.createInput(raw,100,{AudioContext:Context}),/input unavailable/);assert.equal(mic.stopped,true);assert.equal(closed,true);
});
test('microphone gain rejects corrupt settings and clamps allowed range',()=>{
 assert.equal(audio.gainPercent(undefined),100);assert.equal(audio.gainPercent('bad'),100);assert.equal(audio.gainPercent(Infinity),100);assert.equal(audio.gainPercent('175'),175);assert.equal(audio.gainPercent(-10),0);assert.equal(audio.gainPercent(999),300);
});
