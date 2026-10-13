'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {CDP,publicMessage,WindowsXSource}=require('../windows/bridge.cjs');
const {findDesktop}=require('../windows/platform.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tibo-win-source-test-'));
const events=[], until=async(check,message)=>{for(let i=0;i<120;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error(message);};
let source;
(async()=>{
  const fakeApp=path.join(temp,'Codex.exe'),fakeCLI=path.join(temp,'resources/codex-cli/codex.exe');
  fs.mkdirSync(path.dirname(fakeCLI),{recursive:true});fs.writeFileSync(fakeApp,'fixture');fs.writeFileSync(fakeCLI,'fixture');
  assert.equal(findDesktop({appPath:fakeApp}).codex,fakeCLI);
  assert.throws(()=>findDesktop({appPath:fakeApp,codexBin:fakeApp}));
  for(const url of ['ws://example.com:9234/test','ws://127.0.0.1:39222/test','wss://127.0.0.1:9234/test','ws://user:pass@127.0.0.1:9234/test'])assert.throws(()=>new CDP(url,9234));
  const post={id:'501',author:'thsottiaux',url:'https://x.com/thsottiaux/status/501',text:'Day 9/ Reset',publishedAt:new Date().toISOString(),cookie:'fixture-private-field',headers:{authorization:'fixture-only'}};
  const safe=publicMessage({type:'posts',endpoint:'UserTweets',posts:[post,{...post,id:'502',author:'unrelated'}],cookies:'fixture-private-field'});
  assert.equal(safe.posts.length,1);assert.equal(safe.posts[0].cookie,undefined);assert.equal(safe.cookies,undefined);assert.equal(safe.posts[0].headers,undefined);
  assert.equal(publicMessage({type:'posts',endpoint:'HomeTimeline',posts:[post]}),null);
  source=new WindowsXSource({data:temp,script:path.resolve(__dirname,'../.build/TiboReset-Windows/native/collector.js'),browser:process.env.PLAYWRIGHT_EXECUTABLE_PATH||chromium.executablePath(),emit:value=>events.push(value)});
  await source.initialize();assert.equal(source.child,undefined,'First install must not open or load X before Connect');
  assert.equal(events.at(-1).state,'login-required');
  await source.launch(false);
  const installFixture=async()=>{
    const page=source.page,originalEvents=page.events;
    page.events=(method,params)=>{
      originalEvents(method,params);
      if(method!=='Fetch.requestPaused')return;
      const url=new URL(params.request.url);let content,type='text/html';
      if(url.pathname.includes('/graphql/')) {
        type='application/json';content=JSON.stringify({data:{result:{rest_id:'501',core:{user_results:{result:{rest_id:'42',core:{screen_name:'thsottiaux'}}}},legacy:{full_text:'Day 9/ Reset',created_at:new Date().toISOString(),conversation_id_str:'501'}}}});
      } else {
        const endpoint=url.pathname.endsWith('/with_replies')?'UserTweetsAndReplies':'UserTweets';
        content=`<html><body>isolated fixture<script>localStorage.setItem('tiboFixture','preserved');setTimeout(()=>fetch('/i/api/graphql/fixture/${endpoint}'),300)</script></body></html>`;
      }
      page.call('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type}],body:Buffer.from(content).toString('base64')}).catch(()=>{});
    };
    await page.call('Fetch.enable',{patterns:[{urlPattern:'https://x.com/*'}]});
  };
  await installFixture();await source.refresh();
  await until(()=>events.some(e=>e.type==='posts'&&e.endpoint==='UserTweets')&&events.some(e=>e.type==='posts'&&e.endpoint==='UserTweetsAndReplies'),'Main posts and replies were not both captured');
  assert.ok(fs.existsSync(source.marker));assert.equal(events.find(e=>e.type==='posts').posts[0].text,'Day 9/ Reset');
  const count=events.length, payload=JSON.stringify({type:'posts',endpoint:'UserTweets',posts:[post]});
  source.contexts.set(999,{origin:'https://evil.example',auxData:{isDefault:true,frameId:source.mainFrame}});
  source.page.events('Runtime.bindingCalled',{name:'__tiboXNative',executionContextId:999,payload});assert.equal(events.length,count);
  source.contexts.set(998,{origin:'https://x.com',auxData:{isDefault:true,frameId:'other-frame'}});
  source.page.events('Runtime.bindingCalled',{name:'__tiboXNative',executionContextId:998,payload});assert.equal(events.length,count);
  assert.ok(!JSON.stringify(events).includes('fixture-private-field'));
  await source.closeBrowser();assert.ok(fs.existsSync(source.profile),'Stopping preserves the dedicated profile');
  await source.launch(false);await installFixture();await source.refresh();
  await until(()=>source.page?.socket?.readyState===WebSocket.OPEN&&source.contexts.size>0,'Reopened session not ready');
  await until(()=>!source.loadingAt,'Reopened fixture did not load');
  const stored=await source.page.call('Runtime.evaluate',{expression:'localStorage.getItem("tiboFixture")',returnByValue:true});assert.equal(stored.result.value,'preserved');
  const originalLaunch=source.launch.bind(source), oldPage=source.page, previousBatches=events.filter(e=>e.type==='posts').length;
  source.launch=async visible=>{await originalLaunch(visible);await installFixture();};
  await oldPage.call('Page.close').catch(()=>{});
  await until(()=>source.page && source.page!==oldPage && events.filter(e=>e.type==='posts').length>previousBatches,'Closing the source window must resume collection with the private profile');
  assert.equal(source.visible,false);
  await source.command({action:'disconnect'});
  assert.equal(events.at(-1).state,'disconnected');assert.ok(!fs.existsSync(source.profile));assert.ok(!fs.existsSync(source.marker));
  console.log('PASS Windows source: private profile, initial login consent, real Chromium/CDP transport, public-field filtering, top-frame origin checks, posts/replies, persistence, graceful close and disconnect');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(source){source.stopped=true;await source.closeBrowser().catch(()=>{});}fs.rmSync(temp,{recursive:true,force:true,maxRetries:30,retryDelay:200});});
