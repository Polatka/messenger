// Browser regression without device capture or a real WebRTC transport.
// Managed Chromium in this environment disables capture and non-proxied UDP.
// Signalling and DataChannels below are explicit test doubles; audio graph checks
// and a real two-Windows-device call are separate validation steps.
'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../renderer');
const out=path.resolve(process.env.QA_OUTPUT||path.join(__dirname,'../../qa-output'));
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 try{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep))throw Error('Invalid path');
  const types={'.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'};
  res.setHeader('Content-Type',types[path.extname(file)]||'text/html');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end()}
});
async function installDoubles(page){
 await page.addInitScript(()=>{
  window.captureCalls=0;
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=(...args)=>{window.captureCalls++;return original(...args)};
  // This never creates a network connection or reads devices.
  window.RTCPeerConnection=class MockPeer{
   constructor(){this.transceivers=[];this.iceGatheringState='complete';this.signalingState='stable';this.connectionState='new'}
   addTransceiver(kind){const t={direction:'sendrecv',sender:{replaceTrack:async()=>{}},receiver:{track:{kind}}};this.transceivers.push(t);return t}
   getTransceivers(){return this.transceivers}
   createDataChannel(){return window.makeTestChannel()}
   async createOffer(){return {type:'offer',sdp:'v=0\r\nmock-signalling-only'}}
   async createAnswer(){return {type:'answer',sdp:'v=0\r\nmock-signalling-only'}}
   async setLocalDescription(description){this.localDescription=description;this.signalingState=description.type==='offer'?'have-local-offer':'stable'}
   async setRemoteDescription(description){if(description.type==='offer'&&!this.transceivers.length)for(const kind of ['audio','video','video'])this.addTransceiver(kind);this.signalingState=description.type==='offer'?'have-remote-offer':'stable'}
   close(){this.connectionState='closed'}
  };
  window.makeTestChannel=()=>({readyState:'open',bufferedAmount:0,send(raw){void window.relayTestPacket({raw})},close(){this.readyState='closed';this.onclose?.();void window.relayTestPacket({close:true})}});
 });
}
async function connectChannels(a,b){
 for(const p of[a,b])await p.evaluate(()=>{window.testChannel=makeTestChannel();attachData(testChannel)});
 for(const p of[a,b])await p.evaluate(()=>testChannel.onopen());
 for(const p of[a,b])await p.waitForFunction(()=>state.connected&&state.remote.capabilities?.includes('message-delete-v1'));
}
async function sendText(page,text){await page.locator('#messageInput').fill(text);await page.locator('#sendButton').click();return page.evaluate(t=>state.messages.find(m=>m.self&&m.text===t).id,text)}
const row=(page,id)=>page.locator(`.message[data-message-id="${id}"]`);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const errors=[],contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:1180,height:800}})));
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
  for(const p of[a,b]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await installDoubles(p)}
  for(const [p,other] of[[a,b],[b,a]])await p.exposeFunction('relayTestPacket',packet=>other.evaluate(packet=>{if(!window.testChannel)return;if(packet.close){testChannel.readyState='closed';testChannel.onclose?.()}else testChannel.onmessage?.({data:packet.raw})},packet));
  const url='http://127.0.0.1:'+server.address().port;
  await Promise.all([a.goto(url),b.goto(url)]);await a.waitForSelector('#launchSplash',{state:'detached'});
  assert.deepEqual(errors,[]);assert.equal(await a.evaluate(()=>captureCalls),0);
  assert.equal(await a.locator('#resumeAudioButton').isVisible(),false);
  assert.equal(await a.locator('.brand-logo').evaluate(e=>e.complete&&e.naturalWidth>0&&e.getAttribute('src')==='logo.png'),true);
  if(process.env.SCREENSHOTS)await a.screenshot({path:path.join(out,'main-041.png')});
  console.log('PASS startup completes, logo loads, no microphone/camera requested on startup');

  await a.locator('[data-action=settings]').first().click();
  await a.locator('#appearanceTheme').selectOption('midnight');await a.locator('#appearanceDensity').selectOption('compact');await a.locator('#appearanceFont').selectOption('mono');
  await a.locator('#appearanceFontSize').fill('18');await a.locator('#appearanceRoundness').fill('10');await a.locator('#appearanceGlass').uncheck();await a.locator('#appearanceMotion').uncheck();
  await a.locator('.swatch[title="Фиолетовый"]').click();await a.locator('#nameInput').fill('Алекс');await a.locator('#bioInput').fill('Тест профиля');
  await a.locator('#avatarFile').setInputFiles(path.join(root,'logo.jpg'));await a.waitForFunction(()=>!!document.querySelector('#profilePreview img'));
  for(const gain of ['0','175','300']){await a.locator('#micGain').fill(gain);assert.equal(await a.locator('#micGainValue').textContent(),gain+'%')}
  await a.locator('#micGain').fill('175');await a.locator('#clickVolume').fill('17');await a.locator('#saveSettings').click();await a.reload();
  assert.equal(await a.locator('#launchSplash').count(),0);
  const saved=await a.evaluate(()=>({prefs:settings.appearance,gain:settings.micGain,color:settings.color,dataset:{...document.documentElement.dataset},size:getComputedStyle(document.documentElement).getPropertyValue('--message-font-size').trim(),radius:getComputedStyle(document.documentElement).getPropertyValue('--panel-radius').trim()}));
  assert.deepEqual(saved.prefs,{theme:'midnight',density:'compact',font:'mono',fontSize:18,roundness:10,glass:false,motion:false});assert.equal(saved.gain,175);assert.equal(saved.color,'#bb91f1');assert.equal(saved.size,'18px');assert.equal(saved.radius,'10px');assert.equal(saved.dataset.motion,'false');assert.equal(saved.dataset.glass,'false');
  await a.locator('[data-action=settings]').first().click();assert.equal(await a.locator('#clickVolume').inputValue(),'17');assert.equal(await a.locator('#profilePreview img').count(),1);assert.equal(await a.locator('#nameInput').inputValue(),'Алекс');
  if(process.env.SCREENSHOTS){await a.screenshot({path:path.join(out,'settings-041.png')});await a.locator('.appearance-section').evaluate(e=>e.scrollIntoView({block:'start'}));await a.screenshot({path:path.join(out,'appearance-041.png')});await a.locator('#micGain').scrollIntoViewIfNeeded();await a.screenshot({path:path.join(out,'microphone-041.png')})}
  await a.locator('#saveSettings').click();assert.equal(await a.evaluate(()=>captureCalls),0);
  console.log('PASS all appearance controls, microphone gain, profile, avatar and click-volume persistence');

  await a.locator('.intro [data-action=connect]').click();await a.locator('#roomInput').fill('Ночное лобби');await a.locator('#createInvite').click();await a.waitForFunction(()=>$('offerOutput').value.length>50);
  await b.locator('.intro [data-action=join]').click();await b.locator('#offerInput').fill(await a.locator('#offerOutput').inputValue());await b.locator('#joinInvite').click();await b.waitForFunction(()=>$('answerOutput').value.length>50);
  await a.locator('#answerInput').fill(await b.locator('#answerOutput').inputValue());await a.locator('#acceptAnswer').click();
  assert.equal(await b.locator('#hostTab').isDisabled(),true);assert.equal(await b.locator('#createInvite').isDisabled(),true);assert.equal(await b.locator('#roomInput').isDisabled(),true);assert.equal(await b.locator('#acceptAnswer').isDisabled(),true);
  const guarded=await b.evaluate(async()=>{const result=[];for(const f of[createInvite,acceptAnswer]){try{await f();result.push(false)}catch{result.push(true)}}return result});assert.deepEqual(guarded,[true,true]);
  await b.reload();assert.equal(await b.evaluate(()=>state.role),'guest');assert.equal(await b.locator('#voiceLobbyName').textContent(),'Ночное лобби');
  await connectChannels(a,b);assert.equal(await b.locator('#remoteInitial img').count(),1);
  console.log('PASS owner/guest signalling guards and persisted guest role (mock signalling/DataChannels)');

  const first=await sendText(a,'Сообщение <b>текст</b>');await row(b,first).waitFor();assert.equal(await row(b,first).locator('b').count(),0);assert.equal(await row(b,first).locator('.message-delete-everyone').count(),0);
  await row(b,first).locator('.message-delete').click();assert.equal(await row(b,first).count(),0);assert.equal(await row(a,first).count(),1);
  const global=await sendText(a,'Удаление у обоих');await row(b,global).waitFor();await row(a,global).locator('.message-delete-everyone').click();await row(b,global).waitFor({state:'detached'});assert.equal(await row(a,global).count(),0);
  const protectedId=await sendText(a,'Чужое сообщение нельзя удалить');await row(b,protectedId).waitFor();await b.evaluate(id=>send({type:'message-delete',id}),protectedId);await a.waitForTimeout(80);assert.equal(await row(a,protectedId).count(),1);
  await b.evaluate(()=>send({type:'message',text:'Старый клиент без ID'}));await a.locator('#messages').getByText('Старый клиент без ID',{exact:true}).waitFor();
  assert.equal(await a.locator('.message').filter({hasText:'Старый клиент без ID'}).locator('.message-delete-everyone').count(),0);
  const bytes=Buffer.from('Polatka attachment\n'.repeat(3500));await a.locator('#chatFile').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:bytes});await b.locator('.attachment-actions').getByText('Принять',{exact:true}).click();
  await b.locator('.attachment-status').filter({hasText:'Получено'}).waitFor();await a.locator('.attachment-status').filter({hasText:'Доставлено'}).waitFor();
  const fileId=await a.evaluate(()=>state.messages.find(m=>m.attachment?.name==='test.txt').id);
  assert.equal(await b.evaluate(async id=>(await PolatkaMediaStore.get(id)).text(),fileId),bytes.toString());
  await row(a,fileId).locator('.message-delete-everyone').click();await row(b,fileId).waitFor({state:'detached'});
  for(const p of[a,b])await p.waitForFunction(async id=>(await PolatkaMediaStore.get(id))===null,fileId);
  await b.reload();await b.waitForFunction(()=>state.messages.length>0);assert.equal(await row(b,global).count(),0);assert.equal(await row(b,first).count(),0);assert.equal(await row(b,fileId).count(),0);assert.equal(await row(b,protectedId).count(),1);
  console.log('PASS local/shared deletion, author ownership, legacy IDs, attachment transfer bytes/cache cleanup and reload');

  await b.locator('.space-title').click();assert.equal(await b.locator('#hostTab').isDisabled(),true);await b.locator('#disconnectButton').click();assert.equal(await b.evaluate(()=>state.role),'owner');assert.equal(await b.locator('#hostTab').isDisabled(),false);assert.equal(await b.evaluate(()=>state.roomName),'Моё лобби');await b.locator('#connectDialog .icon-button').click();
  await a.evaluate(()=>{setPage('chat');for(let i=0;i<35;i++)renderMessage({name:'Друг',text:'Строка '+i,time:Date.now(),color:'#bb91f1'})});await a.waitForTimeout(80);await a.locator('#chatScroll').evaluate(e=>e.scrollTop=100);await a.waitForFunction(()=>state.followChat===false);const top=await a.locator('#chatScroll').evaluate(e=>e.scrollTop);await a.evaluate(()=>renderMessage({name:'Друг',text:'Пока читаем историю',time:Date.now(),color:'#bb91f1'}));assert.equal(await a.locator('#chatScroll').evaluate(e=>e.scrollTop),top);
  if(process.env.SCREENSHOTS)await a.screenshot({path:path.join(out,'chat-041.png')});
  for(const pageName of['chat','voice']){await a.locator(`[data-page=${pageName}]`).click();await a.setViewportSize({width:760,height:580});assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1));if(pageName==='voice'){const controls=await a.locator('.call-controls').boundingBox();assert.ok(controls.y+controls.height<=580)}if(process.env.SCREENSHOTS)await a.screenshot({path:path.join(out,pageName+'-small-041.png')})}
  await b.locator('[data-action=settings]').first().click();await b.locator('#appearanceTheme').selectOption('graphite');await b.locator('#resetAppearance').click();assert.deepEqual(await b.evaluate(()=>settings.appearance),{theme:'forest',density:'comfortable',font:'system',fontSize:14,roundness:22,glass:true,motion:true});assert.equal(await b.locator('#colorInput').inputValue(),'#93ed79');await b.locator('#saveSettings').click();
  assert.deepEqual(errors,[]);console.log('PASS guest leaves into own lobby, scroll position, minimum-size UI, appearance reset, no renderer exceptions');
  console.log('NOTE: these tests use mock signalling/DataChannels; real WebRTC and device capture are not tested.');
 }catch(error){if(process.env.SCREENSHOTS)for(const [i,c]of browser.contexts().entries())for(const p of c.pages())await p.screenshot({path:path.join(out,'regression-failure-'+i+'.png')}).catch(()=>{});throw error}
 finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
