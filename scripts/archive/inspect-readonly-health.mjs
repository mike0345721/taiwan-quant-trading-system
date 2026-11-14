// One bounded snapshot. No services, credentials, schedules or files are changed.
import { fileURLToPath } from 'node:url';
import { loadOperatingCalendar } from '../src/operating-calendar.mjs';
import { assessTaifexMarketSession } from '../src/taifex-market-operation.mjs';
import { readLocalHealth, summarizeReadonlyHealth } from '../src/readonly-health-monitor.mjs';
const args = process.argv.slice(2);
let port = 8787, expectedHead = null, candidate = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--candidate') candidate = true;
  else if (args[i] === '--port' && ['8787','18722'].includes(args[i+1])) port = Number(args[++i]);
  else if (args[i] === '--expected-head' && /^[a-f0-9]{40}$/.test(args[i+1] || '')) expectedHead = args[++i];
  else throw Error('USAGE: --candidate --port 8787|18722 --expected-head <40-character commit>');
}
let calendar = null;
try { calendar = loadOperatingCalendar(fileURLToPath(new URL('../config/taifex-official-calendar-2026.json', import.meta.url)), { allowCandidate: candidate }); } catch {}
const [bridge, dashboard] = await Promise.all([
  readLocalHealth('http://127.0.0.1:8790/health'), readLocalHealth(`http://127.0.0.1:${port}/healthz`),
]);
const result = summarizeReadonlyHealth({ market: assessTaifexMarketSession(new Date(), calendar), bridge, dashboard, expectedHead });
console.log(JSON.stringify(result, null, 2));
if (result.problems.length) process.exitCode = 2;
