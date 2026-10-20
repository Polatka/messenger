/* Polatka bounded, ordered attachment protocol. No file is opened automatically. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PolatkaTransfer=api})(globalThis,function(){
 'use strict';
 const MAX=25*1024*1024,CHUNK=12*1024,MEDIA_MAX=12*1024*1024;
 const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
 function filename(s){return String(s||'file').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,120)||'file'}
 function metadata(m){
  if(!m||!validId(m.id)||!Number.isSafeInteger(m.size)||m.size<0||m.size>MAX||!['file','voice','video'].includes(m.kind))return null;
  const mime=String(m.mime||'application/octet-stream').slice(0,100);
  if(m.kind!=='file'&&(m.size>MEDIA_MAX||!Number.isFinite(m.duration)||m.duration<0||m.duration>(m.kind==='video'?60:300)||!(m.kind==='voice'?/^audio\/(webm|ogg|mp4)(;.*)?$/:/^video\/(webm|mp4)(;.*)?$/).test(mime)))return null;
  return {id:m.id,name:filename(m.name),size:m.size,kind:m.kind,mime,duration:m.kind==='file'?0:m.duration};
 }
 const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
 async function digest(blob){return hex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))}
 class Session{
  constructor({send,buffered=()=>0,connected=()=>true,onOffer=()=>{},onProgress=()=>{},onComplete=()=>{},onError=()=>{},onSent=()=>{}}){Object.assign(this,{send,buffered,connected,onOffer,onProgress,onComplete,onError,onSent});this.out=null;this.input=null;this.closed=false;this.seen=new Set()}
  emit(packet){if(this.closed||!this.connected()||!this.send(packet))throw Error('Соединение прервано')}
  arm(item,ms=120000){clearTimeout(item.timer);item.timer=setTimeout(()=>this.cancel(item.meta.id,'Время передачи истекло'),ms);item.timer.unref?.()}
  async offer(blob,{name,kind='file',duration=0}={}){
   if(this.closed||!this.connected())throw Error('Подключите собеседника');
   if(this.out)throw Error('Дождитесь завершения текущей отправки');
   const meta=metadata({id:crypto.randomUUID(),name:name||blob.name,size:blob.size,mime:blob.type||'application/octet-stream',kind,duration});
   if(!meta)throw Error('Файл: до 25 МБ. Запись: до 12 МБ и 5 минут.');
   const item={meta,blob,phase:'offered'};this.out=item;this.arm(item);
   try{this.emit({type:'file-offer',...meta})}catch(e){this.cancel(meta.id,e.message,false);throw e}
   return meta;
  }
  accept(id){const item=this.input;if(!item||item.meta.id!==id||item.phase!=='offered')return;item.phase='receiving';this.arm(item);try{this.emit({type:'file-accept',id});this.onProgress(item.meta,0,'receiving')}catch(e){this.cancel(id,e.message,false)}}
  cancel(id,reason='Передача отменена',notify=true){
   const item=this.out?.meta.id===id?this.out:this.input?.meta.id===id?this.input:null;if(!item)return;
   if(notify)try{this.emit({type:'file-cancel',id})}catch{}
   clearTimeout(item.timer);item.cancelled=true;item.parts=[];
   if(item===this.out)this.out=null;else this.input=null;
   this.onError(item.meta,reason);
  }
  close(){for(const item of [this.out,this.input])if(item)this.cancel(item.meta.id,'Соединение закрыто',false);this.closed=true}
  async pump(item){
   try{
    item.phase='sending';let seq=0;
    for(let pos=0;pos<item.blob.size;pos+=CHUNK){
     while(this.buffered()>128*1024){if(item.cancelled||this.closed||!this.connected())throw Error('Передача прервана');await new Promise(r=>setTimeout(r,20))}
     if(item.cancelled||this.closed) return;
     const bytes=new Uint8Array(await item.blob.slice(pos,pos+CHUNK).arrayBuffer());
     if(item.cancelled||this.closed)return;
     this.emit({type:'file-chunk',id:item.meta.id,seq:seq++,data:btoa(String.fromCharCode(...bytes))});
     this.arm(item);this.onProgress(item.meta,Math.min(pos+bytes.length,item.meta.size),'sending');
     await new Promise(r=>setTimeout(r,0));
    }
    const hash=await digest(item.blob);if(item.cancelled||this.closed)return;
    item.phase='verifying';this.emit({type:'file-end',id:item.meta.id,hash});this.arm(item);this.onProgress(item.meta,item.meta.size,'verifying');
   }catch(e){this.cancel(item.meta.id,e.message)}
  }
  async handle(m){
   if(this.closed||!m||typeof m.type!=='string'||!m.type.startsWith('file-'))return false;
   if(!validId(m.id))return true;
   try{
    if(m.type==='file-offer'){
     const meta=metadata(m);
     if(!meta||this.input||this.seen.has(m.id)||this.seen.size>=300){this.emit({type:'file-cancel',id:m.id});return true}
     this.seen.add(m.id);this.input={meta,phase:'offered',parts:[],bytes:0,seq:0};this.arm(this.input);this.onOffer(meta);return true;
    }
    const output=this.out?.meta.id===m.id?this.out:null,input=this.input?.meta.id===m.id?this.input:null;
    if(m.type==='file-cancel'){this.cancel(m.id,'Собеседник отменил передачу',false);return true}
    if(m.type==='file-accept'&&output?.phase==='offered'){void this.pump(output);return true}
    if(m.type==='file-ack'&&output?.phase==='verifying'){clearTimeout(output.timer);this.out=null;this.onSent(output.meta,output.blob);return true}
    if(!input)return true;
    if(m.type==='file-chunk'){
     if(input.phase!=='receiving'||m.seq!==input.seq||typeof m.data!=='string'||m.data.length>CHUNK*4/3||!m.data.length)throw Error('Повреждённый блок файла');
     const raw=atob(m.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
     if(!bytes.length||bytes.length>CHUNK||input.bytes+bytes.length>input.meta.size)throw Error('Неверный размер файла');
     input.parts.push(bytes);input.bytes+=bytes.length;input.seq++;this.arm(input);this.onProgress(input.meta,input.bytes,'receiving');
    }else if(m.type==='file-end'){
     if(input.phase!=='receiving'||input.bytes!==input.meta.size||typeof m.hash!=='string'||!/^[a-f0-9]{64}$/.test(m.hash))throw Error('Файл передан не полностью');
     input.phase='verifying';const blob=new Blob(input.parts,{type:input.meta.mime});input.parts=[];
     const hash=await digest(blob);if(input.cancelled||this.closed)return true;
     if(hash!==m.hash)throw Error('Контрольная сумма файла не совпала');
     clearTimeout(input.timer);this.input=null;this.emit({type:'file-ack',id:m.id});this.onComplete(input.meta,blob);
    }
   }catch(e){this.cancel(m.id,e.message)}
   return true;
  }
 }
 return {Session,metadata,filename,MAX,MEDIA_MAX,CHUNK,digest};
});
