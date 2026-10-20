const test=require('node:test'),assert=require('node:assert/strict');
const {Session,metadata,MAX,CHUNK,digest}=require('../renderer/transfer.js');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function pair({accept=true}={}){const done=deferred(),sent=deferred(),errors=[],offers=[];let a,b;
 a=new Session({send:m=>{setImmediate(()=>b.handle(m));return true},onSent:(m,blob)=>sent.resolve({m,blob}),onError:(m,e)=>errors.push(e)});
 b=new Session({send:m=>{setImmediate(()=>a.handle(m));return true},onOffer:m=>{offers.push(m);if(accept)b.accept(m.id)},onComplete:(m,blob)=>done.resolve({m,blob}),onError:(m,e)=>errors.push(e)});
 return {a,b,done,sent,errors,offers,close(){a.close();b.close()}}}
test('file travels in ordered chunks and is acknowledged after SHA-256 verification',{timeout:5000},async()=>{
 const p=pair();try{const bytes=crypto.getRandomValues(new Uint8Array(CHUNK*3+137));const source=new Blob([bytes],{type:'application/octet-stream'});await p.a.offer(source,{name:'image.bin'});const {blob}=await p.done.promise;await p.sent.promise;assert.equal(await digest(blob),await digest(source));assert.equal(p.a.out,null);assert.equal(p.b.input,null);assert.deepEqual(p.errors,[])}finally{p.close()}
});
test('empty files are valid and complete without data chunks',{timeout:5000},async()=>{const p=pair();try{await p.a.offer(new Blob([]),{name:'empty.txt'});assert.equal((await p.done.promise).blob.size,0);await p.sent.promise}finally{p.close()}});
test('incoming ordinary file waits for acceptance; decline releases both sides',async()=>{const p=pair({accept:false});try{await p.a.offer(new Blob(['private']),{name:'notes.txt'});await new Promise(r=>setTimeout(r,30));assert.equal(p.b.input.phase,'offered');assert.equal(p.b.input.bytes,0);p.b.cancel(p.offers[0].id);await new Promise(r=>setTimeout(r,30));assert.equal(p.a.out,null);assert.equal(p.b.input,null)}finally{p.close()}});
test('incorrect chunk order and oversized metadata are rejected',async()=>{
 const errors=[],s=new Session({send:()=>true,onOffer:m=>s.accept(m.id),onError:(m,e)=>errors.push(e)});
 const id=crypto.randomUUID();await s.handle({type:'file-offer',id,name:'x',size:100,kind:'file'});await s.handle({type:'file-chunk',id,seq:4,data:btoa('abc')});assert.equal(s.input,null);assert.match(errors[0],/блок/);
 await s.handle({type:'file-offer',id:crypto.randomUUID(),size:MAX+1,kind:'file'});assert.equal(s.input,null);s.close();
});
test('wrong checksum cannot produce a received attachment',async()=>{
 const errors=[],s=new Session({send:()=>true,onOffer:m=>s.accept(m.id),onComplete:()=>assert.fail('corrupt file accepted'),onError:(m,e)=>errors.push(e)}),id=crypto.randomUUID();
 await s.handle({type:'file-offer',id,name:'x',size:3,kind:'file'});await s.handle({type:'file-chunk',id,seq:0,data:btoa('abc')});await s.handle({type:'file-end',id,hash:'0'.repeat(64)});assert.equal(s.input,null);assert.match(errors[0],/сумма/);s.close();
});
test('blocked output buffer can be cancelled; disconnect clears pending transfer',async()=>{
 const s=new Session({send:()=>true,buffered:()=>1000000});const m=await s.offer(new Blob(['test']),{name:'x'});await s.handle({type:'file-accept',id:m.id});s.close();await new Promise(r=>setTimeout(r,25));assert.equal(s.out,null);assert.equal(s.closed,true);
});
test('media metadata rejects unsupported MIME, infinite duration and oversized recording',()=>{
 const m={id:crypto.randomUUID(),size:100,kind:'voice',name:'voice.webm',mime:'audio/webm;codecs=opus',duration:2};assert.ok(metadata(m));assert.equal(metadata({...m,mime:'text/html'}),null);assert.equal(metadata({...m,duration:Infinity}),null);assert.equal(metadata({...m,size:MAX}),null);assert.equal(metadata({...m,kind:'video',mime:'video/webm',duration:61}),null);
});
