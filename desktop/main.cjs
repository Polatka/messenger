'use strict';
const {app,BrowserWindow,protocol,net,session,desktopCapturer,ipcMain,Menu,dialog}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('Polatka');let win,pending=null;
const origin='app://polatka';const trusted=url=>{try{const u=new URL(url);return u.protocol==='app:'&&u.hostname==='polatka'}catch{return false}};
function finishCapture(id){if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);const selected=p.sources.find(s=>s.id===id);try{p.callback(selected?{video:selected}:null)}catch{}}
function createWindow(){
 win=new BrowserWindow({title:'Polatka',icon:path.join(__dirname,'../assets/icon.png'),width:1180,height:800,minWidth:760,minHeight:580,backgroundColor:'#101412',show:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#101412',symbolColor:'#b8c2bc',height:38},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{if(!trusted(url))e.preventDefault()});
 win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.on('closed',()=>{finishCapture(null);win=null});
 win.once('ready-to-show',()=>win.show());win.loadURL(origin+'/index.html');
}
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 const allowed=new Set(['index.html','style.css','app.js','audio.js','appearance.js','logo.png','logo.jpg','transfer.js','media-store.js','features.js']);
 protocol.handle('app',request=>{const u=new URL(request.url);const file=u.pathname.slice(1);if(u.hostname!=='polatka'||!allowed.has(file))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(path.join(__dirname,'../renderer',file)).toString())});
 const ses=session.defaultSession;
 const permissions=new Set(['media','display-capture','speaker-selection','clipboard-sanitized-write']);
 ses.setPermissionCheckHandler((wc,p,origin,details)=>!!wc&&trusted(wc.getURL())&&(!details?.requestingUrl||trusted(details.requestingUrl))&&permissions.has(p));
 ses.setPermissionRequestHandler((wc,p,cb,details)=>cb(!!wc&&trusted(wc.getURL())&&(!details?.requestingUrl||trusted(details.requestingUrl))&&permissions.has(p)));
 ses.setDisplayMediaRequestHandler(async(request,callback)=>{
  if(!win||!request.frame||request.frame!==win.webContents.mainFrame||!trusted(request.frame.url)||pending)return callback(null);
  try{const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:280,height:160},fetchWindowIcons:false});
   if(!win||win.isDestroyed())return callback(null);
   pending={sources,callback,timer:setTimeout(()=>finishCapture(null),60000)};
   win.webContents.send('capture:sources',sources.map(s=>({id:s.id,name:s.name,thumbnail:s.thumbnail.toDataURL()})));
  }catch{callback(null)}
 });
 ipcMain.on('capture:select',(event,id)=>{if(win&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&trusted(event.senderFrame.url)&&(id===null||typeof id==='string'))finishCapture(id)});
 ipcMain.handle('attachment:save',async(event,payload)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trusted(event.senderFrame.url))return {error:'Доступ запрещён'};
  if(!payload||typeof payload.name!=='string'||!ArrayBuffer.isView(payload.bytes)||payload.bytes.byteLength>25*1024*1024)return {error:'Неверный файл'};
  const name=payload.name.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,120)||'file';
  try{const result=await dialog.showSaveDialog(win,{title:'Сохранить файл из Polatka',defaultPath:path.join(app.getPath('downloads'),name)});if(result.canceled||!result.filePath)return {saved:false};await require('node:fs/promises').writeFile(result.filePath,Buffer.from(payload.bytes.buffer,payload.bytes.byteOffset,payload.bytes.byteLength));return {saved:true}}catch{return {error:'Не удалось записать файл на диск'}}
 });
 createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow()});
});
app.on('window-all-closed',()=>app.quit());
