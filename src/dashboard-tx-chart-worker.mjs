import { parentPort, workerData } from 'node:worker_threads';
import { createTxChartReadBudget, loadTxDecisionChart, releaseTxChartAudit } from './dashboard-tx-chart-source.mjs';
import { loadMarketObservation } from './market-observation-source.mjs';
import { unavailableObservation } from './market-observation-core.mjs';
const observationPending=new Set(['SOURCE_CATCHUP_PENDING','DERIVED_HISTORY_VERIFYING','VERIFIED_SOURCE_PENDING_DERIVATION',
  'VERIFIED_SOURCE_PERSISTED_PENDING_DERIVATION','DERIVATION_CATCHUP_PENDING','LEGACY_CACHE_VALIDATION_PENDING','LEGACY_CACHE_MIGRATION_PENDING']);

// This thread has no listener, broker, env loader or collector. Its only input is
// the app's explicit read roots/calendar and one bounded chart selection.
parentPort.on('message', ({ id, selection }) => {
  try {
    const loader = selection.observation === true ? loadMarketObservation : loadTxDecisionChart;
    let chart = loader({ dataRoot: workerData.dataRoot, cacheRoot: workerData.cacheRoot,
      calendar: workerData.calendar, producerRoot: workerData.producerRoot, ...selection, staged:true, holdCompletedAudit:selection.capture===true, sourceBudget: createTxChartReadBudget(workerData.sourceLimits) });
    if (selection.capture && chart.actualContract && chart.tradeDate && chart.session && chart.asOf) {
      let marketObservation = chart.sourceAuditProgress?.state==='PENDING'
        ? unavailableObservation('SOURCE_CATCHUP_PENDING',{timeframe:chart.timeframe,mode:chart.mode,cutoff:chart.asOf})
        : loadMarketObservation({ dataRoot: workerData.dataRoot, cacheRoot: workerData.cacheRoot,
        calendar: workerData.calendar, producerRoot: workerData.producerRoot, timeframe: chart.timeframe,
        mode: chart.mode, actualContract: chart.actualContract, tradeDate: chart.tradeDate, session: chart.session, asOf: chart.asOf,
        readPublishedPrefix:chart.sourceAuditProgress?.state==='COMPLETE' });
      if(chart.sourceAuditProgress?.state==='COMPLETE'&&marketObservation.snapshotId
        &&!marketObservation.reasonCodes?.includes('SOURCE_CATCHUP_PENDING')
        &&(marketObservation.cutoff!==chart.asOf||['actualContract','tradeDate','session'].some(key=>marketObservation.identity?.[key]!==chart[key])
          ||marketObservation.price?.last!==chart.lastPrice||marketObservation.profile?.tradeCount!==chart.sourceEventCount
          ||marketObservation.profile?.totalVolume!==(chart.bars||[]).reduce((sum,bar)=>sum+bar.volume,0)))
        marketObservation=unavailableObservation('CHART_OBSERVATION_PREFIX_MISMATCH',{timeframe:chart.timeframe,mode:chart.mode,cutoff:chart.asOf});
      chart = { ...chart, marketObservation };
      if(chart.sourceAuditProgress?.state==='COMPLETE'&&!marketObservation.reasonCodes?.some(reason=>observationPending.has(reason)))releaseTxChartAudit();
    }
    parentPort.postMessage({ id, chart });
  } catch {
    parentPort.postMessage({ id, error: 'CHART_CALCULATION_UNAVAILABLE' });
  }
});
