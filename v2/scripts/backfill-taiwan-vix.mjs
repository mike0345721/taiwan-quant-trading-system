import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { decodeTaifexVix, importTaiwanVix, taifexVixMonthUrls } from '../src/taiwan-vix.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const pageUrl = 'https://www.taifex.com.tw/cht/7/vixDaily3MNew';
const headers = { 'user-agent': 'tw-chip-dashboard-research/2.9' };

try {
  applyMigrations(db, config.migrationsPath);
  const pageResponse = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(30_000) });
  if (!pageResponse.ok) throw new Error(`TAIFEX VIX page failed: HTTP ${pageResponse.status}`);
  const urls = taifexVixMonthUrls(await pageResponse.text());
  if (!urls.length) throw new Error('No TAIFEX VIX monthly links discovered');
  const results = [];
  for (const url of urls) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`TAIFEX VIX download failed: HTTP ${response.status}`);
    const text = decodeTaifexVix(await response.arrayBuffer());
    const imported = withTransaction(db, () => importTaiwanVix(db, text));
    results.push({ url, ...imported });
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), pageUrl, timing: 'TAIFEX closing one-minute average at 13:45 Asia/Taipei', results }, null, 2));
} finally {
  db.close();
}
