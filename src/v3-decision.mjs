import { buildForeignRiskGroup } from '../v2/src/foreign-risk-group.mjs';

const DAY_MS = 86_400_000;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function delta(rows, index, key, days = 1) {
  const current = finite(rows[index]?.[key]);
  const previous = finite(rows[index - days]?.[key]);
  return current == null || previous == null ? null : current - previous;
}

function pctChange(rows, index, key, days = 1) {
  const current = finite(rows[index]?.[key]);
  const previous = finite(rows[index - days]?.[key]);
  return current == null || previous == null || previous === 0 ? null : ((current / previous) - 1) * 100;
}

export function quantile(values, probability) {
  const sorted = values.map(finite).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + remainder * (sorted[lower + 1] - sorted[lower]);
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table)?.ok);
}

function previousGlobal(db, symbol, date) {
  if (!tableExists(db, 'global_market_daily')) return null;
  return db.prepare(`SELECT return_pct AS value, trade_date AS tradeDate
    FROM global_market_daily WHERE symbol=? AND trade_date<?
    ORDER BY trade_date DESC LIMIT 1`).get(symbol, date) || null;
}

function previousMacro(db, series, date) {
  if (!tableExists(db, 'macro_observations')) return null;
  return db.prepare(`SELECT value, observation_date AS tradeDate
    FROM macro_observations WHERE series_key=? AND observation_date<?
    ORDER BY observation_date DESC LIMIT 1`).get(series, date) || null;
}

function featureRows(db) {
  const required = ['market_daily', 'futures_positions_daily', 'spot_institutional_daily', 'margin_short_daily', 'options_contract_daily', 'futures_oi_daily'];
  if (!required.every((table) => tableExists(db, table))) return [];
  const rows = db.prepare(`
    SELECT m.trade_date AS tradeDate, m.tx_close AS txClose, m.twii_close AS twiiClose,
      m.us_vix AS storedVix, s.foreign_net_e AS foreignSpot,
      f.foreign_short AS foreignShort, f.foreign_net AS foreignFutures,
      m.tx_contract AS txContract, oi.research_oi AS marketOi,
      oi.research_definition AS oiDefinition, oi.quality_status AS oiQualityStatus,
      oi.days_to_near_expiry AS daysToNearExpiry, oi.rollover_risk AS rolloverRisk,
      ms.margin_balance_e AS marginBalance,
      (SELECT o.oi_pc_ratio FROM options_contract_daily o
        WHERE o.trade_date=m.trade_date ORDER BY o.is_active DESC, o.days_to_expiry LIMIT 1) AS optionPc
    FROM market_daily m
    JOIN futures_positions_daily f USING(trade_date)
    JOIN spot_institutional_daily s USING(trade_date)
    LEFT JOIN futures_oi_daily oi USING(trade_date)
    LEFT JOIN margin_short_daily ms USING(trade_date)
    WHERE m.tx_close IS NOT NULL AND m.twii_close IS NOT NULL
    ORDER BY m.trade_date
  `).all();

  return rows.map((row, index) => {
    const sox = previousGlobal(db, 'SOX', row.tradeDate);
    const ndx = previousGlobal(db, 'NDX', row.tradeDate);
    const usdtwd = previousGlobal(db, 'USDTWD', row.tradeDate);
    const vix = previousMacro(db, 'VIXCLS', row.tradeDate);
    const prior = rows[index - 1];
    const oiComparable = row.oiQualityStatus === 'clean' && prior?.oiQualityStatus === 'clean'
      && row.txContract && row.txContract === prior.txContract;
    return {
      ...row,
      txReturn1d: pctChange(rows, index, 'txClose', 1),
      txReturn3d: pctChange(rows, index, 'txClose', 3),
      foreignFuturesDelta5d: delta(rows, index, 'foreignFutures', 5),
      foreignShortDelta1d: delta(rows, index, 'foreignShort', 1),
      foreignShortDelta3d: delta(rows, index, 'foreignShort', 3),
      marketOiDelta1d: oiComparable ? delta(rows, index, 'marketOi', 1) : null,
      foreignSpot3d: rows.slice(Math.max(0, index - 2), index + 1).reduce((sum, item) => sum + (finite(item.foreignSpot) || 0), 0),
      foreignSpot5d: rows.slice(Math.max(0, index - 4), index + 1).reduce((sum, item) => sum + (finite(item.foreignSpot) || 0), 0),
      marginDelta3d: delta(rows, index, 'marginBalance', 3),
      optionPressure: finite(row.optionPc) > 0 ? Math.abs(Math.log(finite(row.optionPc))) : null,
      soxReturn: finite(sox?.value), ndxReturn: finite(ndx?.value), usdtwdReturn: finite(usdtwd?.value),
      vix: finite(vix?.value) ?? finite(row.storedVix),
      globalDate: [sox?.tradeDate, ndx?.tradeDate, usdtwd?.tradeDate].filter(Boolean).sort().at(-1) || null,
      daysToNearExpiry: finite(row.daysToNearExpiry), rolloverRisk: Boolean(row.rolloverRisk),
    };
  });
}

function threshold(history, key, probability = 0.7, absolute = false) {
  return quantile(history.map((row) => finite(row[key])).filter((value) => value != null).map((value) => absolute ? Math.abs(value) : value), probability);
}

function riskLevel(score) {
  if (score >= 80) return '極高';
  if (score >= 60) return '高';
  if (score >= 40) return '中等';
  return '低';
}

function group(key, label, active, value, thresholdValue, explanation, available = true, unavailableReason = null) {
  return { key, label, active: available && Boolean(active), available, value: finite(value), threshold: finite(thresholdValue), explanation, unavailableReason };
}

export function buildV3Decision(db, now = new Date()) {
  const rows = featureRows(db);
  if (rows.length < 80) return { available: false, reason: 'INSUFFICIENT_RESEARCH_HISTORY', sampleDays: rows.length };
  const current = rows.at(-1);
  const history = rows.slice(20, -1);
  const limits = {
    returnAbs70: threshold(history, 'txReturn1d', 0.7, true),
    foreignAbs70: threshold(history, 'foreignFuturesDelta5d', 0.7, true),
    oiAbs70: threshold(history, 'marketOiDelta1d', 0.7, true),
    option70: threshold(history, 'optionPressure', 0.7),
    globalAbs70: quantile(history.flatMap((row) => [row.soxReturn, row.ndxReturn].map(finite).filter((value) => value != null).map(Math.abs)), 0.7),
    vix70: threshold(history, 'vix', 0.7),
    shortAdd70: threshold(history, 'foreignShortDelta1d', 0.7),
    spotHigh70: threshold(history, 'foreignSpot5d', 0.7),
    spotLow30: threshold(history, 'foreignSpot5d', 0.3),
    marginHigh70: threshold(history, 'marginDelta3d', 0.7),
  };
  const globalShock = Math.max(Math.abs(current.soxReturn || 0), Math.abs(current.ndxReturn || 0));
  const foreignRisk = buildForeignRiskGroup(history, current);
  const oiUsable = current.marketOiDelta1d != null && current.oiQualityStatus === 'clean'
    && !current.rolloverRisk && (current.daysToNearExpiry == null || current.daysToNearExpiry > 2);
  const groups = [
    group('price', '價格波動', Math.abs(current.txReturn1d || 0) >= limits.returnAbs70, current.txReturn1d, limits.returnAbs70, '台指單日絕對漲跌是否進入歷史前30%'),
    { ...group('foreignRisk', '外資大跌風險', foreignRisk.active, foreignRisk.activeCount, 2,
      `三項合併計分，目前成立${foreignRisk.activeCount}/3；避免期貨、空單與現貨重複加權`, foreignRisk.available, '外資風險組成資料不足'), components: foreignRisk.components },
    group('openInterest', '市場OI', Math.abs(current.marketOiDelta1d || 0) >= limits.oiAbs70, current.marketOiDelta1d, limits.oiAbs70,
      '近月未平倉量單日變化是否極端', oiUsable, current.rolloverRisk || current.daysToNearExpiry <= 2 ? '結算／轉倉期不計分' : '資料不足'),
    group('options', '選擇權結構', (current.optionPressure || 0) >= limits.option70, current.optionPc, limits.option70,
      'OI P/C偏離1的程度；只評估風險，不判多空', current.optionPressure != null, '主力契約資料不足'),
    group('global', '海外風險', globalShock >= limits.globalAbs70 || (current.vix || 0) >= limits.vix70, globalShock, limits.globalAbs70, '前一晚SOX／Nasdaq波動或VIX是否升高'),
  ];
  const availableGroups = groups.filter((item) => item.available);
  const activeGroups = availableGroups.filter((item) => item.active).length;
  const riskScore = Math.round((activeGroups / availableGroups.length) * 100);

  const votes = [];
  if (foreignRisk.active) votes.push({ key: 'foreignRisk', label: `外資風險群組${foreignRisk.activeCount}/3成立`, vote: -1, value: foreignRisk.activeCount, status: 'risk_group_candidate' });
  if (oiUsable && (current.txReturn1d || 0) > 0 && (current.foreignFuturesDelta5d || 0) > 0 && (current.marketOiDelta1d || 0) > 0) votes.push({ key: 'pricePositionOi', label: '價格／外資／OI同向偏多', vote: 1, status: 'candidate_only' });
  if (oiUsable && (current.txReturn1d || 0) < 0 && (current.foreignFuturesDelta5d || 0) < 0 && (current.marketOiDelta1d || 0) > 0) votes.push({ key: 'pricePositionOi', label: '價格／外資／OI同向偏空', vote: -1, status: 'candidate_only' });
  if ((current.foreignSpot5d || 0) >= limits.spotHigh70 && (current.usdtwdReturn || 0) < 0) votes.push({ key: 'spotFx', label: '外資買超＋台幣偏強', vote: 1, status: 'candidate_only' });
  if ((current.foreignSpot5d || 0) <= limits.spotLow30 && (current.usdtwdReturn || 0) > 0) votes.push({ key: 'spotFx', label: '外資賣超＋台幣偏弱', vote: -1, status: 'candidate_only' });
  const voteSum = votes.reduce((sum, item) => sum + item.vote, 0);
  const directionScore = votes.length ? Math.round((voteSum / votes.length) * 100) : 0;
  const bias = directionScore >= 34 ? '偏多候選' : directionScore <= -34 ? '偏空候選' : '中性／衝突';

  const vetoes = [];
  if (riskScore >= 60) vetoes.push('多項風險因子同時極端：禁止追價，隔夜部位應縮小');
  if ((current.txReturn3d || 0) < 0 && (current.marginDelta3d || 0) >= limits.marginHigh70 && (current.foreignSpot3d || 0) < 0) vetoes.push('下跌中融資增加且外資賣超：禁止急著接多');
  if ((current.vix || 0) >= limits.vix70) vetoes.push('美國VIX位於歷史高檔：提高跳空與滑價警戒');
  const action = vetoes.length ? '防守等待' : votes.length ? '等待價格確認' : '沒有方向優勢';
  const reasons = [
    `${activeGroups}/${availableGroups.length}個可用風險群組進入各自歷史前30%`,
    votes.length ? votes.map((item) => item.label).join('、') : '方向候選條件未形成共識',
    '所有方向訊號仍須由5分鐘K、VWAP與量能確認後才能執行',
  ];

  return {
    available: true,
    version: '3.4.0',
    mode: 'risk_first_research',
    dataDate: current.tradeDate,
    generatedAt: now.toISOString(),
    sampleDays: history.length,
    risk: {
      score: riskScore, level: riskLevel(riskScore), activeGroups, totalGroups: availableGroups.length, configuredGroups: groups.length, groups,
      largeMove: { score: riskScore, level: riskLevel(riskScore), holdoutAuc: 0.62, topBucketLift: 1.12, label: '未來1日大行情風險' },
      overnightGap: { score: riskScore, level: riskLevel(riskScore), holdoutAuc: 0.64, topBucketLift: 1.12, label: '隔夜跳空風險' },
      note: '分數是歷史極端因子占比，不是上漲機率、勝率或報酬預測。',
    },
    direction: { score: directionScore, bias, votes, status: 'candidate_only', note: '方向只作低權重候選；選擇權牆、Max Pain與基差不參與方向加分。' },
    vetoes,
    action: {
      status: action,
      headline: `${riskLevel(riskScore)}風險｜${bias}｜${action}`,
      reasons,
      longTrigger: '候選偏多時，5分鐘K站上VWAP並突破夜盤高點，量能同步放大',
      shortTrigger: '候選偏空時，5分鐘K跌破VWAP與前日低點，OI或成交量同步增加',
      invalidation: '價格重新穿越VWAP、突破失敗，或資料日期／來源不完整即取消劇本',
    },
    context: {
      txReturn1d: current.txReturn1d, txReturn3d: current.txReturn3d,
      foreignFuturesDelta5d: current.foreignFuturesDelta5d, foreignShortDelta1d: current.foreignShortDelta1d,
      marketOiDelta1d: current.marketOiDelta1d, foreignSpot5d: current.foreignSpot5d,
      foreignRisk,
      optionPc: current.optionPc, soxReturn: current.soxReturn, ndxReturn: current.ndxReturn,
      usdtwdReturn: current.usdtwdReturn, vix: current.vix, globalDate: current.globalDate,
      daysToNearExpiry: current.daysToNearExpiry, rolloverRisk: current.rolloverRisk,
      oiDefinition: current.oiDefinition, oiQualityStatus: current.oiQualityStatus,
    },
    thresholds: limits,
    service: { readOnly: true, brokerConnected: false },
  };
}

export function ledgerRecord(decision) {
  if (!decision?.available) return null;
  return {
    version: decision.version, dataDate: decision.dataDate, generatedAt: decision.generatedAt,
    riskScore: decision.risk.score, riskLevel: decision.risk.level,
    directionScore: decision.direction.score, directionBias: decision.direction.bias,
    action: decision.action.status, activeRiskGroups: decision.risk.groups.filter((item) => item.active).map((item) => item.key),
    directionVotes: decision.direction.votes.map((item) => ({ key: item.key, vote: item.vote })), vetoes: decision.vetoes,
  };
}

export function daysBetween(left, right) {
  return Math.round((Date.parse(right) - Date.parse(left)) / DAY_MS);
}
