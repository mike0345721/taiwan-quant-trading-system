import fs from 'node:fs';
const dir = '/mnt/user-data/uploads/d/Taiwan stock/standalone-v1/data/intraday/archive/';
export function loadSessions() {
  const files = fs.readdirSync(dir).filter(f => /-(day|night)\.json$/.test(f)).sort();
  const sessions = [], issues = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    if (d.tradeDate >= '2026-09-01') throw new Error('HOLDOUT_FILE_PRESENT ' + f);
    const bars = d.bars;
    const expected = d.session === 'day' ? 60 : 168;
    const incomplete = bars.filter(b => b.complete === false).length;
    let gaps = 0, bad = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (!(b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close))) bad++;
      if (i && Date.parse(b.timestamp) - Date.parse(bars[i - 1].timestamp) !== 300000) gaps++;
    }
    if (bars.length !== expected || incomplete || gaps || bad) issues.push({ f, n: bars.length, expected, incomplete, gaps, bad });
    sessions.push({ contract: d.contract, tradeDate: d.tradeDate, session: d.session.toUpperCase(), bars: bars.map(b => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close })) });
  }
  return { sessions, issues, files: files.length };
}
