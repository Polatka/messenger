// Hardware-free checks of production processing and output gain graphs.
// Same-context tones isolate graph behavior from cross-context transport underruns.
// This does not verify microphone capture, remote PCM arrival, or WebRTC transport.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const http=require('node:http'),fs=require('node:fs');
const renderer=path.resolve(__dirname,'../renderer');
const server=http.createServer((req,res)=>{try{const name=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1).split('?')[0]);if(path.basename(name)!==name)throw Error();const file=path.join(renderer,name);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':'text/html');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
function installSampling(){
 window.advanceAudioTime=async(contexts,seconds)=>{
  const start=contexts.map(c=>c.currentTime),deadline=performance.now()+5000;
  while(!contexts.every((c,i)=>c.currentTime-start[i]>=seconds)){
   if(contexts.some(c=>c.state!=='running'))throw Error('An audio context stopped during measurement');
   if(performance.now()>deadline)throw Error('Audio clocks did not advance within 5 seconds');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
 };
 window.summarizeAudioSamples=samples=>{
  const sorted=[...samples].sort((a,b)=>a-b),rms=sorted[1];
  if(sorted[2]-sorted[0]>Math.max(.00005,sorted[2]*.04))throw Error('Audio did not settle across three sample windows: '+samples.join(', '));
  return {rms,samples};
 };
 window.measureAudioRms=async(analyser,contexts)=>{
  // Audio clocks, rather than wall time, govern gain ramps and analyser windows.
  await advanceAudioTime(contexts,.4);const samples=[];
  for(let i=0;i<3;i++){
   if(i)await advanceAudioTime(contexts,.1);
   const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
   samples.push(Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length));
  }
  return summarizeAudioSamples(samples);
 };
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const p=await browser.newPage();await p.addInitScript(installSampling);await p.evaluate(installSampling);
  await p.setContent('<button id="run">Run in user gesture</button>');await p.addScriptTag({path:path.join(renderer,'audio.js')});
  await p.evaluate(()=>{
   document.querySelector('#run').onclick=async()=>{
    let placeholder,raw,input,osc,toneGain,recorder,result;
    try{
     placeholder=new AudioContext();raw=placeholder.createMediaStreamDestination();await placeholder.resume();
     input=await PolatkaAudio.createInput(raw.stream,100);
     // Inject a tone before the production gain/limiter, then record the entire
     // exported processed stream. No second realtime context imports the PCM.
     osc=input.context.createOscillator();toneGain=input.context.createGain();osc.frequency.value=440;toneGain.gain.value=.05;osc.connect(toneGain);toneGain.connect(input.gain);osc.start();
     const values=[];
     for(const gain of[100,200,0]){
      input.setGain(gain);await advanceAudioTime([input.context],.4);
      const chunks=[];recorder=new MediaRecorder(input.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000});
      const stopped=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=resolve;recorder.onerror=()=>reject(Error('Synthetic stream recording failed'))});
      recorder.start();await advanceAudioTime([input.context],.65);recorder.stop();await stopped;
      const pcm=await input.context.decodeAudioData(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer()),data=pcm.getChannelData(0),samples=[];
      if(pcm.duration<.55)throw Error('Synthetic recording is too short: '+pcm.duration);
      for(const start of[.15,.30,.45]){const slice=data.subarray(Math.round(start*pcm.sampleRate),Math.round((start+.08)*pcm.sampleRate));samples.push(Math.sqrt(slice.reduce((sum,value)=>sum+value*value,0)/slice.length))}
      values.push({gain,...summarizeAudioSamples(samples)});
     }
     osc.stop();osc=null;input.stop();input.stop();
     const deadline=performance.now()+2000;while(input.context.state!=='closed'){if(performance.now()>deadline)throw Error('Input context did not close');await new Promise(r=>setTimeout(r,20))}
     result={values,released:{context:input.context.state,raw:raw.stream.getTracks().map(t=>t.readyState),processed:input.stream.getTracks().map(t=>t.readyState)},source:'same-context oscillator at production input gain; complete exported stream recorded and decoded'};
    }catch(e){result={error:e.stack}}
    finally{if(recorder?.state==='recording')recorder.stop();try{osc?.stop()}catch{}for(const node of[osc,toneGain])try{node?.disconnect()}catch{}input?.stop();raw?.stream.getTracks().forEach(t=>t.stop());if(placeholder)await placeholder.close().catch(()=>{})}
    window.result=result;
   };
  });
  await p.locator('#run').click();await p.waitForFunction(()=>window.result,null,{timeout:45000});const inputResult=await p.evaluate(()=>window.result);console.log(JSON.stringify(inputResult,null,2));assert.equal(inputResult.error,undefined);assert.ok(inputResult.values[0].rms>.02);const inputRatio=inputResult.values[1].rms/inputResult.values[0].rms;assert.ok(inputRatio>1.9&&inputRatio<2.1);assert.ok(inputResult.values[2].rms<.0001);assert.equal(inputResult.released.context,'closed');assert.deepEqual(inputResult.released.raw,['ended']);assert.deepEqual(inputResult.released.processed,['ended']);console.log('PASS production input graph/exported stream: 100%, 200%, 0%, idempotent release');
  await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>typeof startMeter==='function');
  await p.evaluate(()=>{
   const button=document.createElement('button');button.id='verify-output';button.textContent='Verify output';button.style.cssText='position:fixed;top:40px;left:0;z-index:9999';document.body.append(button);
   button.onclick=async()=>{
    let placeholder,raw,meter,osc,toneGain,analyser,result;
    try{
     placeholder=new AudioContext();raw=placeholder.createMediaStreamDestination();await placeholder.resume();
     state.inCall=true;state.remoteMedia={mic:true,inCall:true};await startMeter('remote',raw.stream,'remoteAura');meter=state.audioMeters.remote;await meter.context.resume();
     // Test the production output gain/mute branch on one audio clock.
     meter.source.disconnect(meter.gain);osc=meter.context.createOscillator();toneGain=meter.context.createGain();osc.frequency.value=440;toneGain.gain.value=.05;osc.connect(toneGain);toneGain.connect(meter.gain);osc.start();
     analyser=meter.context.createAnalyser();analyser.fftSize=2048;meter.gain.connect(analyser);const values=[];
     for(const step of[{volume:100,deaf:false,inCall:true},{volume:170,deaf:false,inCall:true},{volume:170,deaf:true,inCall:true},{volume:170,deaf:false,inCall:true},{volume:170,deaf:false,inCall:false}]){state.remoteVolume=step.volume;state.deaf=step.deaf;state.inCall=step.inCall;syncRemoteAudio();values.push({...step,...await measureAudioRms(analyser,[meter.context])})}
     result={values,singleOutput:document.getElementById('remoteAudio').muted,source:'same-context oscillator at production output gain; remote PCM transport is outside scope'};
    }catch(e){result={error:e.stack}}
    finally{try{osc?.stop()}catch{}for(const node of[osc,toneGain,analyser,meter?.gain])try{node?.disconnect()}catch{}state.inCall=false;stopMeter('remote');raw?.stream.getTracks().forEach(t=>t.stop());if(placeholder)await placeholder.close().catch(()=>{})}
    window.outputResult=result;
   };
  });
  await p.locator('#verify-output').click();await p.waitForFunction(()=>window.outputResult,null,{timeout:45000});const output=await p.evaluate(()=>window.outputResult);console.log(JSON.stringify({remoteOutput:output},null,2));assert.equal(output.error,undefined);assert.equal(output.singleOutput,true);assert.ok(output.values[0].rms>.02);const outputRatio=output.values[1].rms/output.values[0].rms;assert.ok(outputRatio>1.6&&outputRatio<1.8);assert.ok(output.values[2].rms<.0001);assert.ok(output.values[3].rms/output.values[0].rms>1.6);assert.ok(output.values[4].rms<.0001);console.log('PASS production output gain graph: 100%, 170%, deafen, restore, hangup; one audible route');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
