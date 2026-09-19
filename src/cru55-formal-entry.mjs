import fs from 'node:fs';
import path from 'node:path';
import { sendJson } from './http-utils.mjs';

// A separate production mount. The frozen isolated adapter and its guards stay intact.
export function prepareFormalEntry({ publicDir }, readSnapshot) {
  const files = {
    '/': 'cru55-preview.html', '/index.html': 'cru55-preview.html',
    '/preview.css': 'cru55-preview.css', '/preview.js': 'cru55-preview.js',
    '/formal-overview.js': 'cru55-formal-overview.js',
    '/formal-presentation.mjs': 'cru55-formal-presentation.mjs',
    '/presentation.mjs': 'cru55-presentation.mjs', '/context-cards.mjs': 'cru55-context-cards.mjs',
    '/terminal.js': 'trader-terminal-shell.js', '/cru55-provisional-logo-v01.jpg': 'cru55-provisional-logo-v01.jpg',
    '/workspace': 'index.html', '/workspace.js': 'cru55-workspace.js', '/workspace.css': 'cru55-workspace.css',
  };
  return async (req, res, url, requireSession) => {
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
}
