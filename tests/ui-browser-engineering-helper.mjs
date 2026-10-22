// Own isolated headless test browser only; never attaches to a user's profile or application session.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function inspectEngineeringDocument({binary,html,width,height=1000,evidenceDir}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-ui-cdp-test-')),profile=path.join(dir,'profile'),file=path.join(dir,'fixture.html');
 fs.writeFileSync(file,html,'utf8');
 let child,socket,stderr='',sequence=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TEST_TIMEOUT '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 try{
  child=spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-default-apps','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let startupError=null;child.once('error',e=>{startupError=e;});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-3000);});
  const portFile=path.join(profile,'DevToolsActivePort'),deadline=Date.now()+10000;
  let port;
  while(Date.now()<deadline){
   if(startupError)throw startupError;
   try{const value=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);if(Number.isInteger(value)&&value>0&&value<=65535){port=value;break;}}
   catch(error){if(!['ENOENT','EBUSY','EPERM'].includes(error.code))throw error;}
   await wait(100);
  }
  if(!port)throw Error('BROWSER_TEST_START_FAILED '+stderr);
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(3000)})).json();
  const target=targets.find(t=>t.type==='page'&&t.url==='about:blank');if(!target)throw Error('OWN_TEST_TARGET_MISSING');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(!m.id)return;const task=pending.get(m.id);if(!task)return;clearTimeout(task.timer);pending.delete(m.id);m.error?task.reject(Error(JSON.stringify(m.error))):task.resolve(m.result);});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:pathToFileURL(file).href});
  let result;const end=Date.now()+10000;
  while(Date.now()<end){const r=await send('Runtime.evaluate',{expression:"document.getElementById('ui-convergence-test-result')?.textContent || ''",returnByValue:true});if(r.result?.value){result=JSON.parse(r.result.value);break;}await wait(100);}
  if(!result)throw Error('BROWSER_LAYOUT_RESULT_MISSING '+stderr);
  if(evidenceDir){fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(path.join(evidenceDir,'layout-'+width+'.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(evidenceDir,'preview-'+width+'.html'),html);
   await send('Runtime.evaluate',{expression:"document.querySelector('.tt-context-section').open=false;document.querySelector('.tt-copy-fallback').open=false;document.getElementById('ai-settings').open=false;if(document.getElementById('home-ai'))document.getElementById('home-ai').open=false;window.scrollTo(0,0);"});
   const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidenceDir,'layout-'+width+'.png'),Buffer.from(shot.data,'base64'));
    if(width===390||width===1366){
      await send('Runtime.evaluate',{expression:"if(document.getElementById('home-research-drawer')){document.getElementById('home-research-drawer').open=true;document.getElementById('home-research-drawer').scrollIntoView({block:'start'});}"});
       await send('Runtime.evaluate',{expression:"(function(){const mark=document.createElement('div');mark.id='cru21-synthetic-evidence-watermark';mark.textContent='工程版面預覽 · 合成資料／測試帳號 · 非即時行情／非產品驗收';mark.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483600;background:#713449;color:#fff;padding:7px 12px;font:600 12px/1.55 system-ui,sans-serif;box-shadow:0 2px 7px rgba(0,0,0,.5)';document.body.append(mark)})()"});
       const watermarkVisible=await send('Runtime.evaluate',{expression:"(function(){const node=document.getElementById('cru21-synthetic-evidence-watermark');if(!node)return false;const box=node.getBoundingClientRect();return getComputedStyle(node).position==='fixed'&&Math.abs(box.top)<1&&box.width>=document.documentElement.clientWidth-1&&box.height>=24&&node.textContent.includes('合成資料')})()",returnByValue:true});
       if(watermarkVisible.result?.value!==true)throw Error('SYNTHETIC_WATERMARK_NOT_VISIBLE');
      const research=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(evidenceDir,'research-'+width+'.png'),Buffer.from(research.data,'base64'));
       await send('Runtime.evaluate',{expression:"document.getElementById('cru21-synthetic-evidence-watermark')?.remove();"});
      await send('Runtime.evaluate',{expression:"if(document.getElementById('home-research-drawer'))document.getElementById('home-research-drawer').open=false;"});
    }
   await send('Runtime.evaluate',{expression:"if(document.getElementById('home-ai'))document.getElementById('home-ai').open=true;document.getElementById('ai-inline').scrollIntoView({block:'start'});"});
   const consent=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidenceDir,'consent-'+width+'.png'),Buffer.from(consent.data,'base64'));
  }
  return result;
 }finally{
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}
  if(child&&child.exitCode===null){for(let i=0;i<20&&child.exitCode===null;i++)await wait(100);if(child.exitCode===null)child.kill();}
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('TEST_BROWSER_CLOSED'));}pending.clear();
  for(let attempt=0;attempt<40;attempt++){try{fs.rmSync(dir,{recursive:true,force:true});break;}catch(e){if(attempt===39)throw e;await wait(250);}}
 }
}
