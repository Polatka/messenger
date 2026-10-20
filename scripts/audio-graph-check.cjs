// Hardware-free verification of the production microphone graph.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const http=require('node:http'),fs=require('node:fs');
const renderer=path.resolve(__dirname,'../renderer');
const server=http.createServer((req,res)=>{try{const name=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1).split('?')[0]);if(path.basename(name)!==name)throw Error();const file=path.join(renderer,name);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':'text/html');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const p=await browser.newPage();
  const installSampling=()=>{
   window.measureAudioRms=async(analyser,contexts)=>{
    async function advance(seconds){
     const start=contexts.map(c=>c.currentTime),deadline=performance.now()+5000;
     while(!contexts.every((c,i)=>c.currentTime-start[i]>=seconds)){
      if(contexts.some(c=>c.state!=='running'))throw Error('An audio context stopped during measurement');
      if(performance.now()>deadline)throw Error('Audio clocks did not advance within 5 seconds');
      await new Promise(resolve=>setTimeout(resolve,25));
     }
    }
    // Gain ramps and the complete analyser window must settle on the audio clock,
    // which may advance slower than wall time on an overloaded CI worker.
    await advance(.4);const samples=[];
    for(let i=0;i<3;i++){
     if(i)await advance(.1);
     const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
     samples.push(Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length));
    }
    const sorted=[...samples].sort((a,b)=>a-b),rms=sorted[1];
    if(sorted[2]-sorted[0]>Math.max(.00005,sorted[2]*.04))throw Error('Audio did not settle across three sample windows: '+samples.join(', '));
    return {rms,samples};
   };
  };
  await p.addInitScript(installSampling);await p.evaluate(installSampling);
  await p.setContent('<button id="run">Run in user gesture</button>');
  await p.addScriptTag({path:path.join(renderer,'audio.js')});
  await p.evaluate(()=>{
   document.querySelector('#run').onclick=async()=>{
    try{
     const producer=new AudioContext(),osc=producer.createOscillator(),amp=producer.createGain(),raw=producer.createMediaStreamDestination();osc.frequency.value=440;amp.gain.value=.05;osc.connect(amp);amp.connect(raw);osc.start();await producer.resume();
     const input=await PolatkaAudio.createInput(raw.stream,100);
     const output=new AudioContext(),source=output.createMediaStreamSource(input.stream),analyser=output.createAnalyser(),silent=output.createGain();analyser.fftSize=2048;silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(output.destination);await output.resume();
     const values=[];for(const gain of[100,200,0]){input.setGain(gain);values.push({gain,...await measureAudioRms(analyser,[producer,input.context,output])})}
     input.stop();input.stop();await new Promise(r=>setTimeout(r,100));const released={context:input.context.state,raw:raw.stream.getTracks().map(t=>t.readyState),processed:input.stream.getTracks().map(t=>t.readyState)};
     osc.stop();await producer.close();await output.close();window.result={values,released};
    }catch(e){window.result={error:e.stack}}
   };
  });
  await p.locator('#run').click();await p.waitForFunction(()=>window.result,null,{timeout:45000});const r=await p.evaluate(()=>window.result);console.log(JSON.stringify(r,null,2));assert.equal(r.error,undefined);assert.ok(r.values[0].rms>.02);assert.ok(r.values[1].rms/r.values[0].rms>1.9&&r.values[1].rms/r.values[0].rms<2.1);assert.ok(r.values[2].rms<.0001);assert.equal(r.released.context,'closed');assert.deepEqual(r.released.raw,['ended']);assert.deepEqual(r.released.processed,['ended']);console.log('PASS real Web Audio graph: 100%, 200%, 0%, idempotent release');
  await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>typeof startMeter==='function');
  await p.evaluate(()=>{
   const button=document.createElement('button');button.id='verify-output';button.textContent='Verify output';button.style.cssText='position:fixed;top:40px;left:0;z-index:9999';document.body.append(button);
   button.onclick=async()=>{try{
    const placeholder=new AudioContext(),raw=placeholder.createMediaStreamDestination();await placeholder.resume();
    state.inCall=true;state.remoteMedia={mic:true,inCall:true};await startMeter('remote',raw.stream,'remoteAura');const meter=state.audioMeters.remote;await meter.context.resume();
    // Test the production output gain/mute branch with one audio clock. Transport
    // between separate contexts can underrun on CI and is outside this test's scope.
    meter.source.disconnect(meter.gain);const osc=meter.context.createOscillator(),amp=meter.context.createGain();osc.frequency.value=440;amp.gain.value=.05;osc.connect(amp);amp.connect(meter.gain);osc.start();
    const analyser=meter.context.createAnalyser();analyser.fftSize=2048;meter.gain.connect(analyser);const values=[];
    for(const step of[{volume:100,deaf:false,inCall:true},{volume:170,deaf:false,inCall:true},{volume:170,deaf:true,inCall:true},{volume:170,deaf:false,inCall:true},{volume:170,deaf:false,inCall:false}]){state.remoteVolume=step.volume;state.deaf=step.deaf;state.inCall=step.inCall;syncRemoteAudio();values.push({...step,...await measureAudioRms(analyser,[meter.context])})}
    const singleOutput=document.getElementById('remoteAudio').muted;osc.stop();stopMeter('remote');raw.stream.getTracks().forEach(t=>t.stop());await placeholder.close();window.outputResult={values,singleOutput,source:'same-context oscillator at production output gain input'};
   }catch(e){window.outputResult={error:e.stack}}};
  });
  await p.locator('#verify-output').click();await p.waitForFunction(()=>window.outputResult,null,{timeout:45000});const output=await p.evaluate(()=>window.outputResult);console.log(JSON.stringify({remoteOutput:output},null,2));assert.equal(output.error,undefined);assert.equal(output.singleOutput,true);assert.ok(output.values[0].rms>.02);const ratio=output.values[1].rms/output.values[0].rms;assert.ok(ratio>1.6&&ratio<1.8);assert.ok(output.values[2].rms<.0001);assert.ok(output.values[3].rms/output.values[0].rms>1.6);assert.ok(output.values[4].rms<.0001);console.log('PASS real remote output graph: 100%, 170%, deafen, restore, hangup; one audible route');
 }finally{await browser.close();server.close()}
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
