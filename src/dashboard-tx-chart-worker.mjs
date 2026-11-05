import { parentPort, workerData } from 'node:worker_threads';
import { createTxChartReadBudget, loadTxDecisionChart } from './dashboard-tx-chart-source.mjs';
import { loadMarketObservation } from './market-observation-source.mjs';

// This thread has no listener, broker, env loader or collector. Its only input is
// the app's explicit read roots/calendar and one bounded chart selection.
parentPort.on('message', ({ id, selection }) => {
  try {
    const loader = selection.observation === true ? loadMarketObservation : loadTxDecisionChart;
    let chart = loader({ dataRoot: workerData.dataRoot, cacheRoot: workerData.cacheRoot,
      calendar: workerData.calendar, producerRoot: workerData.producerRoot, ...selection, sourceBudget: createTxChartReadBudget(workerData.sourceLimits) });
    if (selection.capture && chart.actualContract && chart.tradeDate && chart.session && chart.asOf) {
      const marketObservation = loadMarketObservation({ dataRoot: workerData.dataRoot, cacheRoot: workerData.cacheRoot,
        calendar: workerData.calendar, producerRoot: workerData.producerRoot, timeframe: chart.timeframe,
        mode: chart.mode, actualContract: chart.actualContract, tradeDate: chart.tradeDate, session: chart.session, asOf: chart.asOf });
      chart = { ...chart, marketObservation };
    }
    parentPort.postMessage({ id, chart });
  } catch {
    parentPort.postMessage({ id, error: 'CHART_CALCULATION_UNAVAILABLE' });
  }
});
