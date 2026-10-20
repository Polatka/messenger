(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PolatkaAudio=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function constraints(settings){return {audio:{deviceId:settings.mic?{exact:settings.mic}:undefined,echoCancellation:!!settings.echo,noiseSuppression:!!settings.echo,autoGainControl:false,channelCount:{ideal:1},sampleRate:{ideal:48000},latency:{ideal:0.01}},video:false}}
 function tuneReceiver(receiver,mode){const target=mode==='fast'?20:mode==='auto'?null:40;try{if('jitterBufferTarget'in receiver)receiver.jitterBufferTarget=target}catch{}return target}
 function interval(current,previous){if(!previous||current.id!==previous.id)return null;const count=current.jitterBufferEmittedCount-previous.jitterBufferEmittedCount;const delay=current.jitterBufferDelay-previous.jitterBufferDelay;if(!Number.isFinite(count)||!Number.isFinite(delay)||count<=0||delay<0)return null;return delay/count*1000}
 return {constraints,tuneReceiver,interval};
});
