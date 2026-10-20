'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('polatkaDesktop',{
 onCaptureSources:callback=>{const listener=(_event,sources)=>callback(sources);ipcRenderer.on('capture:sources',listener);return()=>ipcRenderer.removeListener('capture:sources',listener)},
 selectCapture:id=>ipcRenderer.send('capture:select',id),
 saveAttachment:payload=>ipcRenderer.invoke('attachment:save',payload)
});
