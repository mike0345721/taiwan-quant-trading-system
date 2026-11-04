import { parentPort, workerData } from 'node:worker_threads';
import { createTxChartReadBudget, loadTxDecisionChart } from './dashboard-tx-chart-source.mjs';

// This thread has no listener, broker, env loader or collector. Its only input is
// the app's explicit read roots/calendar and one bounded chart selection.
parentPort.on('message', ({ id, selection }) => {
  try {
    const chart = loadTxDecisionChart({ dataRoot: workerData.dataRoot, cacheRoot: workerData.cacheRoot,
      calendar: workerData.calendar, ...selection, sourceBudget: createTxChartReadBudget(workerData.sourceLimits) });
    parentPort.postMessage({ id, chart });
  } catch {
    parentPort.postMessage({ id, error: 'CHART_CALCULATION_UNAVAILABLE' });
  }
});
