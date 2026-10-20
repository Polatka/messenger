const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(){
 const elements=new Map(),storage=new Map(),frames=[];
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={setProperty(){}};this.dataset={};this.attributes={};this.value='';this.textContent='';this.listeners={};this.scrollTop=0;this.clientHeight=400;this.disabled=false;this.open=false;const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,v)=>{v=v??!classes.has(x);if(v)classes.add(x);else classes.delete(x);return v}}}
  append(...children){for(const e of children){e.parent=this;this.children.push(e)}}
  replaceChildren(...c){this.children=[];this.append(...c)}
  remove(){this.parent.children.splice(this.parent.children.indexOf(this),1)}
  get firstChild(){return this.children[0]}
  get scrollHeight(){return this.id==='chatScroll'?500+elements.get('messages').children.length*60:600}
  setAttribute(k,v){this.attributes[k]=v}getAttribute(k){return this.attributes[k]}
  querySelector(){return this.small??=new Element('small')}
  addEventListener(k,fn){this.listeners[k]=fn}
  insertBefore(e){this.append(e)}
  matches(){return this.open}hidePopover(){this.open=false}close(){this.open=false}showModal(){this.open=true}showPopover(){this.open=true}
  getBoundingClientRect(){return {left:500,top:100,bottom:150,width:100}}
 }
 function get(id){if(!elements.has(id)){const e=new Element();e.id=id;elements.set(id,e)}return elements.get(id)}
 const audioContexts=[];
 class Node{constructor(){this.connections=[];this.gain={value:0,cancelScheduledValues(){},setTargetAtTime(v){this.value=v},setValueAtTime(v){this.value=v},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(n){this.connections.push(n)}disconnect(){} }
 class AudioContext{constructor(){this.currentTime=0;this.destination=new Node();audioContexts.push(this)}resume(){return Promise.resolve()}close(){return Promise.resolve()}createMediaStreamSource(){return new Node()}createAnalyser(){const n=new Node();n.fftSize=256;n.getByteTimeDomainData=d=>d.fill(128);return n}createGain(){return new Node()}setSinkId(id){this.sinkId=id;return Promise.resolve()}}
 const sandbox={console,AudioContext,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},performance:{now:()=>100},innerWidth:1180,innerHeight:800,Option:Element,Uint8Array,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length},cancelAnimationFrame(){},navigator:{mediaDevices:{enumerateDevices:async()=>[]}},PolatkaAudio:require('../renderer/audio.js'),document:{getElementById:get,createElement:t=>new Element(t),documentElement:new Element(),querySelector:q=>get(q),querySelectorAll:()=>[],addEventListener(k,fn){get('document').listeners[k]=fn}},window:{RTCPeerConnection:class{},addEventListener(){} }};
 const context=vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8'),context);
 return {get,contexts:audioContexts,run:s=>vm.runInContext(s,context)};
}
test('received messages preserve reader position; own send and new-message button jump to latest',()=>{
 const t=setup(),scroller=t.get('chatScroll');
 t.run("for(let i=0;i<25;i++)renderMessage({name:'Друг',text:'Сообщение '+i,time:Date.now(),color:'#93ed79'})");
 scroller.scrollTop=120;scroller.listeners.scroll();
 t.run("renderMessage({name:'Друг',text:'Новое',time:Date.now(),color:'#93ed79'})");
 assert.equal(scroller.scrollTop,120);assert.equal(t.get('newMessagesButton').classList.contains('hidden'),false);
 t.get('newMessagesButton').onclick();assert.equal(scroller.scrollTop,scroller.scrollHeight);
 scroller.scrollTop=0;scroller.listeners.scroll();
 t.run("renderMessage({name:'Я',text:'Ответ',time:Date.now(),color:'#93ed79',self:true})");
 assert.equal(scroller.scrollTop,scroller.scrollHeight);
});
test('remote audio uses one gain route: 0–200%, deafen, restore, hangup, output device',async()=>{
 const t=setup();await t.run("state.inCall=true;startMeter('remote',{},'remoteAura')");
 const meter=t.run('state.audioMeters.remote');assert.equal(meter.source.connections.length,2);assert.equal(meter.gain.connections[0],meter.context.destination);
 for(const percent of [0,35,100,150,200]){t.get('remoteVolume').oninput({target:{value:String(percent)}});assert.equal(meter.gain.gain.value,percent/100)}
 t.run('toggleDeafen()');assert.equal(meter.gain.gain.value,0);
 t.get('remoteVolume').oninput({target:{value:'180'}});assert.equal(meter.gain.gain.value,0);
 t.run('toggleDeafen()');assert.equal(meter.gain.gain.value,1.8);
 t.get('resetVolume').onclick();assert.equal(meter.gain.gain.value,1);
 await t.run("settings.speaker='headphones';applyOutput()");assert.equal(meter.context.sinkId,'headphones');
 t.run('endCall(false)');assert.equal(meter.gain.gain.value,0);assert.equal(t.get('remoteAudio').muted,true);
});
test('call/chat split switches independently and mic/headphone labels match state',()=>{
 const t=setup();t.run("setPage('voice')");t.get('sideChatButton').onclick();
 assert.equal(t.get('.main-panel').classList.contains('call-chat'),true);assert.equal(t.get('chatPage').classList.contains('hidden'),false);
 t.run("setPage('chat')");assert.equal(t.get('voicePage').classList.contains('hidden'),true);
 t.run("state.inCall=true;toggleMic()");assert.equal(t.get('micButton').getAttribute('aria-label'),'Включить микрофон');
 t.run('toggleDeafen()');assert.equal(t.get('deafenButton').getAttribute('aria-label'),'Включить наушники');
});
test('disabled interface sounds create no audio context',()=>{
 const t=setup();t.run("settings.uiSounds=false;playUiSound()");assert.equal(t.contexts.length,0);
});
