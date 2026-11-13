// Background catch-up for the Dashboard chart (WP 0-2).
// Keeps advancing the same bounded chart request without any open page:
// immediately again while the chart is still catching up, every intervalMs once current.
// It only calls the existing chart service; every request keeps its own time and byte limits.
export function createTxChartPump({ load, isPending, intervalMs = 5000, catchupDelayMs = 100, busyDelayMs = 500,
  onResult = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof load !== 'function' || typeof isPending !== 'function') throw Error('CHART_PUMP_CONFIG_INVALID');
  let timer = null, stopped = true, ticks = 0;

  function schedule(delay) {
    timer = setTimer(tick, delay);
    timer?.unref?.();
  }
  async function tick() {
    timer = null;
    if (stopped) return;
    let chart = null;
    try { chart = await load(); } catch { chart = null; }
    if (stopped) return;
    ticks += 1;
    try { onResult?.(chart); } catch { /* observers never stop the pump */ }
    const busy = ['CHART_REQUEST_BUSY', 'CHART_WORKER_RESTARTING'].includes(chart?.reason);
    schedule(busy ? busyDelayMs : chart && isPending(chart) ? catchupDelayMs : intervalMs);
  }
  return Object.freeze({
    start() { if (!stopped) return; stopped = false; schedule(0); },
    stop() { stopped = true; if (timer) clearTimer(timer); timer = null; },
    get ticks() { return ticks; },
  });
}
