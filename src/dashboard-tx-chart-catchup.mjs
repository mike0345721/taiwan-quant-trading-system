// Human-readable catch-up progress for the chart (WP 0-2), e.g.
// "補讀中 37%（已到 09:10／目標 10:45）". Display only; it never changes chart data.
const hhmm = value => {
  // Bar times may be ISO text or epoch numbers (seconds or milliseconds).
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(ms));
};

export function chartCatchupProgress(chart) {
  if (!chart) return null;
  const target = hhmm(chart.asOf);
  const lastBar = Array.isArray(chart.bars) && chart.bars.length ? chart.bars.at(-1) : null;
  const readThrough = lastBar ? hhmm(lastBar.time) : null;
  const span = readThrough && target ? `（已到 ${readThrough}／目標 ${target}）` : target ? `（目標 ${target}）` : '';
  if (chart.sourceReadState === 'CATCHUP_PENDING' && Array.isArray(chart.sourceProgress)) {
    const known = chart.sourceProgress.filter(p => Number.isFinite(p?.sourceOffset) && Number.isFinite(p?.observedSize));
    const total = known.reduce((sum, p) => sum + p.observedSize, 0);
    const done = known.reduce((sum, p) => sum + Math.min(p.sourceOffset, p.observedSize), 0);
    // Never claim 100% while still pending.
    const percent = total > 0 ? Math.min(99, Math.floor(done * 100 / total)) : 0;
    return Object.freeze({ state: 'CATCHUP', percent, readThrough, target, text: `補讀中 ${percent}%${span}` });
  }
  const audit = chart.sourceAuditProgress;
  if (audit?.state === 'PENDING') {
    const percent = audit.totalRecords > 0 ? Math.min(99, Math.floor(audit.processedRecords * 100 / audit.totalRecords)) : 0;
    return Object.freeze({ state: 'VERIFYING', percent, readThrough, target, text: `驗證中 ${percent}%${span}` });
  }
  return null;
}
