import { auditInstitutionalFuturesOiConsistency } from './domestic-institution-backfill.mjs';

function addIssue(db, issue) {
  db.prepare(`INSERT OR IGNORE INTO quality_issues(trade_date, severity, rule_code, source_key, message, detected_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(issue.tradeDate || null, issue.severity, issue.ruleCode, issue.sourceKey || null, issue.message, new Date().toISOString());
}

export function runQualityChecks(db) {
  db.exec('DELETE FROM quality_issues;');
  const dates = db.prepare('SELECT trade_date FROM raw_snapshots ORDER BY trade_date').all();
  const researchStart = db.prepare('SELECT MIN(trade_date) AS date FROM spot_institutional_daily WHERE foreign_net_e IS NOT NULL').get()?.date || dates[0]?.trade_date;
  for (const row of db.prepare(`SELECT r.trade_date, m.twii_close, m.tx_close, s.foreign_net_e, f.foreign_net,
      (SELECT COUNT(*) FROM options_contract_daily o WHERE o.trade_date=r.trade_date) AS option_contracts
    FROM raw_snapshots r LEFT JOIN market_daily m USING(trade_date) LEFT JOIN spot_institutional_daily s USING(trade_date)
    LEFT JOIN futures_positions_daily f USING(trade_date) WHERE r.trade_date>=? ORDER BY r.trade_date`).all(researchStart)) {
    for (const [field, value] of [['twii_close', row.twii_close], ['tx_close', row.tx_close], ['foreign_net_e', row.foreign_net_e], ['foreign_net', row.foreign_net]]) {
      if (value == null) addIssue(db, { tradeDate: row.trade_date, severity: 'warning', ruleCode: 'MISSING_CORE_FIELD', sourceKey: field, message: `${field} is missing` });
    }
    if (row.option_contracts === 0) addIssue(db, { tradeDate: row.trade_date, severity: 'warning', ruleCode: 'NO_OPTION_CONTRACT', sourceKey: 'options', message: 'No option contract rows were imported' });
  }
  for (const row of db.prepare(`SELECT trade_date, contract, oi_pc_ratio FROM options_contract_daily WHERE oi_pc_ratio < 0 OR oi_pc_ratio > 20`).all()) {
    addIssue(db, { tradeDate: row.trade_date, severity: 'info', ruleCode: 'OPTION_PC_OUTLIER', sourceKey: row.contract, message: `OI P/C ratio ${row.oi_pc_ratio} is outside 0-20; inspect the small denominator before treating it as an error` });
  }
  for (const row of db.prepare(`SELECT trade_date, source_key, error FROM data_sources WHERE ok=0`).all()) {
    addIssue(db, { tradeDate: row.trade_date, severity: 'error', ruleCode: 'SOURCE_FAILED', sourceKey: row.source_key, message: row.error || 'Source failed' });
  }
  const institutionalFuturesOiConsistency = auditInstitutionalFuturesOiConsistency(db);
  for (const row of institutionalFuturesOiConsistency.mismatchDates) {
    if (row.cross_table_mismatch) {
      addIssue(db, {
        tradeDate: row.trade_date,
        severity: 'error',
        ruleCode: 'INSTITUTIONAL_OI_NET_MISMATCH',
        sourceKey: row.institution_type,
        message: `detail open_interest_net ${row.detail_net} does not match futures_positions_daily final net ${row.final_net}`,
      });
    }
    if (row.internal_mismatch) {
      addIssue(db, {
        tradeDate: row.trade_date,
        severity: 'error',
        ruleCode: 'INSTITUTIONAL_OI_ARITHMETIC_MISMATCH',
        sourceKey: row.institution_type,
        message: `detail long ${row.open_interest_long} minus short ${row.open_interest_short} does not equal detail net ${row.detail_net}`,
      });
    }
  }
  for (let index = 1; index < dates.length; index += 1) {
    const previous = new Date(`${dates[index - 1].trade_date}T00:00:00Z`);
    const current = new Date(`${dates[index].trade_date}T00:00:00Z`);
    const days = Math.round((current - previous) / 86_400_000);
    if (days > 7) addIssue(db, { tradeDate: dates[index].trade_date, severity: 'info', ruleCode: 'LONG_DATE_GAP', sourceKey: 'calendar', message: `${days}-day gap after ${dates[index - 1].trade_date}; verify against the official holiday calendar` });
  }
  const counts = Object.fromEntries(db.prepare('SELECT severity, COUNT(*) AS count FROM quality_issues GROUP BY severity').all().map((row) => [row.severity, row.count]));
  const byRule = db.prepare('SELECT rule_code, severity, COUNT(*) AS count FROM quality_issues GROUP BY rule_code, severity ORDER BY count DESC').all();
  const sampleIssues = db.prepare('SELECT trade_date, severity, rule_code, source_key, message FROM quality_issues ORDER BY trade_date DESC, severity DESC LIMIT 20').all();
  const summary = db.prepare(`SELECT COUNT(*) AS snapshots, MIN(trade_date) AS first_date, MAX(trade_date) AS last_date FROM raw_snapshots`).get();
  const optionSummary = db.prepare(`SELECT COUNT(*) AS contracts, (SELECT COUNT(*) FROM options_strike_daily) AS strikes FROM options_contract_daily`).get();
  const coverage = db.prepare(`SELECT
      (SELECT COUNT(*) FROM market_daily WHERE twii_close IS NOT NULL) AS twii_days,
      (SELECT COUNT(*) FROM market_daily WHERE tx_close IS NOT NULL) AS tx_days,
      (SELECT COUNT(*) FROM spot_institutional_daily WHERE foreign_net_e IS NOT NULL) AS spot_days,
      (SELECT COUNT(*) FROM futures_positions_daily WHERE foreign_net IS NOT NULL) AS futures_position_days,
      (SELECT COUNT(DISTINCT trade_date) FROM options_contract_daily) AS option_days,
      (SELECT COUNT(*) FROM option_oi_changes WHERE put_oi_delta_1d IS NOT NULL OR call_oi_delta_1d IS NOT NULL) AS option_oi_delta_1d_rows,
      (SELECT COUNT(*) FROM option_oi_changes WHERE put_oi_delta_3d IS NOT NULL OR call_oi_delta_3d IS NOT NULL) AS option_oi_delta_3d_rows,
      (SELECT COUNT(*) FROM option_oi_changes WHERE put_oi_delta_5d IS NOT NULL OR call_oi_delta_5d IS NOT NULL) AS option_oi_delta_5d_rows,
      (SELECT COUNT(*) FROM signals_daily WHERE total_score IS NOT NULL) AS signal_days,
      (SELECT COUNT(*) FROM daily_features WHERE next_tx_return_pct IS NOT NULL) AS labeled_days`).get();
  return { ...summary, ...optionSummary, coverage, institutionalFuturesOiConsistency,
    issues: { error: counts.error || 0, warning: counts.warning || 0, info: counts.info || 0 }, byRule, sampleIssues };
}
