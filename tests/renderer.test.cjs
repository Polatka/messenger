const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function setup(initialStorage=[]){
 const elements=new Map(),storage=new Map(initialStorage),frames=[];
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
  play(){return Promise.resolve()}pause(){}
  getBoundingClientRect(){return {left:500,top:100,bottom:150,width:100}}
 }
 function get(id){if(!elements.has(id)){const e=new Element();e.id=id;elements.set(id,e)}return elements.get(id)}
 const audioContexts=[];
 class Node{constructor(){this.connections=[];this.gain={value:0,cancelScheduledValues(){},setTargetAtTime(v){this.value=v},setValueAtTime(v){this.value=v},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}}connect(n){this.connections.push(n)}disconnect(){} }
 class AudioContext{constructor(){this.currentTime=0;this.destination=new Node();audioContexts.push(this)}resume(){return Promise.resolve()}close(){return Promise.resolve()}createMediaStreamSource(){return new Node()}createAnalyser(){const n=new Node();n.fftSize=256;n.getByteTimeDomainData=d=>d.fill(128);return n}createGain(){return new Node()}setSinkId(id){this.sinkId=id;return Promise.resolve()}}
 const sandbox={console,AudioContext,crypto:{randomUUID:require('node:crypto').randomUUID},performance:{now:()=>100},innerWidth:1180,innerHeight:800,Option:Element,Uint8Array,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length},cancelAnimationFrame(){},navigator:{mediaDevices:{enumerateDevices:async()=>[]}},PolatkaAudio:require('../renderer/audio.js'),document:{getElementById:get,createElement:t=>new Element(t),documentElement:new Element(),querySelector:q=>get(q),querySelectorAll:()=>[],addEventListener(k,fn){get('document').listeners[k]=fn}},window:{RTCPeerConnection:class{},addEventListener(){} }};
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
test('guest role persists and cannot create invitations or confirm an answer',async()=>{
 const room='3a1542c1-1d95-4dc2-b774-24e9add6fa2a';
 const t=setup([['polatka.lastRoom',JSON.stringify({id:room,name:'Лобби друга',role:'guest'})]]);
 assert.equal(t.run('state.role'),'guest');
 assert.equal(t.get('hostTab').disabled,true);assert.equal(t.get('roomInput').disabled,true);
 assert.equal(t.get('disconnectButton').textContent,'Выйти из лобби');
 await assert.rejects(t.run('createInvite()'),/только владелец/);
 await assert.rejects(t.run('acceptAnswer()'),/только владелец/);
 t.run("tab(true)");assert.equal(t.get('hostFlow').classList.contains('hidden'),true);
 t.run('saveRoom()');assert.equal(t.run("JSON.parse(localStorage.getItem('polatka.lastRoom')).role"),'guest');
 t.run('leaveLobby()');assert.equal(t.run('state.role'),'owner');assert.notEqual(t.run('state.room'),room);assert.equal(t.get('hostTab').disabled,false);
});
test('stable message IDs permit author deletion while rejecting duplicate, malformed and foreign deletes',()=>{
 const t=setup();
 t.run("globalThis.packets=[];state.connected=true;state.remote.capabilities=['message-delete-v1'];globalThis.channel={readyState:'open',bufferedAmount:0,send:s=>packets.push(JSON.parse(s))};attachData(channel)");
 t.get('messageInput').value='Моё сообщение';t.get('messageForm').onsubmit({preventDefault(){}});
 const ownId=t.run('state.messages[0].id');assert.match(ownId,/^[a-f0-9-]{36}$/);
 assert.equal(t.run('packets[0].id'),ownId);
 t.run(`channel.onmessage({data:JSON.stringify({type:'message-delete',id:'${ownId}'})})`);assert.equal(t.run('state.messages.length'),1);
 const remoteId='846a54cd-5902-44cd-b451-1c3d66755db7';
 t.run(`channel.onmessage({data:JSON.stringify({type:'message',id:'${remoteId}',text:'От друга'})})`);
 t.run(`channel.onmessage({data:JSON.stringify({type:'message',id:'${remoteId}',text:'Повтор'})})`);
 t.run("channel.onmessage({data:JSON.stringify({type:'message',id:'bad-id',text:'Повреждённое'})})");
 assert.equal(t.run('state.messages.length'),2);
 assert.equal(t.run(`deleteMessage('${remoteId}',true)`),undefined);assert.equal(t.run('state.messages.length'),2);
 t.run(`channel.onmessage({data:JSON.stringify({type:'message-delete',id:'${remoteId}'})})`);assert.equal(t.run('state.messages.length'),1);
 assert.equal(t.run(`deleteMessage('${ownId}',true)`),true);assert.equal(t.run("packets.at(-1).type"),'message-delete');assert.equal(t.run('state.messages.length'),0);
 t.run('loadMessages()');assert.equal(t.get('messages').children.length,0);
 t.run(`channel.onmessage({data:JSON.stringify({type:'message',id:'${remoteId}',text:'Повтор после удаления'})})`);assert.equal(t.run('state.messages.length'),0);
});
test('legacy messages remain locally deletable and closed channels cannot affect the current room',()=>{
 const t=setup(),room=t.run('state.room');
 t.run(`localStorage.setItem('polatka.messages.'+state.room,JSON.stringify([{name:'Я',text:'Из старой версии',time:1,self:true}]))`);
 t.run('loadMessages()');const legacyId=t.run('state.messages[0].id');assert.equal(t.run('state.messages[0].sharedId'),false);
 t.run("globalThis.channel={readyState:'open',send(){}};attachData(channel);state.dc={readyState:'open',send(){}};channel.onmessage({data:JSON.stringify({type:'message',text:'Старый канал'})})");
 assert.equal(t.run('state.messages.length'),1);assert.equal(t.run(`deleteMessage('${legacyId}')`),true);
 t.run('loadMessages()');assert.equal(t.run('state.messages.length'),0);assert.equal(t.run('state.room'),room);
});
test('deleting an attachment cleans its cached media only after checking the author',()=>{
 const t=setup(),id='12fec70a-bc55-46c0-818b-603e6dc421c3';
 t.run("globalThis.discarded=[];window.PolatkaFeatures={renderAttachment(){},discardAttachment:id=>discarded.push(id)}");
 t.run(`renderMessage({id:'${id}',sharedId:true,self:true,name:'Я',text:'',time:1,attachment:{id:'${id}'}})`);
 assert.equal(t.run(`receiveMessageDelete('${id}')`),false);assert.equal(t.run('discarded.length'),0);
 assert.equal(t.run(`deleteMessage('${id}')`),true);assert.equal(t.run('discarded[0]'),id);
});

test('received audio is attached to the media element and Web Audio before call acceptance',async()=>{
 const t=setup();
 t.run(`globalThis.MediaStream=class {constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}getAudioTracks(){return this.tracks}};
 globalThis.RTCPeerConnection=class {constructor(){this.transceivers=[]}getTransceivers(){return this.transceivers}close(){}};
 globalThis.peer=createPeer(false);globalThis.track={kind:'audio'};globalThis.receiver={track};peer.transceivers=[{receiver,sender:{replaceTrack:async()=>{}}}];peer.ontrack({track,receiver});`);
 assert.equal(t.get('remoteAudio').srcObject.getAudioTracks()[0],t.run('track'));
 assert.ok(t.run('state.audioMeters.remote'));assert.equal(t.get('remoteAudio').muted,true);
 t.run('state.inCall=true;syncRemoteAudio()');assert.equal(t.run('state.audioMeters.remote.gain.gain.value'),1);
 t.run('track.onunmute()');await Promise.resolve();
 assert.equal(t.run('state.audioMeters.remote.gain.gain.value'),1);
});
test('audio falls back to the media element when the processing graph is unavailable',()=>{
 const t=setup();t.run('state.inCall=true;state.remoteVolume=170;syncRemoteAudio()');assert.equal(t.get('remoteAudio').muted,false);assert.equal(t.get('remoteAudio').volume,1);
 t.run('toggleDeafen()');assert.equal(t.get('remoteAudio').muted,true);
 t.run('toggleDeafen()');assert.equal(t.get('remoteAudio').muted,false);
 t.run('endCall(false)');assert.equal(t.get('remoteAudio').muted,true);
});

test('hanging up during microphone permission stops a late capture without joining the call',async()=>{
 const t=setup();
 t.run(`state.connected=true;state.pc={getTransceivers:()=>[]};navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>globalThis.resolveCapture=resolve);globalThis.pendingCall=startCall();`);
 assert.equal(t.run('state.callStarting'),true);t.run('endCall(false)');
 t.run(`globalThis.lateTrack={stopped:false,stop(){this.stopped=true}};resolveCapture({getTracks:()=>[lateTrack]});`);
 await t.run('pendingCall');
 assert.equal(t.run('lateTrack.stopped'),true);assert.equal(t.run('state.inCall'),false);assert.equal(t.run('state.callStarting'),false);assert.equal(t.run('state.micStream'),null);
});

test('late output-device selection cannot restart a call after hangup',async()=>{
 const t=setup();
 t.run(`globalThis.sent=[];globalThis.captureTrack={kind:'audio',stop(){this.stopped=true}};globalThis.capture={getTracks:()=>[captureTrack],getAudioTracks:()=>[captureTrack]};
 globalThis.PolatkaAudio={...PolatkaAudio,createInput:async()=>({stream:capture,stop(){captureTrack.stop()}})};
 state.connected=true;state.dc={readyState:'open',bufferedAmount:0,send:s=>sent.push(JSON.parse(s))};state.pc={getTransceivers:()=>[{sender:{replaceTrack:async()=>{},getParameters:()=>({})}}]};navigator.mediaDevices.getUserMedia=async()=>capture;
 $('remoteAudio').setSinkId=()=>new Promise(resolve=>globalThis.finishSink=resolve);globalThis.pendingOutputCall=startCall();`);
 for(let i=0;i<12&&!t.run('Boolean(globalThis.finishSink)');i++)await Promise.resolve();
 assert.equal(t.run('state.inCall'),true);assert.equal(t.run('Boolean(globalThis.finishSink)'),true);
 t.run('endCall(false);finishSink()');await t.run('pendingOutputCall');
 assert.equal(t.run('state.inCall'),false);assert.equal(t.run('state.micInput'),null);assert.equal(t.run('captureTrack.stopped'),true);
 assert.equal(t.run("sent.some(m=>m.type==='call'||m.type==='accepted')"),false);
 assert.equal(t.get('callStatus').textContent,'Можно говорить. Можно просто быть рядом.');
});
