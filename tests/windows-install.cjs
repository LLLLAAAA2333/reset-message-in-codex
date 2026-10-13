'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
if(process.platform!=='win32')throw Error('This isolated lifecycle test requires Windows');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-win-install-test-'));
process.env.TIBO_RESET_DATA_DIR=path.join(temp,'data with spaces-中文');
const data=process.env.TIBO_RESET_DATA_DIR;
const manager=require('../windows/manage.cjs'),platform=require('../windows/platform.cjs');
const shortcutDirs={startup:path.join(temp,'Startup'),desktop:path.join(temp,'Desktop')};
for(const folder of Object.values(shortcutDirs))fs.mkdirSync(folder,{recursive:true});
platform.shortcutPaths=()=>shortcutDirs;
const {chromium}=require('playwright');
let fixture;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const app=path.join(temp,'Codex.exe');fs.copyFileSync(process.execPath,app);
  fs.mkdirSync(data,{recursive:true});
  const bootstrap=path.resolve(__dirname,'../.build/TiboReset-Windows/windows/bootstrap.ps1');
  const prepared=spawn('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',bootstrap,'-Action','prepare-runtime'],{stdio:'inherit',windowsHide:true});
  const prepareCode=await new Promise((resolve,reject)=>{prepared.once('exit',resolve);prepared.once('error',reject);});assert.equal(prepareCode,0);
  assert.ok(fs.existsSync(path.join(data,'runtime/node.exe')));assert.ok(fs.existsSync(path.join(data,'runtime/Node-LICENSE.txt')));
  const settings={port:39461,appPath:app,codexBin:process.execPath,edgePath:chromium.executablePath(),model:'fixture-preserved-model'};
  fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify(settings));
  fs.writeFileSync(path.join(data,'fixture-cache.json'),'fixture preserved');
  platform.powershell(`$errors = $null; $tokens = $null; Get-ChildItem -LiteralPath ${platform.quote(path.resolve(__dirname,'../windows'))} -Filter '*.ps1' | ForEach-Object { [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors); if($errors.Count){throw 'PowerShell syntax errors'} }`);
  await manager.install();assert.equal(platform.isRunning(data),true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'settings.json'))).model,settings.model);
  const first=JSON.parse(fs.readFileSync(path.join(data,'status.json')));
  assert.equal(first.version,'0.2.0');assert.equal(first.startup.mode,'manual-launch');assert.equal(first.connectedWindows,0);
  const acl=platform.powershell(`$acl = Get-Acl -LiteralPath ${platform.quote(data)}; $acl.AreAccessRulesProtected`);assert.equal(acl,'True');
  assert.ok(!fs.existsSync(path.join(data,'XSession')),'Install must not start an X login browser');
  manager.startMonitor();await wait(1000);assert.equal(platform.isRunning(data),true,'Duplicate runner must preserve the existing monitor');
  await manager.install();assert.ok(JSON.parse(fs.readFileSync(path.join(data,'status.json'))).checkedAt>first.checkedAt,'Upgrade must stop and replace the old backend');
  const badBundle=path.join(temp,'broken-package');
  for(const name of manager.runtimeFiles){const dest=path.join(badBundle,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../.build/TiboReset-Windows',name),dest);}
  const originalApp=path.resolve(__dirname,'../.build/TiboReset-Windows/app.cjs');
  fs.writeFileSync(path.join(badBundle,'app.cjs'),`module.exports=require(${JSON.stringify(originalApp)});if(require.main===module)throw Error('fixture startup failure');`);
  require(path.join(badBundle,'windows/platform.cjs')).shortcutPaths=()=>shortcutDirs;
  const badManager=require(path.join(badBundle,'windows/manage.cjs'));
  await assert.rejects(badManager.install(),/新后台没有正常启动/);
  for(let i=0;i<30;i++){if(platform.isRunning(data))break;await wait(500);}
  assert.equal(platform.isRunning(data),true,'Failed upgrade restores the previous backend');
  assert.equal(fs.readFileSync(path.join(data,'app.cjs'),'utf8'),fs.readFileSync(originalApp,'utf8'));
  const stop=path.join(temp,'fixture.stop');
  fixture=spawn(app,['-e',`setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(stop)}))process.exit(0)},100)`],{stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{fixture.once('spawn',resolve);fixture.once('error',reject);});await wait(1000);
  await assert.rejects(manager.launch(),/正在运行/);assert.equal(fixture.exitCode,null,'Launcher must not close a running desktop');
  fs.writeFileSync(stop,'stop');await new Promise(resolve=>fixture.once('exit',resolve));fixture=null;
  await manager.uninstall();assert.equal(platform.isRunning(data),false);
  assert.equal(fs.readFileSync(path.join(data,'fixture-cache.json'),'utf8'),'fixture preserved');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'settings.json'))),settings);
  console.log('PASS real Windows isolated install, ACLs, singleton runner, upgrade and failure rollback, active-client refusal, graceful backend stop, shortcut removal and retained data');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(fixture){fs.writeFileSync(path.join(temp,'fixture.stop'),'stop');await new Promise(resolve=>fixture.once('exit',resolve));}
  await manager.uninstall().catch(()=>{});fs.rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});
});
