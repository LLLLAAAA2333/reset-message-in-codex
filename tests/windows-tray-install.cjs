// Exercise native-app installation on any host; never run Windows executables
// or touch the user's actual Startup folder, desktop, settings or X profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),api=require('./bundle.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-tray-install-')),bundle=path.join(root,'package'),data=path.join(root,'data');
const folders={startup:path.join(root,'Startup'),desktop:path.join(root,'Desktop')};
let running=false,failStarts=0,launches=0;
const scripts=[];
const platform={
  isRunning:()=>{if(fs.existsSync(path.join(data,'stop.request')))running=false;return running;},
  shortcutPaths:()=>folders,quote:s=>"'"+s.replace(/'/g,"''")+"'",powershell:s=>{scripts.push(s);return '';},
  findDesktop:()=>{throw Error('Native tray installation must not require a desktop client');},findEdge:()=>path.join(root,'Edge.exe')
};
const names=['app.cjs','native/collector.js','windows/bridge.cjs','windows/platform.cjs','windows/manage.cjs','windows/runner.ps1','windows/bootstrap.ps1','windows/runtime.json','install.cmd','status.cmd','launch-codex.cmd','uninstall.cmd','Tibo Reset.exe','runtime/node.exe','runtime/Node-LICENSE.txt','build-info.json','licenses/runtime-LICENSE.txt'];
for(const name of names){const file=path.join(bundle,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture '+name);}
fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({model:'fixture-selected-model',sidebarEnabled:true}));
fs.writeFileSync(path.join(data,'x-session-ready'),'fixture session retained');
const spawn=(file,args)=>{
  assert.equal(file,path.join(data,'Tibo Reset.exe'));assert.deepEqual(Array.from(args),[]);launches++;
  const child=new EventEmitter();child.unref=()=>{};
  if(failStarts){failStarts--;running=false;return child;}
  running=true;fs.writeFileSync(path.join(data,'status.json'),JSON.stringify({checkedAt:Date.now(),mode:'tray',startup:{running:true,mode:'tray'}}));return child;
};
const fakeApi={...api,DATA_DIR:data,readSettings:()=>api.readSettings(path.join(data,'settings.json')),findDesktop:platform.findDesktop,desktopPages:()=>{throw Error('Native app must not connect to a desktop debug port');}};
const load=name=>name==='./platform.cjs'?platform:name==='node:child_process'?{spawn}:name.endsWith('/app.cjs')?fakeApi:require(name);
load.main=null;const moduleFixture={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../windows/manage.cjs'),'utf8'),{
  require:load,module:moduleFixture,__dirname:path.join(bundle,'windows'),process:{platform:'win32',versions:{node:'24.21.0'},env:{SystemRoot:root},execPath:path.join(bundle,'runtime/node.exe')},
  setTimeout:(fn)=>setTimeout(fn,1),console:{log(){},error(){}}
});
(async()=>{
  const manager=moduleFixture.exports;
  await manager.install();assert.equal(running,true);assert.equal(launches,1);
  assert.equal(fs.readFileSync(path.join(data,'Tibo Reset.exe'),'utf8'),'fixture Tibo Reset.exe');
  assert.ok(manager.runtimeFiles.includes('runtime/node.exe')&&manager.runtimeFiles.includes('licenses/runtime-LICENSE.txt'));
  assert.ok(scripts.some(s=>s.includes('TargetPath')&&s.includes('Tibo Reset.exe')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'settings.json'))).model,'fixture-selected-model');
  failStarts=1;await assert.rejects(manager.install(),/新后台没有正常启动/);assert.equal(running,true,'Restore native app after failed upgrade');
  assert.equal(fs.readFileSync(path.join(data,'Tibo Reset.exe'),'utf8'),'fixture Tibo Reset.exe');
  await manager.uninstall();assert.equal(running,false);
  assert.equal(fs.readFileSync(path.join(data,'x-session-ready'),'utf8'),'fixture session retained');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'settings.json'))).model,'fixture-selected-model');
  console.log('PASS isolated Windows tray installer: native launch, startup shortcuts, bundled runtime/licenses, no desktop dependency, failed-upgrade rollback and retained session/settings');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
