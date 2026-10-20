// Offline packaging using the existing, unchanged Electron Windows runtime.
// Usage: node scripts/repack-existing.cjs /absolute/path/to/win-unpacked /absolute/output
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const asar=require('@electron/asar'),resedit=require('resedit'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),input=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
 if(input===out||out.startsWith(input+path.sep))throw Error('Output must be separate from input');
 await fs.cp(input,out,{recursive:true,filter:source=>path.basename(source)!=='Source'&&!path.basename(source).startsWith('.')});
 const staging=out+'-app';await fs.mkdir(staging,{recursive:true});
 for(const entry of ['desktop','renderer','assets','package.json'])await fs.cp(path.join(root,entry),path.join(staging,entry),{recursive:true});
 const target=path.join(out,'resources','app.asar');await asar.createPackage(staging,target);
 for(const f of ['renderer/app.js','renderer/style.css','renderer/index.html','renderer/features.js','renderer/transfer.js','renderer/media-store.js','desktop/main.cjs','desktop/preload.cjs','package.json'])assert.deepEqual(asar.extractFile(target,f),await fs.readFile(path.join(root,f)));
 const exePath=path.join(out,'Polatka.exe'),exe=resedit.NtExecutable.from(await fs.readFile(exePath)),resources=resedit.NtExecutableResource.from(exe);
 const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
 for(const info of resedit.Resource.VersionInfo.fromEntries(resources.entries)){
  info.setFileVersion(version);info.setProductVersion(version);info.outputToResourceEntries(resources.entries);
 }
 const integrity=resources.entries.find(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');
 const raw=asar.getRawHeader(target);const hash=crypto.createHash('sha256').update(raw.headerString).digest('hex');
 if(integrity){const data=JSON.parse(Buffer.from(integrity.bin).toString());for(const entry of data)if(entry.file==='resources\\app.asar'||entry.file==='resources/app.asar')entry.value=hash;const bytes=Buffer.from(JSON.stringify(data));integrity.bin=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}
 resources.outputResource(exe);await fs.writeFile(exePath,Buffer.from(exe.generate()));
 const check=resedit.NtExecutableResource.from(resedit.NtExecutable.from(await fs.readFile(exePath)));
 const v=resedit.Resource.VersionInfo.fromEntries(check.entries)[0];const [major,minor,patch]=version.split('.').map(Number);assert.equal(v.fixedInfo.fileVersionMS,(major<<16)|minor);assert.equal(v.fixedInfo.fileVersionLS,patch<<16);
 console.log('Windows application packaged and source/PE resources verified:',out);
})().catch(e=>{console.error(e);process.exitCode=1});
