'use strict';
window.PolatkaMediaStore=(()=>{
 let opening,queue=Promise.resolve();
 function db(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open('polatka-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async function get(id){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result?.blob||null);r.onerror=()=>reject(r.error)})}
 function put(id,blob){const task=queue.catch(()=>{}).then(async()=>{const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('files','readwrite'),s=tx.objectStore('files');s.put({id,blob,at:Date.now()});const r=s.getAll();r.onsuccess=()=>{const all=r.result.sort((a,b)=>a.at-b.at);let total=all.reduce((n,x)=>n+x.blob.size,0);for(const x of all){if(total<=150*1024*1024)break;if(x.id!==id){s.delete(x.id);total-=x.blob.size}}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Хранилище недоступно'))})});queue=task;return task}
 return {get,put};
})();
