import fs from 'node:fs';
import path from 'node:path';
import { sendJson } from './http-utils.mjs';
import { createDynamicReader } from './cru55-dynamic-reader.mjs';
import { readRuntimeBinding } from './cru55-runtime-binding.mjs';

// A separate production mount. The frozen isolated adapter and its guards stay intact.
export function prepareFormalEntry({ publicDir }, readSnapshot) {
  const binding=process.env.CRU55_RUNTIME_BINDING?readRuntimeBinding(process.env.CRU55_RUNTIME_BINDING,{runtimeRoot:path.dirname(publicDir),activation:true}):null;
  if(binding&&process.env.CRU55_DYNAMIC_ROOT&&path.resolve(process.env.CRU55_DYNAMIC_ROOT)!==binding.readerRoot)throw Error('CRU55_BINDING_READER_ENV_MISMATCH');
  const dynamic = createDynamicReader(binding?.readerRoot??process.env.CRU55_DYNAMIC_ROOT);
  const files = {
    '/': 'cru55-preview.html', '/index.html': 'cru55-preview.html',
    '/preview.css': 'cru55-preview.css', '/preview.js': 'cru55-preview.js',
    '/formal-overview.js': 'cru55-formal-overview.js',
    '/formal-presentation.mjs': 'cru55-formal-presentation.mjs',
    '/presentation.mjs': 'cru55-presentation.mjs', '/context-cards.mjs': 'cru55-context-cards.mjs',
    '/terminal.js': 'trader-terminal-shell.js', '/cru55-provisional-logo-v01.jpg': 'cru55-provisional-logo-v01.jpg',
    '/workspace': 'index.html', '/workspace.js': 'cru55-workspace.js', '/workspace.css': 'cru55-workspace.css',
  };
  const handle = async (req, res, url, requireSession) => {
    if(url.pathname==='/api/v1/cvd-overview'){
      if(!requireSession())return true;
      if(req.method!=='GET'){sendJson(res,405,{reason:'READ_ONLY'});return true;}
      if([...url.searchParams.keys()].some(k=>!['view','timeframe'].includes(k))||['view','timeframe'].some(k=>url.searchParams.getAll(k).length>1)){
        sendJson(res,400,{reason:'CRU55_QUERY_INVALID'});return true;
      }
      try{sendJson(res,200,{...dynamic(Object.fromEntries(url.searchParams)),head:process.env.DASHBOARD_RUNTIME_COMMIT||'CANDIDATE'}, {'Cache-Control':'no-store'});}
      catch(error){sendJson(res,error.message==='CRU55_QUERY_INVALID'?400:503,{reason:error.code==='ENOENT'?'CRU55_PROJECTION_NOT_AVAILABLE':/^[A-Z0-9_]+$/.test(error.message)?error.message:'CRU55_PROJECTION_READ_FAILED'},{'Cache-Control':'no-store'});}
      return true;
    }
    if (req.method !== 'GET') return false;
    if (url.pathname === '/api/lower') {
      if (!requireSession()) return true;
      const snapshot = readSnapshot();
      // Only the same named public aggregate fields accepted by the original cards.
      const lower = snapshot?.dataMode === 'live'
        ? Object.fromEntries(['asOfDate', 'generatedAt', 'marketOverview', 'futuresMarket',
          'futuresInstitutional', 'marketBreadth', 'spotInstitutional', 'options']
          .map(key => [key, snapshot[key] ?? null])) : null;
      sendJson(res, 200, lower, { 'Cache-Control': 'no-store' });
      return true;
    }
    if (!Object.hasOwn(files, url.pathname)) return false;
    let body = fs.readFileSync(path.join(publicDir, files[url.pathname]));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      body = Buffer.from(body.toString().replace('<body>', '<body data-formal-entry="true">')
        .replace('src="/preview.js"', 'src="/formal-overview.js"')
        .replace('src="/vendor.js"', 'src="/vendor/lightweight-charts.js"')
        .replace('台股決策雷達｜CRU-55 隔離預覽', '台股決策雷達｜總覽')
        .replace('CRU-55 · ISOLATED PREVIEW', '正式資料入口')
        .replace('預覽來源<select', '行情盤別<select')
        .replace('真實 DAY 片段', 'DAY').replace('真實 NIGHT 片段', 'NIGHT')
        .replace('<option value="demo">SYNTHETIC / UI DEMO</option>', '')
        .replace('隔離預覽存取碼', '登入密碼').replace('開啟預覽', '登入')
        .replace('請使用本次 launcher 產生的本機啟動連結。', '使用既有 Dashboard 密碼；沿用正式 Session。'));
    } else if (url.pathname === '/workspace') {
      body = Buffer.from(body.toString().replace('<body>', '<body data-formal-entry="true">')
        .replace('</head>', '<link rel="stylesheet" href="/workspace.css"><script src="/workspace.js" defer></script></head>'));
    }
    const ext = path.extname(files[url.pathname]);
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.jpg': 'image/jpeg' }[ext];
    res.writeHead(200, { 'Content-Type': mime + (ext === '.jpg' ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  };
  // Startup identity only, not producer freshness or LIVE acceptance. Hashes
  // attest the configured paths without exposing local locations over HTTP.
  return Object.assign(handle,{runtimeBinding:Object.freeze({
    state:binding?'BOUND':process.env.CRU55_DYNAMIC_ROOT?'CANDIDATE_UNBOUND':'UNCONFIGURED',
    bindingHash:binding?.bindingHash??null, runtimeCommit:binding?.runtimeCommit??null,
    fullDayReady:false,
  })});
}
