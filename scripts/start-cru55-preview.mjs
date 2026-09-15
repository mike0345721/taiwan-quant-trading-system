import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,PRIVATE,BRANCH,isolated,loadPreview} from '../src/cru55-preview-bundle.mjs';
import {assertPlainPath} from '../src/cvd-observation-isolation.mjs';
import {createPreviewServer} from '../src/cru55-preview-server.mjs';
try {
  const head=isolated({clean:true}),bundleHash=process.argv[2],bundle=loadPreview(bundleHash),assets={};
  for(const [route,file,type] of [['/','cru55-preview.html','text/html'],['/preview.css','cru55-preview.css','text/css'],['/preview.js','cru55-preview.js','text/javascript'],['/presentation.mjs','cru55-presentation.mjs','text/javascript'],['/terminal.js','trader-terminal-shell.js','text/javascript']]) assets[route]={body:fs.readFileSync(assertPlainPath(path.join(ROOT,'public',file))),type:type+'; charset=utf-8'};
  const vendor=path.join(path.dirname(fileURLToPath(import.meta.resolve('lightweight-charts'))),'lightweight-charts.standalone.production.js');
  if(!vendor.startsWith(path.join(ROOT,'node_modules')+path.sep))throw Error('LOCAL_VENDOR_REQUIRED');
  assets['/vendor.js']={body:fs.readFileSync(assertPlainPath(vendor)),type:'text/javascript; charset=utf-8'};
  assets['/favicon.ico']={body:Buffer.alloc(0),type:'image/x-icon'};
  const {server,token}=createPreviewServer({bundle,assets,head});
  server.once('error',e=>{console.error(e.code||e.message);process.exitCode=1;});
  server.listen({port:3055,host:'127.0.0.1',exclusive:true},()=>{
    const folder=assertPlainPath(path.join(PRIVATE,'runtime'));fs.mkdirSync(folder,{recursive:true});
    const receipt={head,branch:BRANCH,bundleHash,pid:process.pid,url:'http://127.0.0.1:3055/',bootstrapUrl:`http://127.0.0.1:3055/#${token}`,startedAt:new Date().toISOString()};
    fs.writeFileSync(assertPlainPath(path.join(folder,`session-${process.pid}.json`)),JSON.stringify(receipt),{flag:'wx'});
    console.log(JSON.stringify({head,bundleHash,pid:process.pid,url:receipt.url,state:'CRU55_ISOLATED_DASHBOARD_PREVIEW'}));
  });
}catch(e){console.error(e.message);process.exitCode=1;}
