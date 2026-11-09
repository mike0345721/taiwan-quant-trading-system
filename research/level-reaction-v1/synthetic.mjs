// Synthetic TX 5m day sessions for validating the level-reaction study. Not market data.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// plantedEdge: 0 = pure random walk. >0 = after the first touch of the prior-day high (low)
// from below (above), price drifts away from the level by this many points per minute for 14 bars.
export function syntheticSessions({ days = 160, seed = 1, plantedEdge = 0, start = '2026-01-05' } = {}) {
  const rand = rng(seed); const out = []; let price = 23000; let prior = null;
  let d = new Date(`${start}T00:00:00Z`);
  while (out.length < days) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const tradeDate = d.toISOString().slice(0, 10);
      const open0 = Date.parse(`${tradeDate}T00:45:00Z`);
      price += Math.round((rand() - 0.5) * 60);
      const vol = 5 + rand() * 6;
      const bars = []; let drift = 0, driftLeft = 0, usedHigh = false, usedLow = false;
      for (let i = 0; i < 60; i++) {
        const open = price; let high = open, low = open;
        for (let m = 0; m < 5; m++) {
          const step = (rand() - 0.5) * 2 * vol + (driftLeft > 0 ? drift : 0);
          price = Math.round(price + step);
          high = Math.max(high, price); low = Math.min(low, price);
          if (plantedEdge > 0 && prior) {
            if (!usedHigh && open < prior.high && high >= prior.high) { usedHigh = true; drift = -plantedEdge; driftLeft = 14 * 5; }
            if (!usedLow && open > prior.low && low <= prior.low) { usedLow = true; drift = plantedEdge; driftLeft = 14 * 5; }
          }
          if (driftLeft > 0) driftLeft--;
        }
        bars.push({ timestamp: new Date(open0 + i * 300000).toISOString(), open, high, low, close: price });
      }
      out.push({ contract: '202612', tradeDate, session: 'DAY', bars });
      prior = { high: Math.max(...bars.map(b => b.high)), low: Math.min(...bars.map(b => b.low)) };
    }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
