(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PolatkaAudio=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function constraints(settings){return {audio:{deviceId:settings.mic?{exact:settings.mic}:undefined,echoCancellation:!!settings.echo,noiseSuppression:!!settings.echo,autoGainControl:false,channelCount:{ideal:1},sampleRate:{ideal:48000},latency:{ideal:0.01}},video:false}}
 function gainPercent(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(300,n)):100}
 async function createInput(rawStream,percent,options={}){
  const Context=options.AudioContext||globalThis.AudioContext,Stream=options.MediaStream||globalThis.MediaStream;
  const context=new Context({latencyHint:'interactive'});let source,gain,limiter,destination,stream,stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;rawStream.getTracks().forEach(t=>t.stop());stream?.getTracks().forEach(t=>t.stop());destination?.stream.getTracks().forEach(t=>t.stop());for(const node of[source,gain,limiter])try{node?.disconnect()}catch{}void context.close().catch(()=>{})};
  try{
   source=context.createMediaStreamSource(rawStream);gain=context.createGain();gain.gain.value=gainPercent(percent)/100;
   limiter=context.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=6;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.15;
   destination=context.createMediaStreamDestination();source.connect(gain);gain.connect(limiter);limiter.connect(destination);
   stream=new Stream([...destination.stream.getAudioTracks(),...rawStream.getVideoTracks()]);
   // This graph only feeds the outgoing stream: microphone monitoring would cause feedback.
   let timer;try{await Promise.race([context.resume(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Нажмите кнопку ещё раз, чтобы разрешить обработку микрофона.')),2500)})])}finally{clearTimeout(timer)}
   if(context.state==='closed')throw Error('Обработка микрофона остановлена. Повторите попытку.');
   return {stream,rawStream,context,gain,stop,setGain(value){if(stopped)return;gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setTargetAtTime(gainPercent(value)/100,context.currentTime,.012)}};
  }catch(error){stop();throw error}
 }
 function tuneReceiver(receiver,mode){const target=mode==='fast'?20:mode==='auto'?null:40;try{if('jitterBufferTarget'in receiver)receiver.jitterBufferTarget=target}catch{}return target}
 function interval(current,previous){if(!previous||current.id!==previous.id)return null;const count=current.jitterBufferEmittedCount-previous.jitterBufferEmittedCount;const delay=current.jitterBufferDelay-previous.jitterBufferDelay;if(!Number.isFinite(count)||!Number.isFinite(delay)||count<=0||delay<0)return null;return delay/count*1000}
 return {constraints,tuneReceiver,interval,gainPercent,createInput};
});
