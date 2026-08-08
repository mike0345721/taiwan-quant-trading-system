import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { normalizeOiRows, oiAudit } from '../src/oi-normalization.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const source = db.prepare(`SELECT m.trade_date AS tradeDate, m.tx_contract AS nearContract,
    m.tx_open_interest AS nearContractOi,
    near.market_open_interest AS nearScopeMarketOi,
    allc.market_open_interest AS allContractsMarketOi,
    allc.market_open_interest AS totalMarketOi,
    COALESCE(allc.product_scope,near.product_scope) AS productScope,
    b.days_to_near_expiry AS daysToNearExpiry, b.rollover_risk AS rolloverRisk
    FROM market_daily m
    LEFT JOIN large_trader_futures_daily near ON near.trade_date=m.trade_date AND near.expiry_scope='near_month'
    LEFT JOIN large_trader_futures_daily allc ON allc.trade_date=m.trade_date AND allc.expiry_scope='all_contracts'
    LEFT JOIN basis_term_structure_daily b USING(trade_date)
    WHERE m.tx_close IS NOT NULL ORDER BY m.trade_date`).all();
  const builtAt = new Date().toISOString();
  const rows = normalizeOiRows(source, builtAt);
  const insert = db.prepare(`INSERT OR REPLACE INTO futures_oi_daily
    (trade_date,near_contract,near_contract_oi,total_market_oi,research_oi,research_definition,
     days_to_near_expiry,rollover_risk,contract_changed,quality_status,built_at,
     near_scope_market_oi,all_contracts_market_oi,product_scope)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  withTransaction(db, () => {
    db.exec('DELETE FROM futures_oi_daily');
    for (const row of rows) insert.run(
      row.tradeDate, row.nearContract, row.nearContractOi, row.totalMarketOi, row.researchOi,
      row.researchDefinition, row.daysToNearExpiry, row.rolloverRisk, row.contractChanged,
      row.qualityStatus, row.builtAt, row.nearScopeMarketOi, row.allContractsMarketOi, row.productScope,
    );
  });
  const register = db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
    (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,
     product_scope,expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,
     quality_status,rollover_flag,error)
    VALUES (?,?,?,?,?,'final_after_16_15','regular',?,?,'all_large_traders','contracts',?,NULL,?,?,?,?)`);
  withTransaction(db, () => {
    for (const row of rows) {
      for (const [scope, value] of [['near_month', row.nearScopeMarketOi], ['all_contracts', row.allContractsMarketOi]]) {
        const complete = value != null;
        register.run('taifex_futures_market_oi', row.tradeDate, complete ? 'success' : 'no_data',
          `${row.tradeDate}T16:30:00+08:00`, builtAt, row.productScope || 'TX_MTX_TMF_EQUIVALENT', scope,
          'https://www.taifex.com.tw/cht/3/largeTraderFutQry', complete ? 1 : 0,
          complete ? row.qualityStatus : 'official_scope_missing', row.rolloverRisk,
          complete ? null : `No official ${scope} market OI row.`);
      }
    }
  });
  const audit = { generatedAt: builtAt, ...oiAudit(rows) };
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'oi-normalization-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  const lines = [
    '# V3.3 期貨未平倉量口徑稽核', '',
    `產生時間：${audit.generatedAt}`, '',
    `- 研究期間：${audit.firstDate} 至 ${audit.lastDate}，共 ${audit.rows} 個交易日。`,
    `- 近月合約OI覆蓋：${audit.nearOiCoverage}/${audit.rows}。`,
    `- 全市場OI覆蓋：${audit.totalOiCoverage}/${audit.rows}。`,
    `- 大額交易人近月範圍市場OI覆蓋：${audit.nearScopeMarketOiCoverage}/${audit.rows}。`,
    `- 大額交易人全契約市場OI覆蓋：${audit.allContractsMarketOiCoverage}/${audit.rows}。`,
    `- 可直接比較兩種口徑：${audit.comparableDays}日；數值不同：${audit.definitionMismatchDays}日。`,
    `- 乾淨研究日：${audit.quality.clean}日；結算／轉倉窗：${audit.quality.rolloverWindow}日；換月首日：${audit.quality.contractChanged}日。`, '',
    '## 決策', '',
    '- 研究OI固定使用「近月合約OI」，不再以COALESCE混用全市場OI。',
    '- 1日／3日OI變化必須整段皆為同一近月契約，且不得落在到期前2日或換月首日。',
    '- 近月範圍與全契約市場OI均由相同大額交易人等價商品口徑重建並分欄保存。',
    '- 原有只有少數日期的舊市場OI欄位不再作為這兩個欄位的來源。', '',
    '## 已發現的口徑切換日期', '',
    '| 日期 | 近月OI | 全市場OI | 差額 |', '|---|---:|---:|---:|',
    ...audit.mismatchDates.map((row) => `| ${row.tradeDate} | ${row.nearContractOi} | ${row.totalMarketOi} | ${row.difference} |`), '',
    '本報告只處理資料定義與可用性，不把OI增加或下降直接解讀為多空。',
  ];
  fs.writeFileSync(path.join(config.reportsPath, 'V3_3_OI_NORMALIZATION_AUDIT.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify(audit, null, 2));
} finally {
  db.close();
}
