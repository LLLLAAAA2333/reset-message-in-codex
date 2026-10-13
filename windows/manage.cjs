'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const platform = require('./platform.cjs');
const bundle = fs.existsSync(path.join(__dirname,'../app.cjs')) ? path.dirname(__dirname) : path.resolve(__dirname,'../.build/TiboReset-Windows');
const api = require(path.join(bundle,'app.cjs')), data=api.DATA_DIR;
const runtimeFiles = ['app.cjs','native/collector.js','windows/bridge.cjs','windows/platform.cjs','windows/manage.cjs','windows/runner.ps1','windows/bootstrap.ps1','windows/runtime.json','install.cmd','status.cmd','launch-codex.cmd','uninstall.cmd'];
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const stopFile=path.join(data,'stop.request');
async function stopMonitor() {
  fs.mkdirSync(data,{recursive:true}); fs.writeFileSync(stopFile,'stop',{mode:0o600});
  for(let i=0;i<35;i++) {
    let bridgeAlive=false;
    try { const pid=Number(fs.readFileSync(path.join(data,'x-bridge.lock'),'utf8'));
      if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid X helper lock');
      try {process.kill(pid,0);bridgeAlive=true;}catch(error){if(error.code!=='ESRCH')bridgeAlive=true;}
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    if(!platform.isRunning(data)&&!bridgeAlive)return; await wait(500);
  }
  throw Error('Tibo Reset 后台尚未正常退出；保留现有文件，请稍后重试。');
}
function startMonitor() {
  fs.rmSync(stopFile,{force:true});
  // Node's DETACHED_PROCESS flag makes Windows PowerShell exit before loading a script.
  // Start-Process creates an independent hidden process with a usable console instead.
  platform.powershell(`$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${platform.quote(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'))} -ArgumentList ${platform.quote(runnerArguments())} -WorkingDirectory ${platform.quote(data)} -WindowStyle Hidden -RedirectStandardOutput ${platform.quote(path.join(data,'runner.log'))} -RedirectStandardError ${platform.quote(path.join(data,'runner.err.log'))} | Out-Null`);
}
function runnerArguments() {
  return `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${path.join(data,'windows/runner.ps1')}" -DataDir "${data}" -NodePath "${process.execPath}"`;
}
function privateDirectory() {
  platform.powershell(`$ErrorActionPreference = 'Stop'
$path = ${platform.quote(data)}
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($sid in @($user, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.SetAccessRule($rule)
}
Set-Acl -LiteralPath $path -AclObject $acl`);
}
function createShortcut(file,target,args) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  platform.powershell(`$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut(${platform.quote(file)})
$shortcut.TargetPath = ${platform.quote(target)}
$shortcut.Arguments = ${platform.quote(args)}
$shortcut.WorkingDirectory = ${platform.quote(data)}
$shortcut.Description = 'Tibo Reset'
$shortcut.Save()`);
}
function ownShortcut(file) {
  if(!fs.existsSync(file))return;
  const description=platform.powershell(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${platform.quote(file)}); $s.Description`);
  if(description!=='Tibo Reset')throw Error('快捷方式名称已被其他程序使用：'+path.basename(file));
}
function shortcutFiles() {
  const folders=platform.shortcutPaths();
  return {startup:path.join(folders.startup,'Tibo Reset Monitor.lnk'),desktop:path.join(folders.desktop,'Codex - Tibo Reset.lnk')};
}
async function install() {
  if(process.platform!=='win32')throw Error('此安装器需要 Windows 11。');
  if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24.14+。');
  const settings=api.readSettings(), desktop=api.findDesktop(settings.appPath); platform.findEdge(settings.edgePath);
  for(const file of runtimeFiles)if(!fs.statSync(path.join(bundle,file)).isFile())throw Error('安装文件缺失：'+file);
  const shortcuts=shortcutFiles(); for(const file of Object.values(shortcuts))ownShortcut(file);
  fs.mkdirSync(data,{recursive:true}); privateDirectory();
  const backup=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-win-install-'));
  const files=[...runtimeFiles.map(name=>path.join(data,name)),path.join(data,'settings.json'),...Object.values(shortcuts)];
  const existed=new Set(files.filter(file=>fs.existsSync(file)));
  for(const [i,file] of files.entries())if(existed.has(file))fs.copyFileSync(file,path.join(backup,String(i)));
  const wasRunning=platform.isRunning(data), wasStopped=fs.existsSync(stopFile);let keepBackup=false;
  try {
    await stopMonitor();
    for(const name of runtimeFiles) {
      const from=path.join(bundle,name), to=path.join(data,name); fs.mkdirSync(path.dirname(to),{recursive:true});
      if(path.resolve(from)!==path.resolve(to))fs.copyFileSync(from,to);
    }
    const config=path.join(data,'settings.json');
    if(!fs.existsSync(config))fs.writeFileSync(config,JSON.stringify({port:39222,xPollSeconds:60,displayTimezone:'Asia/Shanghai',appPath:desktop.app,codexBin:desktop.codex},null,2),{mode:0o600});
    api.readSettings(config);
    createShortcut(shortcuts.startup,path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),runnerArguments());
    createShortcut(shortcuts.desktop,path.join(process.env.SystemRoot,'System32/cmd.exe'),`/d /s /c ""${path.join(data,'launch-codex.cmd')}""`);
    const started=Date.now(); startMonitor(); let healthy=false;
    for(let i=0;i<30;i++) {
      await wait(500);
      try { const health=JSON.parse(fs.readFileSync(path.join(data,'status.json'),'utf8'));
        if(health.checkedAt>=started && health.startup?.running && platform.isRunning(data)) { healthy=true;break; }
      } catch {}
    }
    if(!healthy)throw Error('新后台没有正常启动，正在恢复安装前的文件和快捷方式。');
    console.log(`Tibo Reset 0.2.0 已安装：${data}\n请用桌面的 Codex - Tibo Reset 快捷方式连接侧边栏。当前客户端会保留。`);
  } catch(error) {
    try { await stopMonitor(); } catch { keepBackup=true;throw Error('后台尚未退出，已保留回滚文件：'+backup+'；请运行 status.cmd 排查后重试。'); }
    for(const [i,file] of files.entries()) {
      if(existed.has(file))fs.copyFileSync(path.join(backup,String(i)),file); else fs.rmSync(file,{force:true});
    }
    if(wasRunning)startMonitor(); else if(!wasStopped)fs.rmSync(stopFile,{force:true});
    throw error;
  } finally { if(!keepBackup)fs.rmSync(backup,{recursive:true,force:true}); }
}
async function evaluateWindows(expression) {
  const values=[];
  for(const page of await api.desktopPages(api.readSettings().port).catch(()=>[])) {
    const channel=new api.PageChannel(page,api.readSettings().port);
    try { await channel.open(); values.push(await channel.evaluate(expression)); } finally { channel.close(); }
  }
  return values;
}
async function status() {
  let health=null; try {health=JSON.parse(fs.readFileSync(path.join(data,'status.json'),'utf8'));}catch{}
  console.log(JSON.stringify({running:platform.isRunning(data),data,health,windows:await evaluateWindows('window.__tiboReset?.status() ?? null').catch(()=>[])},null,2));
}
async function launch() {
  const settings=api.readSettings(), desktop=api.findDesktop(settings.appPath);
  if((await api.desktopPages(settings.port).catch(()=>[])).length) {console.log('侧边栏连接已开启，可以使用当前窗口。');return;}
  const name=path.basename(desktop.app).replace(/\.exe$/i,'');
  const running=platform.powershell(`if (@(Get-Process -Name ${platform.quote(name)} -ErrorAction SilentlyContinue).Count -gt 0) { 'true' } else { 'false' }`);
  if(running==='true')throw Error('桌面客户端正在运行但尚未开启侧边栏连接。请自行保存工作并退出，再运行 launch-codex.cmd；不会自动关闭客户端。');
  const args=['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${settings.port}`];
  const child=spawn(desktop.app,args,{detached:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:args.join(' ')}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}); child.unref();
  console.log('已请求启动桌面客户端。运行 status.cmd 检查侧边栏连接。');
}
async function uninstall() {
  await stopMonitor(); await evaluateWindows('window.__tiboReset?.destroy()').catch(()=>{});
  for(const file of Object.values(shortcutFiles())) {ownShortcut(file);fs.rmSync(file,{force:true});}
  console.log('Tibo Reset 后台和快捷方式已停用，本地设置、缓存和 X 登录保留在：'+data);
}
module.exports={install,status,launch,uninstall,stopMonitor,startMonitor,runtimeFiles};
if(require.main===module) {
  const work={install,status,launch,uninstall}[process.argv[2]];
  if(!work){console.error('install | status | launch | uninstall');process.exitCode=1;}
  else Promise.resolve().then(work).catch(error=>{console.error(error.message);process.exitCode=1;});
}
