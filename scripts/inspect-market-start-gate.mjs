// Offline, read-only. Exit 0 only during a verified operating session.
import { fileURLToPath } from 'node:url';
import { loadOperatingCalendar } from '../src/operating-calendar.mjs';
import { assessTaifexMarketSession } from '../src/taifex-market-operation.mjs';
let result;
try {
  const calendar = loadOperatingCalendar(fileURLToPath(new URL('../config/taifex-official-calendar-2026.json', import.meta.url)), {
    allowCandidate: process.env.TAIFEX_ALLOW_CANDIDATE_CLOSURE === 'true',
  });
  result = assessTaifexMarketSession(new Date(), calendar);
} catch { result = { state: 'UNAVAILABLE', marketShouldBeActive: false, reasonCode: 'CALENDAR_UNVERIFIED' }; }
console.log(JSON.stringify({ ...result, executionAuthorized: false, orderRoutesEnabled: false }));
if (!result.marketShouldBeActive) process.exitCode = 2;
