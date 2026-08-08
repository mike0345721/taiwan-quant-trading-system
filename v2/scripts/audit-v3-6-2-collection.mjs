import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase, withTransaction } from '../src/db.mjs';
import { auditInstitutionalFuturesOiConsistency } from '../src/domestic-institution-backfill.mjs';

const SOURCE_URL = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';
const config = v2Config(); const db = openDatabase(config.databasePath);
const availableAt = (date) => `${date}T16:30:00+08:00`;

try {
  applyMigrations(db, config.migrationsPath);
  const now = new Date().toISOString();
  const register = db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
    (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,
     product_scope,expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,
     quality_status,rollover_flag,error)
    VALUES (?,?,?,?,?,'final_after_16_15','regular','TX','','','contracts',?,NULL,?,?,0,?)`);
  withTransaction(db, () => {
    for (const participant of ['investment_trust', 'dealer']) {
      const rows = db.prepare(`SELECT m.trade_date,d.trade_long,d.trade_short,d.open_interest_long,d.open_interest_short,d.fetched_at
        FROM market_daily m LEFT JOIN institutional_futures_detail_daily d
          ON d.trade_date=m.trade_date AND d.institution_type=?
        WHERE m.trade_date >= '2023-07-14' AND m.tx_close IS NOT NULL ORDER BY m.trade_date`).all(participant);
      for (const row of rows) {
        const complete = row.trade_long != null && row.trade_short != null && row.open_interest_long != null && row.open_interest_short != null;
        register.run(`taifex_futures_institutional_${participant}`, row.trade_date,
          complete ? 'success' : 'no_data', availableAt(row.trade_date), row.fetched_at || now,
          SOURCE_URL, complete ? 1 : 0, complete ? 'official_final_complete' : 'official_detail_unavailable',
          complete ? null : 'Official monthly file did not provide complete long/short detail for this date.');
      }
    }
  });

  const coverage = db.prepare(`SELECT institution_type,COUNT(*) rows,
    SUM(trade_long IS NOT NULL AND trade_short IS NOT NULL) complete_trade_days,
    SUM(open_interest_long IS NOT NULL AND open_interest_short IS NOT NULL) complete_oi_days,
    MIN(trade_date) first_date,MAX(trade_date) last_date
    FROM institutional_futures_detail_daily GROUP BY institution_type ORDER BY institution_type`).all();
  const missingDates = db.prepare(`SELECT institution_type,trade_date,
    CASE WHEN trade_long IS NULL OR trade_short IS NULL THEN 1 ELSE 0 END missing_trade,
    CASE WHEN open_interest_long IS NULL OR open_interest_short IS NULL THEN 1 ELSE 0 END missing_oi
    FROM institutional_futures_detail_daily
    WHERE trade_long IS NULL OR trade_short IS NULL OR open_interest_long IS NULL OR open_interest_short IS NULL
    ORDER BY trade_date,institution_type`).all();
  const institutionalFuturesOiConsistency = auditInstitutionalFuturesOiConsistency(db);
  const spotGross = db.prepare(`SELECT COUNT(*) total,
    SUM(foreign_buy_e IS NOT NULL AND foreign_sell_e IS NOT NULL AND trust_buy_e IS NOT NULL
      AND trust_sell_e IS NOT NULL AND dealer_proprietary_buy_e IS NOT NULL
      AND dealer_proprietary_sell_e IS NOT NULL AND dealer_hedge_buy_e IS NOT NULL
      AND dealer_hedge_sell_e IS NOT NULL) complete FROM spot_institutional_daily`).get();
  const spotGrossConsistency = db.prepare(`SELECT
    SUM(ABS((foreign_buy_e-foreign_sell_e)-foreign_net_e)>0.000001) foreign_mismatch_days,
    SUM(ABS((trust_buy_e-trust_sell_e)-trust_net_e)>0.000001) trust_mismatch_days,
    SUM(ABS((dealer_proprietary_buy_e-dealer_proprietary_sell_e)-dealer_proprietary_net_e)>0.000001) dealer_proprietary_mismatch_days,
    SUM(ABS((dealer_hedge_buy_e-dealer_hedge_sell_e)-dealer_hedge_net_e)>0.000001) dealer_hedge_mismatch_days,
    MAX(ABS((foreign_buy_e-foreign_sell_e)-foreign_net_e)) max_foreign_difference_e,
    MAX(ABS((trust_buy_e-trust_sell_e)-trust_net_e)) max_trust_difference_e
    FROM spot_institutional_daily WHERE foreign_buy_e IS NOT NULL`).get();
  const spotGrossMismatchDates = db.prepare(`SELECT trade_date,foreign_buy_e,foreign_sell_e,foreign_net_e,
    foreign_buy_e-foreign_sell_e AS recomputed_foreign_net_e,
    (foreign_buy_e-foreign_sell_e)-foreign_net_e AS difference_e
    FROM spot_institutional_daily
    WHERE foreign_buy_e IS NOT NULL AND ABS((foreign_buy_e-foreign_sell_e)-foreign_net_e)>0.000001
    ORDER BY trade_date`).all();
  const oi = db.prepare(`SELECT COUNT(*) rows,SUM(near_scope_market_oi IS NOT NULL) near_scope_days,
    SUM(all_contracts_market_oi IS NOT NULL) all_contract_days,MIN(trade_date) first_date,MAX(trade_date) last_date
    FROM futures_oi_daily`).get();
  const optionInstitutions = db.prepare(`SELECT COUNT(DISTINCT trade_date) days,COUNT(*) rows,
    MIN(trade_date) first_date,MAX(trade_date) last_date,
    COUNT(DISTINCT CASE WHEN participant='dealer' THEN trade_date END) dealer_days,
    COUNT(DISTINCT CASE WHEN participant='investment_trust' THEN trade_date END) investment_trust_days,
    COUNT(DISTINCT CASE WHEN participant='foreign' THEN trade_date END) foreign_days
    FROM option_institutional_daily`).get();
  const optionInstitutionIncomplete = db.prepare(`SELECT trade_date,COUNT(DISTINCT participant) participant_count
    FROM option_institutional_daily GROUP BY trade_date HAVING participant_count<>3 ORDER BY trade_date`).all();
  const optionLargeTraders = db.prepare(`SELECT COUNT(DISTINCT trade_date) days,COUNT(*) rows,
    MIN(trade_date) first_date,MAX(trade_date) last_date
    FROM option_large_trader_daily`).get();
  const optionLargeTraderIncomplete = db.prepare(`SELECT trade_date,COUNT(*) scope_rows
    FROM option_large_trader_daily GROUP BY trade_date HAVING scope_rows<>12 ORDER BY trade_date`).all();
  const coreGate = db.prepare(`WITH calendar AS (
      SELECT trade_date FROM market_daily WHERE trade_date BETWEEN '2023-07-03' AND '2026-07-14' AND tx_close IS NOT NULL
    ), common AS (
      SELECT c.trade_date FROM calendar c
      JOIN spot_institutional_daily s ON s.trade_date=c.trade_date AND s.foreign_buy_e IS NOT NULL
      JOIN futures_oi_daily oi ON oi.trade_date=c.trade_date AND oi.near_scope_market_oi IS NOT NULL AND oi.all_contracts_market_oi IS NOT NULL
      JOIN institutional_futures_detail_daily it ON it.trade_date=c.trade_date AND it.institution_type='investment_trust' AND it.trade_long IS NOT NULL AND it.trade_short IS NOT NULL
      JOIN institutional_futures_detail_daily d ON d.trade_date=c.trade_date AND d.institution_type='dealer' AND d.trade_long IS NOT NULL AND d.trade_short IS NOT NULL
      JOIN option_institutional_daily op ON op.trade_date=c.trade_date AND op.participant='foreign'
      JOIN option_large_trader_daily ol ON ol.trade_date=c.trade_date
      GROUP BY c.trade_date
    ) SELECT
      (SELECT COUNT(*) FROM calendar) calendar_days,
      COUNT(*) common_days,
      ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM calendar),2) common_pct,
      SUM(trade_date>='2025-07-15') recent_common_days,
      (SELECT COUNT(*) FROM calendar WHERE trade_date>='2025-07-15') recent_calendar_days,
      ROUND(100.0*SUM(trade_date>='2025-07-15')/(SELECT COUNT(*) FROM calendar WHERE trade_date>='2025-07-15'),2) recent_common_pct
    FROM common`).get();
  const extendedGate = {
    optionVolatility: db.prepare('SELECT COUNT(DISTINCT trade_date) days FROM option_volatility_daily').get().days,
    optionTermStructure: db.prepare('SELECT COUNT(*) days FROM option_volatility_term_daily').get().days,
    securitiesLending: db.prepare('SELECT COUNT(DISTINCT trade_date) days FROM securities_lending_daily').get().days,
    etfFlows: db.prepare('SELECT COUNT(DISTINCT trade_date) days FROM etf_flow_daily').get().days,
    breadth: db.prepare(`SELECT COUNT(*) days FROM market_daily WHERE listed_advance IS NOT NULL AND listed_decline IS NOT NULL
      AND otc_advance IS NOT NULL AND otc_decline IS NOT NULL`).get().days
  };
  const timingAuditPath = path.join(config.reportsPath, 'v3-6-2-available-at-audit.json');
  const timingAudit = fs.existsSync(timingAuditPath) ? JSON.parse(fs.readFileSync(timingAuditPath, 'utf8')) : { passed: false };
  const requiredExtendedPassed = extendedGate.optionVolatility >= 700
    && extendedGate.optionTermStructure >= 700
    && extendedGate.securitiesLending >= 700
    && extendedGate.breadth >= 700;
  const institutionalOiPassed = institutionalFuturesOiConsistency.summary.passed;
  const researchReady = Boolean(coreGate.common_days >= 700 && coreGate.common_pct >= 95
    && coreGate.recent_common_pct >= 99 && institutionalOiPassed && requiredExtendedPassed && timingAudit.passed);
  const registry = db.prepare(`SELECT dataset_key,collection_status,COUNT(*) days,MIN(trade_date) first_date,MAX(trade_date) last_date
    FROM research_input_registry_daily GROUP BY dataset_key,collection_status ORDER BY dataset_key,collection_status`).all();
  const researchRunPath = path.join(config.reportsPath, 'v3-6-2-research-run.json');
  const researchStarted = fs.existsSync(researchRunPath)
    && JSON.parse(fs.readFileSync(researchRunPath, 'utf8')).researchStarted === true;
  const report = { generatedAt: now, researchStarted,
    institutionalFutures: { coverage, missingDates, oiConsistency: institutionalFuturesOiConsistency }, spotGross, spotGrossConsistency,
    spotGrossMismatchDates, futuresOi: oi,
    optionInstitutions: { coverage: optionInstitutions, incompleteDates: optionInstitutionIncomplete },
    optionLargeTraders: { coverage: optionLargeTraders, incompleteDates: optionLargeTraderIncomplete },
    gates: { core: { ...coreGate, institutionalOiConsistencyPassed: institutionalOiPassed,
        passed: coreGate.common_days>=700 && coreGate.common_pct>=95 && coreGate.recent_common_pct>=99 && institutionalOiPassed },
      extended: extendedGate,
      moduleStatus: { etfCreationRedemption: { status: 'excluded', reason: 'No free official three-year daily creation/redemption history was verified; volume and AUM changes are not substituted.' } },
      timingAuditPassed: Boolean(timingAudit.passed),
      researchReady,
      blockedReason: researchReady ? null : 'One or more core, extended, or timing gates remain incomplete.' },
    registry };
  fs.writeFileSync(path.join(config.reportsPath, 'v3-6-2-collection-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
