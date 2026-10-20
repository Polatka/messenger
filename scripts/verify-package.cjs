// Verify a Windows directory produced by electron-builder against this source.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const asar=require('@electron/asar'),resedit=require('resedit');
const root=path.resolve(__dirname,'..'),dir=path.resolve(process.argv[2]||path.join(root,'release/win-unpacked'));
const archive=path.join(dir,'resources/app.asar'),manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
let checked=0;
function verify(relative){
 const source=path.join(root,relative),stat=fs.lstatSync(source);
 if(stat.isDirectory()){for(const name of fs.readdirSync(source))verify(path.join(relative,name));return}
 assert.equal(stat.isFile(),true,'Unexpected symlink/non-file: '+relative);
 const entry=relative.split(path.sep).join('/');
 assert.deepEqual(asar.extractFile(archive,entry),fs.readFileSync(source),'Archive differs from source: '+entry);checked++;
}
for(const relative of['desktop','renderer','assets'])verify(relative);
const packedManifest=JSON.parse(asar.extractFile(archive,'package.json').toString());
assert.equal(packedManifest.version,manifest.version);assert.equal(packedManifest.main,manifest.main);
assert.equal(asar.listPackage(archive).some(p=>p.includes('/node_modules/')),false,'Unexpected dependencies inside packaged application');
const resources=resedit.NtExecutableResource.from(resedit.NtExecutable.from(fs.readFileSync(path.join(dir,'Polatka.exe'))));
const integrity=resources.entries.find(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');
assert.ok(integrity,'Missing executable ASAR-integrity resource');
const record=JSON.parse(Buffer.from(integrity.bin).toString()).find(e=>e.file.replaceAll('\\','/')==='resources/app.asar');
assert.ok(record,'Missing app.asar integrity entry');assert.equal(record.alg,'SHA256');assert.equal(record.value,hash(asar.getRawHeader(archive).headerString));
const info=resedit.Resource.VersionInfo.fromEntries(resources.entries)[0];assert.ok(info,'Missing executable version');
const languages=info.getAllLanguagesForStringValues();assert.ok(languages.length);
assert.equal(info.getStringValues(languages[0]).FileVersion,manifest.version);
console.log(`PASS Windows package ${manifest.version}: ${checked} source files, manifest, executable version and ASAR header integrity verified`);
