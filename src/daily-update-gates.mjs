export function buildDailyUpdateGateSummary({ stages = [], failures = [], marketDaily = { status: 'UNKNOWN', tradeDate: null } } = {}) {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const stateOf = (key) => {
    const stage = byKey.get(key);
    if (!stage) return 'NOT_RUN';
    return stage.ok === true ? 'PASS' : 'FAIL';
  };
  const taifex = stateOf('taifex');
  const quality = stateOf('quality');
  const continuityStage = byKey.get('data_continuity_audit');
  const continuity = !continuityStage
    ? 'NOT_RUN'
    : continuityStage.ok === true
      ? 'PASS'
      : /ETIMEDOUT|timeout/i.test(continuityStage.error ?? '') ? 'TIMEOUT' : 'FAIL';
  const requiredSource = taifex === 'PASS' && marketDaily.status === 'VALID'
    ? 'PASS'
    : taifex === 'FAIL' || marketDaily.status === 'MISSING' ? 'BLOCKED' : 'UNKNOWN';
  const reasons = [];
  if (taifex === 'FAIL') reasons.push('TAIFEX_REQUIRED_SOURCE_FAIL');
  if (marketDaily.status === 'MISSING') reasons.push('MARKET_DAILY_MISSING');
  if (quality === 'FAIL') reasons.push('QUALITY_DEBT');
  if (continuity === 'TIMEOUT') reasons.push('DATA_CONTINUITY_AUDIT_TIMEOUT');
  else if (continuity === 'FAIL') reasons.push('DATA_CONTINUITY_AUDIT_FAIL');
  const hasCriticalFailure = failures.some((failure) => failure.critical === true);
  const overall = requiredSource === 'BLOCKED' || hasCriticalFailure ? 'FAILED' : reasons.length ? 'DEGRADED' : 'PASS';
  return {
    requiredSource,
    taifex,
    marketDaily,
    quality,
    continuityAudit: continuity,
    overall,
    reasons,
  };
}
