// Observation presence for the fixed AI-off candidate, never readiness or promotion.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
const identity = value => /^TX[A-Z0-9]{2,12}$/.test(value?.actualContract || '')
  && date(value?.tradeDate) && ['DAY','NIGHT'].includes(value?.session);
const timeKnown = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && Date.parse(value) <= now + 5_000;

function chartPresent(chart, now) {
  return chart?.schemaVersion === 'governed-tx-decision-chart-v2' && chart.mode === 'LIVE'
    && identity(chart) && ['READY','FORMING','QUALITY_INSUFFICIENT'].includes(chart.status)
    && ['PASS','QUALITY_INSUFFICIENT'].includes(chart.qualityStatus) && timeKnown(chart.availableAt, now)
    && Array.isArray(chart.bars) && chart.bars.length > 0 && chart.bars.every(bar => timeKnown(bar?.time, now)
      && [bar.open,bar.high,bar.low,bar.close,bar.volume].every(finite) && bar.volume >= 0
      && bar.low > 0
      && bar.high >= Math.max(bar.open,bar.close) && bar.low <= Math.min(bar.open,bar.close)
      && (!bar.actualContract || bar.actualContract === chart.actualContract));
}
function flowPresent(flow, now) {
  if (flow?.schemaVersion !== 'dashboard-observed-flow-v1' || !identity(flow.identity)
      || !['LIVE','WARMING_UP','STALE'].includes(flow.sourceState) || flow.source?.sourceMode !== 'LIVE'
      || !timeKnown(flow.source.availableAt, now) || !Number.isFinite(Date.parse(flow.source.validUntil))
      || Date.parse(flow.source.validUntil) < Date.parse(flow.source.availableAt)) return false;
  return ['primary60s','context300s','window900s','window1800s','window3600s','window14400s'].some(key => {
    const window = flow.windows?.[key], pressure = window?.pressure, response = window?.response;
    if (!window || !['READY','QUALITY_INSUFFICIENT'].includes(window.status)) return false;
    const pressureObserved = ['READY','QUALITY_INSUFFICIENT'].includes(pressure?.status)
      && finite(pressure.totalExecutedVolume) && pressure.totalExecutedVolume > 0
      && finite(pressure.classifiedCoverage) && pressure.classifiedCoverage >= 0 && pressure.classifiedCoverage <= 1
      && (pressure.pressureRatio === null || finite(pressure.pressureRatio) && Math.abs(pressure.pressureRatio) <= 1);
    const responseObserved = response?.status === 'READY'
      && [response.startPrice,response.endPrice,response.displacementPoints].every(finite);
    return pressureObserved || responseObserved;
  });
}

export function assessCandidateMarketInputs({chart = null, flow = null, now = new Date()} = {}) {
  const stamp = now instanceof Date ? now.getTime() : NaN;
  const chartAvailable = Number.isFinite(stamp) && chartPresent(chart, stamp);
  const flowAvailable = Number.isFinite(stamp) && flowPresent(flow, stamp);
  return Object.freeze({
    status: chartAvailable || flowAvailable ? 'PARTIAL' : 'UNAVAILABLE',
    reason: 'EOD_SNAPSHOT_UNAVAILABLE', eodSnapshot: 'UNAVAILABLE',
    marketInputs: Object.freeze({
      chart: Object.freeze({observationAvailable:chartAvailable,status:chart?.status || 'UNAVAILABLE',
        qualityStatus:chart?.qualityStatus || 'UNAVAILABLE',availableAt:chart?.availableAt || null}),
      flow: Object.freeze({observationAvailable:flowAvailable,sourceState:flow?.sourceState || 'UNAVAILABLE',
        availableAt:flow?.source?.availableAt || null,validUntil:flow?.source?.validUntil || null}),
    }),
    deliveryAccepted:false, dataQualificationDeclared:false, executionAuthorized:false, orderRoutesEnabled:false,
  });
}
