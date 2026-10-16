// Run this acceptance smoke test on Windows against the compiled native app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
if(process.platform!=='win32')throw Error('Native Windows tray acceptance requires Windows');
const arch=process.arch==='arm64'?'arm64':'x64',bundle=path.resolve(__dirname,'../.build/TiboReset-Windows-'+arch),exe=path.join(bundle,'Tibo Reset.exe');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-native-tray-')),report=path.join(root,'layout.json');
const env={...process.env,TIBO_RESET_DATA_DIR:root};let child;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(args,timeout){child=spawn(exe,args,{env,stdio:'ignore'});const exited=new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});return Promise.race([exited,wait(timeout).then(()=>{throw Error('Native tray test timed out; inspect disposable process '+child.pid);})]);}
(async()=>{
  assert.equal(await run(['--self-test',report],15000),0);
  const layout=JSON.parse(fs.readFileSync(report));assert.ok(layout.InsideScreen&&layout.HeaderVisible&&layout.FooterVisible&&layout.ConnectionVisible&&layout.Cards>0);
  fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({sidebarEnabled:true,appPath:'C:\\not-installed\\Client.exe'}));
  fs.writeFileSync(path.join(root,'x-announcements-cache.json'),JSON.stringify({version:1,enabled:false,posts:[],records:[],unread:[]}));
  child=spawn(exe,[],{env,stdio:'ignore'});const exited=new Promise(r=>child.once('exit',r));
  for(let i=0;i<100&&!fs.existsSync(path.join(root,'status.json'));i++)await wait(100);
  const status=JSON.parse(fs.readFileSync(path.join(root,'status.json')));assert.equal(status.mode,'tray');assert.equal(status.connectedWindows,0);assert.equal(status.xState,'disconnected');
  fs.writeFileSync(path.join(root,'stop.request'),'');assert.equal(await Promise.race([exited,wait(25000).then(()=> 'timeout')]),0);
  console.log('PASS real Windows tray: screen-bounded layout, native startup, bundled runtime, no desktop dependency and graceful shutdown');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(child?.exitCode!==null)fs.rmSync(root,{recursive:true,force:true});});
