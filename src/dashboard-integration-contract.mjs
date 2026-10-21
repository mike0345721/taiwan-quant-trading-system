export const CRU46_INTEGRATION_BASE_MAIN = 'a6984a44c21ec3d012ca5d30acb86ae71215f64f';
export const CRU46_INCLUDED_SOURCES = Object.freeze({
  cru43: 'e2427bef6b7659da684e9c82f7fa11680e4688f0',
  cru45: '9f244e1171b2ecfab5c982343a42682858a489c2',
});

export const CRU44_APPROVED_BASE_MAIN = '9770b072758532ecd3feabfb25d1213f431560e2';
export const CRU44_INCLUDED_SOURCES = Object.freeze({
  cru34: 'frozen-semantics-v1',
  cru36: 'governed-local-ledger-v1',
  cru43: 'e2427bef6b7659da684e9c82f7fa11680e4688f0',
});

export const CRU46_PRODUCT_SURFACE_CONTRACT = Object.freeze({
  schemaVersion: 'cru46-dashboard-product-surface-v1',
  chart: Object.freeze({
    requiredVisible: Object.freeze(['candlestick', 'volume', 'currentPrice', 'vwap', 'sessionHigh', 'sessionLow']),
    timeframes: Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1D']),
  }),
  observedFlow: Object.freeze({
    windows: Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', 'tradingDay']),
    governed: Object.freeze(['1m', '5m']),
    pending: Object.freeze(['15m', '30m', '1h', '4h', 'tradingDay']),
    synchronizedWithChart: true,
    formalDirectionGate: 'classifiedCoverage === 1',
  }),
  failClosed: Object.freeze({
    missingIsZero: false,
    staleIsLive: false,
    marketPulse: true,
    volume: true,
    basis: true,
    rvol: 'RESEARCH_PENDING',
  }),
  safety: Object.freeze({
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  }),
});

export const CRU44_PRODUCT_SURFACE_CONTRACT = Object.freeze({
  ...CRU46_PRODUCT_SURFACE_CONTRACT,
  schemaVersion: 'cru44-1h-4h-product-surface-v1',
  observedFlow: Object.freeze({
    ...CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow,
    governed: Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h']),
    pending: Object.freeze(['tradingDay']),
  }),
});

export function buildIntegrationPreviewVersion({ runtimeVersion, enabled = false, branch = null, dataMode = null } = {}) {
  if (!enabled) return Object.freeze({ ...runtimeVersion });
  return Object.freeze({
    ...runtimeVersion,
    productVersion: 'CRU-46 Dashboard Integration Mainline V1',
    approvedMainCommit: CRU46_INTEGRATION_BASE_MAIN,
    syncState: runtimeVersion?.runtimeCommit === CRU46_INTEGRATION_BASE_MAIN ? 'SYNCED' : 'MISMATCH',
    previewType: 'INTEGRATION_OWNER_PREVIEW',
    previewLabel: 'INTEGRATION OWNER PREVIEW',
    branch: branch || 'UNKNOWN',
    exactHead: runtimeVersion?.runtimeCommit || null,
    buildCommit: runtimeVersion?.runtimeCommit || null,
    runtimeCommit: runtimeVersion?.runtimeCommit || null,
    baseMainCommit: CRU46_INTEGRATION_BASE_MAIN,
    includedSources: CRU46_INCLUDED_SOURCES,
    pendingCapabilities: Object.freeze(['CRU-44', 'CVD', 'RVOL', '15m+ observed-flow backend']),
    dataMode: dataMode || 'UNKNOWN',
    complete: false,
    safety: CRU46_PRODUCT_SURFACE_CONTRACT.safety,
  });
}

export function validateIntegrationPreviewVersionTruth(version, expectedHead) {
  const sha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
  const reasons = [];
  if (version?.previewType !== 'INTEGRATION_OWNER_PREVIEW') reasons.push('PREVIEW_TYPE_MISMATCH');
  if (!sha(expectedHead)) reasons.push('EXPECTED_HEAD_UNVERIFIED');
  for (const field of ['exactHead', 'buildCommit', 'runtimeCommit']) {
    if (!sha(version?.[field])) reasons.push(`${field.toUpperCase()}_UNVERIFIED`);
    else if (version[field] !== expectedHead) reasons.push(`${field.toUpperCase()}_MISMATCH`);
  }
  if (version?.baseMainCommit !== CRU46_INTEGRATION_BASE_MAIN) reasons.push('BASE_MAIN_MISMATCH');
  if (version?.includedSources?.cru43 !== CRU46_INCLUDED_SOURCES.cru43) reasons.push('CRU43_SOURCE_MISMATCH');
  if (version?.includedSources?.cru45 !== CRU46_INCLUDED_SOURCES.cru45) reasons.push('CRU45_SOURCE_MISMATCH');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function buildCru44PreviewVersion({ runtimeVersion, enabled = false, branch = null, dataMode = null } = {}) {
  if (!enabled) return Object.freeze({ ...runtimeVersion });
  return Object.freeze({
    ...runtimeVersion,
    productVersion: 'CRU-44 1h + 4h Observed Flow V1',
    approvedMainCommit: CRU44_APPROVED_BASE_MAIN,
    syncState: runtimeVersion?.runtimeCommit === CRU44_APPROVED_BASE_MAIN ? 'SYNCED' : 'MISMATCH',
    previewType: 'CRU44_OWNER_PREVIEW',
    previewLabel: 'CRU-44 1H + 4H OWNER PREVIEW',
    branch: branch || 'UNKNOWN',
    exactHead: runtimeVersion?.runtimeCommit || null,
    buildCommit: runtimeVersion?.runtimeCommit || null,
    runtimeCommit: runtimeVersion?.runtimeCommit || null,
    baseMainCommit: CRU44_APPROVED_BASE_MAIN,
    includedSources: CRU44_INCLUDED_SOURCES,
    pendingCapabilities: Object.freeze(['TradingDay', 'CVD', 'Relative Intensity',
      'Absorption', 'Market Control', 'Market State']),
    dataMode: dataMode || 'UNKNOWN',
    complete: false,
    safety: CRU44_PRODUCT_SURFACE_CONTRACT.safety,
  });
}

export function validateCru44PreviewVersionTruth(version, expectedHead) {
  const sha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
  const reasons = [];
  if (version?.previewType !== 'CRU44_OWNER_PREVIEW') reasons.push('PREVIEW_TYPE_MISMATCH');
  if (!sha(expectedHead)) reasons.push('EXPECTED_HEAD_UNVERIFIED');
  for (const field of ['exactHead', 'buildCommit', 'runtimeCommit']) {
    if (!sha(version?.[field])) reasons.push(`${field.toUpperCase()}_UNVERIFIED`);
    else if (version[field] !== expectedHead) reasons.push(`${field.toUpperCase()}_MISMATCH`);
  }
  if (version?.baseMainCommit !== CRU44_APPROVED_BASE_MAIN) reasons.push('BASE_MAIN_MISMATCH');
  if (version?.includedSources?.cru34 !== CRU44_INCLUDED_SOURCES.cru34) reasons.push('CRU34_SOURCE_MISMATCH');
  if (version?.includedSources?.cru36 !== CRU44_INCLUDED_SOURCES.cru36) reasons.push('CRU36_SOURCE_MISMATCH');
  if (version?.includedSources?.cru43 !== CRU44_INCLUDED_SOURCES.cru43) reasons.push('CRU43_SOURCE_MISMATCH');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

// Versioned description for the accepted CRU-21 candidate only. Historic contracts
// remain immutable; this is neither source-quality approval nor rollout permission.
export const CRU21_EVIDENCE_HOME_PRODUCT_SURFACE = Object.freeze({
  ...CRU44_PRODUCT_SURFACE_CONTRACT,
  schemaVersion: 'cru21-evidence-home-product-surface-v1',
  observedFlow: Object.freeze({
    ...CRU44_PRODUCT_SURFACE_CONTRACT.observedFlow,
    synchronizedWithChart: false,
    comparisonScope: 'ROLLING_TIME_WINDOW',
  }),
  failClosed: Object.freeze({
    ...CRU44_PRODUCT_SURFACE_CONTRACT.failClosed,
    rvol: 'COMPLETED_5M_SOURCE_AND_BASELINE_GATED',
  }),
  dataQualificationDeclared: false,
  deliveryAccepted: false,
});

export function selectDashboardProductSurface({ previewType, actualBranch } = {}) {
  if (previewType === 'CRU21_OWNER_PREVIEW'
      && actualBranch === 'codex/cru21-decision-quality-p0-20261016') {
    return CRU21_EVIDENCE_HOME_PRODUCT_SURFACE;
  }
  return previewType === 'CRU44_OWNER_PREVIEW'
    ? CRU44_PRODUCT_SURFACE_CONTRACT : CRU46_PRODUCT_SURFACE_CONTRACT;
}
