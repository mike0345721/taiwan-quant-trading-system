import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';
import { buildV3Decision } from './v3-decision.mjs';
import { buildV362RiskSummary } from './v362-risk.mjs';
import { buildOptionsSmartRadar } from './options-smart-radar.mjs';

const DAY_OPTIONS = new Set([20, 60, 120, 250]);
const DELTA_COLUMNS = Object.freeze({
  1: ['call_oi_delta_1d', 'put_oi_delta_1d'],
  3: ['call_oi_delta_3d', 'put_oi_delta_3d'],
  5: ['call_oi_delta_5d', 'put_oi_delta_5d'],
});
const CONTRACT_RE = /^\d{6}(?:[WF]\d)?$/;

export function normalizeResearchQuery({ days, delta, contract } = {}) {
  const parsedDays = Number.parseInt(days, 10);
  const parsedDelta = Number.parseInt(delta, 10);
  return {
    days: DAY_OPTIONS.has(parsedDays) ? parsedDays : 60,
    delta: Object.hasOwn(DELTA_COLUMNS, parsedDelta) ? parsedDelta : 1,
    contract: typeof contract === 'string' && CONTRACT_RE.test(contract) ? contract : '',
  };
}

export class V2ResearchService {
  constructor(databasePath = config.v2DatabasePath, reportPath = config.v2ReportPath) {
    this.databasePath = databasePath;
    this.reportPath = reportPath;
    this.basisTermReportPath = path.join(path.dirname(reportPath), 'basis-term-structure-research.json');
    this.noTradeReportPath = path.join(path.dirname(reportPath), 'no-trade-veto.json');
    this.holdingReportPath = path.join(path.dirname(reportPath), 'holding-selector.json');
    this.pairedReportPath = path.join(path.dirname(reportPath), 'paired-incremental.json');
    this.forwardLedgerPath = path.join(path.dirname(path.dirname(reportPath)), 'data', 'forward', 'paper-ledger-v2.9.4.jsonl');
    this.v3ForwardStatusPath = path.join(path.dirname(reportPath), 'v3-forward-status.json');
    this.oiAuditPath = path.join(path.dirname(reportPath), 'oi-normalization-audit.json');
    this.v34ForwardStatusPath = path.join(path.dirname(reportPath), 'v3.4-forward-status.json');
    this.foreignRiskReportPath = path.join(path.dirname(reportPath), 'foreign-risk-group-v3.4.json');
    this.v362ExtendedPath = path.join(path.dirname(reportPath), 'v3-6-2-extended-factor-research.json');
    this.v362FinalPath = path.join(path.dirname(reportPath), 'v3-6-2-cross-market-research.json');
    this.v362AuditPath = path.join(path.dirname(reportPath), 'v3-6-2-collection-audit.json');
    this.dailyUpdateStatusPath = path.join(path.dirname(reportPath), 'v3-daily-update-status.json');
  }

  decisionSupport() {
    const read = (filePath) => {
      try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
    };
    const veto = read(this.noTradeReportPath); const holding = read(this.holdingReportPath); const paired = read(this.pairedReportPath);
    const v3Forward = read(this.v3ForwardStatusPath); const oiAudit = read(this.oiAuditPath);
    const v34Forward = read(this.v34ForwardStatusPath); const foreignRisk = read(this.foreignRiskReportPath);
    const v362Extended = read(this.v362ExtendedPath); const v362Final = read(this.v362FinalPath); const v362Audit = read(this.v362AuditPath);
    const highVolatility = veto?.studies?.find((item) => item.key === 'high_vol_regime');
    const foldChoices = holding?.development?.folds?.reduce((counts, fold) => ({ ...counts, [fold.choice]: (counts[fold.choice] || 0) + 1 }), {}) || {};
    const holdoutComparisons = paired?.families?.flatMap((family) => family.holdout?.comparisons || []) || [];
    let forwardRecords = 0;
    try { if (fs.existsSync(this.forwardLedgerPath)) forwardRecords = fs.readFileSync(this.forwardLedgerPath, 'utf8').split(/\r?\n/).filter(Boolean).length; } catch { forwardRecords = 0; }
    let v3 = { available: false, reason: 'V2_DATABASE_NOT_READY' };
    let v362Risk = { available: false, reason: 'V2_DATABASE_NOT_READY' };
    let globalContext = { available: false, latest: [], coverage: [] };
    if (this.available()) {
      const db = new DatabaseSync(this.databasePath, { readOnly: true });
      try {
        db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
        v3 = buildV3Decision(db);
        v362Risk = buildV362RiskSummary(db, { v3, extendedReport: v362Extended, finalReport: v362Final, auditReport: v362Audit });
        globalContext = this.#globalContext(db);
      } catch (error) {
        v3 = { available: false, reason: 'V3_DECISION_UNAVAILABLE', detail: error.message };
      } finally {
        db.close();
      }
    }
    return {
      generatedAt: [veto?.generatedAt, holding?.generatedAt, paired?.generatedAt].filter(Boolean).sort().at(-1) || null,
      status: 'research_only',
      noTrade: highVolatility ? { highVolatility: {
        verdict: highVolatility.evidence?.verdict,
        vetoedTrades: highVolatility.holdout?.vetoed?.trades,
        keptProfitFactor: highVolatility.holdout?.kept?.profitFactor,
        keptMae10PctPoints: highVolatility.holdout?.kept?.mae10PctPoints,
      } } : null,
      holding: holding ? { finalChoice: holding.finalHoldout?.choice, foldChoices, caveat: holding.caveat } : null,
      incremental: paired ? { holdoutSupportedComparisons: holdoutComparisons.filter((item) => item.supported).length,
        holdoutTotalComparisons: holdoutComparisons.length, verdict: holdoutComparisons.some((item) => item.supported) ? 'candidate_only' : 'not_supported' } : null,
      forward: { records: forwardRecords, status: forwardRecords ? 'tracking' : 'awaiting_new_data' },
      v3: { ...v3, forward: v3Forward, v34Forward, foreignRiskResearch: foreignRisk, oiAudit },
      v362Risk,
      globalContext,
    };
  }

  available() {
    return fs.existsSync(this.databasePath) && fs.statSync(this.databasePath).size > 0;
  }

  dailyUpdateStatus() {
    try {
      return fs.existsSync(this.dailyUpdateStatusPath)
        ? JSON.parse(fs.readFileSync(this.dailyUpdateStatusPath, 'utf8'))
        : { state: 'never_run', formalResearchRerun: false };
    } catch {
      return { state: 'unavailable', formalResearchRerun: false };
    }
  }

  backtestReport() {
    if (!fs.existsSync(this.reportPath)) {
      const error = new Error('V2_BACKTEST_NOT_READY');
      error.statusCode = 503;
      throw error;
    }
    return JSON.parse(fs.readFileSync(this.reportPath, 'utf8'));
  }

  query(input = {}) {
    if (!this.available()) {
      const error = new Error('V2_DATABASE_NOT_READY');
      error.statusCode = 503;
      throw error;
    }
    const query = normalizeResearchQuery(input);
    const db = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
      const latestOptionDate = db.prepare('SELECT MAX(trade_date) AS value FROM options_contract_daily').get()?.value;
      const contracts = latestOptionDate ? db.prepare(`
        SELECT contract, contract_type AS contractType, expiry_date AS expiryDate,
          days_to_expiry AS daysToExpiry, is_active AS isActive, call_oi AS callOi,
          put_oi AS putOi, oi_pc_ratio AS oiPcRatio
        FROM options_contract_daily WHERE trade_date=?
        ORDER BY is_active DESC, expiry_date, contract
      `).all(latestOptionDate) : [];
      const selectedContract = contracts.some((row) => row.contract === query.contract)
        ? query.contract
        : (contracts.find((row) => row.isActive)?.contract || contracts[0]?.contract || '');
      return {
        generatedAt: new Date().toISOString(),
        query: { ...query, contract: selectedContract },
        status: this.#status(db),
        futures: this.#futures(db, query.days),
        options: this.#options(db, latestOptionDate, contracts, selectedContract, query.days, query.delta),
        globalContext: this.#globalContext(db),
        termStructure: this.#termStructure(db, query.days),
        service: { readOnly: true, brokerConnected: false, rawSqlAccepted: false },
      };
    } finally {
      db.close();
    }
  }

  #status(db) {
    const range = db.prepare(`
      SELECT MIN(m.trade_date) AS firstDate, MAX(m.trade_date) AS lastDate, COUNT(*) AS alignedDays
      FROM market_daily m JOIN futures_positions_daily f USING(trade_date)
      WHERE m.twii_close IS NOT NULL AND m.tx_close IS NOT NULL
        AND EXISTS (SELECT 1 FROM options_contract_daily o WHERE o.trade_date=m.trade_date)
    `).get();
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM futures_positions_daily) AS futuresDays,
      (SELECT COUNT(DISTINCT trade_date) FROM options_contract_daily) AS optionDays,
      (SELECT COUNT(*) FROM options_strike_daily) AS strikeRows`).get();
    const issues = Object.fromEntries(db.prepare('SELECT severity, COUNT(*) AS count FROM quality_issues GROUP BY severity')
      .all().map((row) => [row.severity, row.count]));
    return { ...range, ...counts, issues: { error: issues.error || 0, warning: issues.warning || 0, info: issues.info || 0 } };
  }

  #futures(db, days) {
    return db.prepare(`
      SELECT m.trade_date AS tradeDate, m.twii_close AS twiiClose,
        fc.open AS txOpen, fc.high AS txHigh, fc.low AS txLow,
        COALESCE(fc.close, m.tx_close) AS txClose,
        m.basis, f.foreign_net AS foreignNet,
        COALESCE(f.market_open_interest, m.tx_open_interest) AS marketOi
      FROM market_daily m JOIN futures_positions_daily f USING(trade_date)
      LEFT JOIN futures_contract_daily fc ON fc.trade_date=m.trade_date
        AND fc.product='TX' AND fc.session='一般' AND fc.is_active=1
      WHERE m.twii_close IS NOT NULL AND m.tx_close IS NOT NULL
      ORDER BY m.trade_date DESC LIMIT ?
    `).all(days).reverse();
  }

  #options(db, latestDate, contracts, contract, days, delta) {
    if (!latestDate || !contract) return { latestDate, contracts, selected: null, strikes: [], history: [], deltaDays: delta };
    const strikeColumns = new Set(db.prepare('PRAGMA table_info(options_strike_daily)').all().map((row) => row.name));
    const hasCallClose = strikeColumns.has('call_close');
    const hasPutClose = strikeColumns.has('put_close');
    const selected = db.prepare(`
      SELECT trade_date AS tradeDate, contract, contract_type AS contractType,
        expiry_date AS expiryDate, days_to_expiry AS daysToExpiry, is_active AS isActive,
        call_volume AS callVolume, put_volume AS putVolume, volume_pc_ratio AS volumePcRatio,
        call_oi AS callOi, put_oi AS putOi, oi_pc_ratio AS oiPcRatio,
        call_wall_strike AS callWallStrike, call_wall_oi AS callWallOi,
        put_wall_strike AS putWallStrike, put_wall_oi AS putWallOi, max_pain AS maxPain
      FROM options_contract_daily WHERE trade_date=? AND contract=?
    `).get(latestDate, contract);
    const [callColumn, putColumn] = DELTA_COLUMNS[delta];
    const strikes = db.prepare(`
      SELECT s.strike, s.call_oi AS callOi, s.put_oi AS putOi,
        s.call_volume AS callVolume, s.put_volume AS putVolume,
        ${hasCallClose ? 's.call_close' : 'NULL'} AS callClose,
        ${hasPutClose ? 's.put_close' : 'NULL'} AS putClose,
        c.call_oi_delta_1d AS callOiDelta1d, c.put_oi_delta_1d AS putOiDelta1d,
        c.${callColumn} AS callDelta, c.${putColumn} AS putDelta
      FROM options_strike_daily s LEFT JOIN option_oi_changes c USING(trade_date, contract, strike)
      WHERE s.trade_date=? AND s.contract=? ORDER BY s.strike
    `).all(latestDate, contract);
    const strikeHistory = db.prepare(`
      SELECT trade_date AS tradeDate, strike, call_volume AS callVolume, put_volume AS putVolume,
        ${hasCallClose ? 'call_close' : 'NULL'} AS callClose,
        ${hasPutClose ? 'put_close' : 'NULL'} AS putClose
      FROM options_strike_daily
      WHERE contract=? AND trade_date<=?
      ORDER BY strike, trade_date DESC
    `).all(contract, latestDate);
    const byStrike = new Map();
    for (const row of strikeHistory) {
      const key = String(row.strike);
      if (!byStrike.has(key)) byStrike.set(key, []);
      if (byStrike.get(key).length < 21) byStrike.get(key).push(row);
    }
    for (const row of strikes) {
      const prior = (byStrike.get(String(row.strike)) || []).filter((item) => item.tradeDate < latestDate).slice(0, 20);
      const average = (key) => {
        const values = prior.map((item) => Number(item[key])).filter(Number.isFinite);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      };
      row.callVolumeMa20 = average('callVolume');
      row.putVolumeMa20 = average('putVolume');
      row.callVolumeSampleDays = prior.filter((item) => Number.isFinite(Number(item.callVolume))).length;
      row.putVolumeSampleDays = prior.filter((item) => Number.isFinite(Number(item.putVolume))).length;
      row.callPreviousClose = prior.find((item) => Number.isFinite(Number(item.callClose)))?.callClose ?? null;
      row.putPreviousClose = prior.find((item) => Number.isFinite(Number(item.putClose)))?.putClose ?? null;
    }
    const history = db.prepare(`
      SELECT o.trade_date AS tradeDate, o.call_wall_strike AS callWallStrike,
        o.call_wall_oi AS callWallOi, o.put_wall_strike AS putWallStrike,
        o.put_wall_oi AS putWallOi, o.max_pain AS maxPain,
        o.call_oi AS callOi, o.put_oi AS putOi, m.tx_close AS txClose
      FROM options_contract_daily o LEFT JOIN market_daily m USING(trade_date)
      WHERE o.contract=? ORDER BY o.trade_date DESC LIMIT ?
    `).all(contract, days).reverse();
    const hasVolatility = Boolean(db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name='option_volatility_daily'").get()?.value);
    const volatilityColumns = hasVolatility
      ? new Set(db.prepare('PRAGMA table_info(option_volatility_daily)').all().map((row) => row.name)) : new Set();
    const volatility = hasVolatility ? db.prepare(`SELECT trade_date AS tradeDate, contract,
      ${volatilityColumns.has('underlying_close') ? 'underlying_close' : 'NULL'} AS underlyingClose,
      ${volatilityColumns.has('atm_iv') ? 'atm_iv' : 'NULL'} AS atmIv,
      ${volatilityColumns.has('skew_25d') ? 'skew_25d' : 'NULL'} AS skew25d,
      ${volatilityColumns.has('iv_rv_spread') ? 'iv_rv_spread' : 'NULL'} AS ivRvSpread,
      ${volatilityColumns.has('quality_status') ? 'quality_status' : 'NULL'} AS qualityStatus
      FROM option_volatility_daily WHERE trade_date=? AND contract=?`).get(latestDate, contract) || null : null;
    const previousVolatility = hasVolatility && volatilityColumns.has('atm_iv')
      ? db.prepare(`SELECT trade_date AS tradeDate, atm_iv AS atmIv
        FROM option_volatility_daily WHERE contract=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1`).get(contract, latestDate) || null
      : null;
    const underlying = db.prepare('SELECT tx_close AS txClose FROM market_daily WHERE trade_date=?').get(latestDate)?.txClose ?? null;
    const smartRadar = buildOptionsSmartRadar({ selected, strikes, volatility, previousVolatility, underlying });
    return { latestDate, contracts, selected, strikes, history, deltaDays: delta, smartRadar };
  }

  #globalContext(db) {
    const exists = db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name='global_market_daily'").get()?.value;
    if (!exists) return { available: false, latest: [], coverage: [] };
    const symbols = ['SOX', 'NDX', 'USDTWD'];
    const latest = db.prepare(`SELECT g.symbol, g.trade_date AS tradeDate, g.close, g.previous_close AS previousClose,
      g.return_pct AS returnPct, r.source, r.fetched_at AS availableAt, r.payload_sha256 AS sourceHash
      FROM global_market_daily g
      JOIN (SELECT symbol, MAX(trade_date) AS trade_date FROM global_market_daily GROUP BY symbol) x
      ON x.symbol=g.symbol AND x.trade_date=g.trade_date
      LEFT JOIN global_import_runs r ON r.id=g.source_run_id
      WHERE g.symbol IN ('SOX','NDX','USDTWD') ORDER BY g.symbol`).all();
    const coverage = db.prepare(`SELECT symbol, MIN(trade_date) AS firstDate, MAX(trade_date) AS lastDate, COUNT(*) AS days
      FROM global_market_daily WHERE symbol IN ('SOX','NDX','USDTWD') GROUP BY symbol ORDER BY symbol`).all();
    return {
      available: symbols.every((symbol) => latest.some((row) => row.symbol === symbol)),
      latest,
      coverage,
      timing: '只使用台灣交易日前已完成的最近海外交易日',
      sourceMode: 'EOD_DELAYED_RESEARCH_CONTEXT',
      trueNqState: 'UNAVAILABLE_SOURCE_GAP',
    };
  }

  #termStructure(db, days) {
    const exists = db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name='basis_term_structure_daily'").get()?.value;
    if (!exists) return { available: false, latest: null, history: [], productionScoreWeight: 0 };
    const history = db.prepare(`SELECT trade_date AS tradeDate, near_contract AS nearContract,
      next_contract AS nextContract, near_close AS nearClose, next_close AS nextClose,
      days_to_near_expiry AS daysToNearExpiry, rollover_risk AS rolloverRisk,
      term_spread_points AS termSpreadPoints, term_spread_bps AS termSpreadBps,
      term_change_1d_bps AS termChange1dBps, term_change_5d_bps AS termChange5dBps,
      close_basis_points AS closeBasisPoints, close_basis_bps AS closeBasisBps,
      basis_change_1d_bps AS basisChange1dBps, basis_change_5d_bps AS basisChange5dBps
      FROM basis_term_structure_daily ORDER BY trade_date DESC LIMIT ?`).all(days).reverse();
    let scoreDecision = null;
    if (fs.existsSync(this.basisTermReportPath)) {
      try { scoreDecision = JSON.parse(fs.readFileSync(this.basisTermReportPath, 'utf8')).scoreDecision ?? null; } catch { scoreDecision = null; }
    }
    return {
      available: history.length > 0,
      latest: history.at(-1) ?? null,
      history,
      productionScoreWeight: scoreDecision?.productionWeight ?? 0,
      decision: scoreDecision?.decision ?? '研究資料已建立，尚未通過正式評分驗證。',
    };
  }
}
