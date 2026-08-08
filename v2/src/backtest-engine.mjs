import { cleanOiDelta } from './oi-normalization.mjs';
import { calculateFuturesRoundTripCost } from './trading-costs.mjs';

const STRATEGIES = Object.freeze([
  { key: 'foreign_spot_5d', version: '1.1.0', label: '外資現貨5日累積', mode: 'quantile', feature: 'foreignSpot5d', target: 'next_open_to_close' },
  { key: 'foreign_futures_delta_5d', version: '1.1.0', label: '外資期貨5日變化', mode: 'quantile', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close' },
  { key: 'active_option_pc', version: '1.1.0', label: '主力選擇權OI P/C', mode: 'quantile', feature: 'optionPc', target: 'next_open_to_close' },
  { key: 'max_pain_convergence', version: '1.1.0', label: 'Max Pain結算靠攏', mode: 'max_pain', target: 'next_open_to_close' },
  { key: 'option_wall_migration', version: '1.1.0', label: 'Call／Put牆同向移動', mode: 'wall_migration', target: 'next_open_to_close' },
  { key: 'option_wall_breakout_oi', version: '1.1.0', label: '牆位突破＋OI弱化確認', mode: 'wall_breakout_oi', target: 'next_open_to_close' },
  { key: 'sox_overnight', version: '1.0.1', label: '費半隔夜風向', mode: 'quantile', feature: 'soxReturnPct', target: 'same_day' },
  { key: 'ndx_overnight', version: '1.0.1', label: 'Nasdaq-100隔夜風向', mode: 'quantile', feature: 'ndxReturnPct', target: 'same_day' },
  { key: 'usdtwd_previous', version: '1.0.1', label: '美元／新台幣前日變化', mode: 'quantile', feature: 'usdtwdReturnPct', direction: -1, target: 'same_day' },
  { key: 'global_tech_alignment', version: '1.0.1', label: '海外科技＋匯率一致度', mode: 'global_context', target: 'same_day' },
  { key: 'composite_vote', version: '1.2.0', label: '三市場方向一致度', mode: 'composite', target: 'next_open_to_close' },
  { key: 'composite_bull_filter', version: '1.1.0', label: '三市場一致度（僅多頭盤）', mode: 'composite', allowedRegimes: ['bull'], target: 'next_open_to_close' },
  { key: 'composite_bull_long_only', version: '1.1.0', label: '三市場一致度（多頭盤只做多）', mode: 'composite', allowedRegimes: ['bull'], signalSide: 'long', target: 'next_open_to_close' },
  { key: 'composite_bull_short_only', version: '1.1.0', label: '三市場一致度（多頭盤只做空）', mode: 'composite', allowedRegimes: ['bull'], signalSide: 'short', target: 'next_open_to_close' },
  { key: 'foreign_futures_price_oi', version: '1.1.0', label: '外資期貨＋價格＋OI確認（1日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_futures_price_oi_h2', version: '1.0.0', label: '外資期貨＋價格＋OI確認（2日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 2, researchFamily: 'chip_incremental_h2', researchRole: 'full_candidate' },
  { key: 'foreign_futures_price_oi_h3', version: '1.0.0', label: '外資期貨＋價格＋OI確認（3日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 3, researchFamily: 'chip_incremental_h3', researchRole: 'full_candidate' },
  { key: 'price_only_benchmark_h2', version: '1.0.0', label: '基準：價格延續（2日）', mode: 'price_continuation', target: 'next_open_to_close', holdingDays: 2, researchFamily: 'chip_incremental_h2', researchRole: 'benchmark' },
  { key: 'price_oi_benchmark_h2', version: '1.0.0', label: '基準：價格＋OI（2日）', mode: 'price_oi', target: 'next_open_to_close', holdingDays: 2, researchFamily: 'chip_incremental_h2', researchRole: 'benchmark' },
  { key: 'price_oi_reversal_h2', version: '1.0.0', label: '前推候選：價格＋OI反向（2日）', mode: 'price_oi_reversal', target: 'next_open_to_close', holdingDays: 2, researchFamily: 'v3_4_forward', researchRole: 'forward_candidate' },
  { key: 'foreign_price_ablation_h2', version: '1.0.0', label: '消融：外資＋價格（2日）', mode: 'futures_price', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 2, researchFamily: 'chip_incremental_h2', researchRole: 'ablation' },
  { key: 'foreign_price_oi_no_highvol_h2', version: '1.0.0', label: '風險過濾：完整條件排除高波動（2日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', allowedRegimes: ['bull', 'bear', 'range'], target: 'next_open_to_close', holdingDays: 2, researchFamily: 'chip_incremental_h2', researchRole: 'risk_filter' },
  { key: 'price_only_benchmark_h3', version: '1.0.0', label: '基準：價格延續（3日）', mode: 'price_continuation', target: 'next_open_to_close', holdingDays: 3, researchFamily: 'chip_incremental_h3', researchRole: 'benchmark' },
  { key: 'price_oi_benchmark_h3', version: '1.0.0', label: '基準：價格＋OI（3日）', mode: 'price_oi', target: 'next_open_to_close', holdingDays: 3, researchFamily: 'chip_incremental_h3', researchRole: 'benchmark' },
  { key: 'foreign_price_ablation_h3', version: '1.0.0', label: '消融：外資＋價格（3日）', mode: 'futures_price', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 3, researchFamily: 'chip_incremental_h3', researchRole: 'ablation' },
  { key: 'foreign_price_oi_no_highvol_h3', version: '1.0.0', label: '風險過濾：完整條件排除高波動（3日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', allowedRegimes: ['bull', 'bear', 'range'], target: 'next_open_to_close', holdingDays: 3, researchFamily: 'chip_incremental_h3', researchRole: 'risk_filter' },
  { key: 'foreign_futures_price_oi_h5', version: '1.0.0', label: '外資期貨＋價格＋OI確認（5日）', mode: 'futures_price_oi', feature: 'foreignFuturesDelta5d', target: 'next_open_to_close', holdingDays: 5 },
  { key: 'foreign_short_add_1d_h1', version: '1.0.0', label: '外資單日大幅加空→1日', mode: 'foreign_short_add', feature: 'foreignShortDelta1d', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_short_add_1d_h3', version: '1.0.0', label: '外資單日大幅加空→3日', mode: 'foreign_short_add', feature: 'foreignShortDelta1d', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'foreign_short_add_1d_h5', version: '1.0.0', label: '外資單日大幅加空→5日', mode: 'foreign_short_add', feature: 'foreignShortDelta1d', target: 'next_open_to_close', holdingDays: 5 },
  { key: 'foreign_short_build_3d_h1', version: '1.0.0', label: '外資3日累積加空→1日', mode: 'foreign_short_add', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_short_build_3d_h3', version: '1.0.0', label: '外資3日累積加空→3日', mode: 'foreign_short_add', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'foreign_short_build_reversal_h3', version: '1.0.0', label: '前推候選：外資3日加空後反向（3日）', mode: 'foreign_short_add_reversal', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 3, researchFamily: 'v3_4_forward', researchRole: 'forward_candidate' },
  { key: 'foreign_short_build_3d_h5', version: '1.0.0', label: '外資3日累積加空→5日', mode: 'foreign_short_add', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 5 },
  { key: 'foreign_short_no_drop_h3', version: '1.0.0', label: '外資加空但價格未跌→3日', mode: 'foreign_short_no_drop', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'foreign_short_no_drop_h5', version: '1.0.0', label: '外資加空但價格未跌→5日', mode: 'foreign_short_no_drop', feature: 'foreignShortDelta3d', target: 'next_open_to_close', holdingDays: 5 },
  { key: 'institutional_net_alignment_h1', version: '1.0.0', label: '三大法人期貨淨部位同向→1日', mode: 'institutional_net_alignment', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'institutional_net_alignment_h2', version: '1.0.0', label: '三大法人期貨淨部位同向→2日', mode: 'institutional_net_alignment', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'institutional_net_alignment_h3', version: '1.0.0', label: '三大法人期貨淨部位同向→3日', mode: 'institutional_net_alignment', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'institutional_delta_alignment_h1', version: '1.0.0', label: '三大法人期貨單日增減同向→1日', mode: 'institutional_delta_alignment', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'institutional_delta_alignment_h2', version: '1.0.0', label: '三大法人期貨單日增減同向→2日', mode: 'institutional_delta_alignment', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'institutional_delta_alignment_h3', version: '1.0.0', label: '三大法人期貨單日增減同向→3日', mode: 'institutional_delta_alignment', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'institutional_delta_confirmed_h1', version: '1.0.0', label: '三法人增減＋價格＋OI確認→1日', mode: 'institutional_delta_confirmed', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'institutional_delta_confirmed_h2', version: '1.0.0', label: '三法人增減＋價格＋OI確認→2日', mode: 'institutional_delta_confirmed', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'institutional_delta_confirmed_h3', version: '1.0.0', label: '三法人增減＋價格＋OI確認→3日', mode: 'institutional_delta_confirmed', target: 'next_open_to_close', holdingDays: 3 },
  { key: 'foreign_trust_delta_h1', version: '1.0.0', label: '外資＋投信期貨增減同向→1日', mode: 'institutional_pair_delta', pair: 'foreign_trust', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_trust_delta_h2', version: '1.0.0', label: '外資＋投信期貨增減同向→2日', mode: 'institutional_pair_delta', pair: 'foreign_trust', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'foreign_dealer_delta_h1', version: '1.0.0', label: '外資＋自營商期貨增減同向→1日', mode: 'institutional_pair_delta', pair: 'foreign_dealer', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_dealer_delta_h2', version: '1.0.0', label: '外資＋自營商期貨增減同向→2日', mode: 'institutional_pair_delta', pair: 'foreign_dealer', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'foreign_led_confirmed_h1', version: '1.0.0', label: '外資極端增減＋投信不反向＋價格OI→1日', mode: 'foreign_led_confirmed', feature: 'foreignFuturesDelta1d', target: 'next_open_to_close', holdingDays: 1 },
  { key: 'foreign_led_confirmed_h2', version: '1.0.0', label: '外資極端增減＋投信不反向＋價格OI→2日', mode: 'foreign_led_confirmed', feature: 'foreignFuturesDelta1d', target: 'next_open_to_close', holdingDays: 2 },
  { key: 'max_pain_atr_convergence', version: '1.1.0', label: 'Max Pain嚴格收斂', mode: 'max_pain_strict', target: 'next_open_to_close' },
]);

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}
function stddev(values) {
  if (values.length < 2) return null;
  const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function sumWindow(rows, index, key, size) {
  if (index + 1 < size) return null;
  const values = rows.slice(index + 1 - size, index + 1).map((row) => Number(row[key]));
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function sameWallStreak(rows, index, key) {
  const contract = rows[index]?.optionContract;
  const value = Number(rows[index]?.[key]);
  if (!contract || !Number.isFinite(value)) return 0;
  let count = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const row = rows[cursor];
    if (row.optionContract !== contract || Number(row[key]) !== value) break;
    count += 1;
  }
  return count;
}

function trueRange(rows, index) {
  const row = rows[index]; const prior = rows[index - 1];
  if (!finite(row?.txHigh) || !finite(row?.txLow)) return null;
  const highLow = Number(row.txHigh) - Number(row.txLow);
  if (!finite(prior?.txClose)) return highLow;
  return Math.max(highLow, Math.abs(Number(row.txHigh) - Number(prior.txClose)), Math.abs(Number(row.txLow) - Number(prior.txClose)));
}

function atrWindow(rows, index, size = 20) {
  if (index + 1 < size) return null;
  const values = rows.slice(index + 1 - size, index + 1).map((_, offset) => trueRange(rows, index + 1 - size + offset));
  return values.every(finite) ? mean(values.map(Number)) : null;
}

function marketRegime(rows, index) {
  if (index < 20) return 'insufficient';
  const current = Number(rows[index].txClose); const previous20 = Number(rows[index - 20].txClose);
  const return20 = current / previous20 - 1;
  const returns = rows.slice(index - 19, index + 1).map((row, offset, window) => offset ? Number(row.txClose) / Number(window[offset - 1].txClose) - 1 : Number(row.txClose) / Number(rows[index - 20].txClose) - 1).filter(Number.isFinite);
  const volatility = (stddev(returns) || 0) * Math.sqrt(252);
  if (volatility >= 0.30) return 'high_vol';
  if (return20 >= 0.03) return 'bull';
  if (return20 <= -0.03) return 'bear';
  return 'range';
}

export function loadResearchRows(db, options = {}) {
  const raw = db.prepare(`SELECT m.trade_date AS tradeDate, m.tx_contract AS txContract, m.tx_close AS txClose, fc.open AS txOpen,
      fc.high AS txHigh, fc.low AS txLow, m.basis AS basis,
      s.foreign_net_e AS foreignSpot, f.foreign_long AS foreignLong, f.foreign_short AS foreignShort, f.foreign_net AS foreignFutures,
      f.trust_net AS trustFutures, f.dealer_net AS dealerFutures,
      ms.margin_balance_e AS marginBalanceE, ms.short_balance_lots AS shortBalanceLots,
      oi.research_oi AS marketOi, oi.research_oi AS researchOi,
      oi.research_definition AS marketOiDefinition, oi.quality_status AS qualityStatus,
      oi.days_to_near_expiry AS futuresDaysToExpiry, oi.rollover_risk AS futuresRolloverRisk,
      o.contract AS optionContract, o.days_to_expiry AS daysToExpiry,
      o.oi_pc_ratio AS optionPc, o.max_pain AS maxPain,
      o.call_wall_strike AS callWallStrike, o.call_wall_oi AS callWallOi,
      o.put_wall_strike AS putWallStrike, o.put_wall_oi AS putWallOi,
      (SELECT g.return_pct FROM global_market_daily g WHERE g.symbol='SOX' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS soxReturnPct,
      (SELECT g.trade_date FROM global_market_daily g WHERE g.symbol='SOX' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS soxSourceDate,
      (SELECT g.return_pct FROM global_market_daily g WHERE g.symbol='NDX' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS ndxReturnPct,
      (SELECT g.trade_date FROM global_market_daily g WHERE g.symbol='NDX' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS ndxSourceDate,
      (SELECT g.return_pct FROM global_market_daily g WHERE g.symbol='USDTWD' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS usdtwdReturnPct,
      (SELECT g.trade_date FROM global_market_daily g WHERE g.symbol='USDTWD' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS usdtwdSourceDate,
      (SELECT g.return_pct FROM global_market_daily g WHERE g.symbol='GOLD' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS goldReturnPct,
      (SELECT g.return_pct FROM global_market_daily g WHERE g.symbol='COPPER' AND g.trade_date < m.trade_date ORDER BY g.trade_date DESC LIMIT 1) AS copperFuturesReturnPct,
      (SELECT x.value FROM macro_observations x WHERE x.series_key='VIXCLS' AND x.observation_date < m.trade_date ORDER BY x.observation_date DESC LIMIT 1) AS fredVix,
      (SELECT x.observation_date FROM macro_observations x WHERE x.series_key='VIXCLS' AND x.observation_date < m.trade_date ORDER BY x.observation_date DESC LIMIT 1) AS fredVixSourceDate,
      (SELECT x.value FROM macro_observations x WHERE x.series_key='DGS10' AND x.observation_date < m.trade_date ORDER BY x.observation_date DESC LIMIT 1) AS us10yYield,
      (SELECT x.observation_date FROM macro_observations x WHERE x.series_key='DGS10' AND x.observation_date < m.trade_date ORDER BY x.observation_date DESC LIMIT 1) AS us10ySourceDate
    FROM market_daily m
    LEFT JOIN futures_contract_daily fc ON fc.trade_date=m.trade_date AND fc.product='TX' AND fc.session='一般' AND fc.is_active=1
    LEFT JOIN spot_institutional_daily s USING(trade_date)
    LEFT JOIN futures_positions_daily f USING(trade_date)
    LEFT JOIN futures_oi_daily oi USING(trade_date)
    LEFT JOIN margin_short_daily ms USING(trade_date)
    LEFT JOIN options_contract_daily o ON o.trade_date=m.trade_date AND o.is_active=1
    WHERE m.tx_close IS NOT NULL ORDER BY m.trade_date`).all();
  return raw.map((row, index) => {
    const prior = raw[index - 1]; const prior3 = raw[index - 3]; const prior5 = raw[index - 5]; const next = raw[index + 1];
    const sameContract = Boolean(prior && prior.optionContract === row.optionContract);
    const signedDistance = finite(row.maxPain) ? Number(row.txClose) - Number(row.maxPain) : null;
    const priorDistance = sameContract && finite(prior.maxPain)
      ? Math.abs(Number(prior.txClose) - Number(prior.maxPain)) : null;
    const distance = signedDistance == null ? null : Math.abs(signedDistance);
    const callWallMove1d = sameContract && finite(row.callWallStrike) && finite(prior.callWallStrike) ? Number(row.callWallStrike) - Number(prior.callWallStrike) : null;
    const putWallMove1d = sameContract && finite(row.putWallStrike) && finite(prior.putWallStrike) ? Number(row.putWallStrike) - Number(prior.putWallStrike) : null;
    const callWallOiDelta1d = sameContract && finite(row.callWallOi) && finite(prior.callWallOi) ? Number(row.callWallOi) - Number(prior.callWallOi) : null;
    const putWallOiDelta1d = sameContract && finite(row.putWallOi) && finite(prior.putWallOi) ? Number(row.putWallOi) - Number(prior.putWallOi) : null;
    const callBreakout = sameContract && finite(row.callWallStrike) && finite(prior.callWallStrike)
      ? Number(row.txClose) > Number(row.callWallStrike) && Number(prior.txClose) <= Number(prior.callWallStrike) : false;
    const putBreakdown = sameContract && finite(row.putWallStrike) && finite(prior.putWallStrike)
      ? Number(row.txClose) < Number(row.putWallStrike) && Number(prior.txClose) >= Number(prior.putWallStrike) : false;
    return {
      ...row,
      foreignSpot5d: sumWindow(raw, index, 'foreignSpot', 5),
      foreignSpot3d: sumWindow(raw, index, 'foreignSpot', 3),
      foreignLongDelta1d: prior && finite(row.foreignLong) && finite(prior.foreignLong) ? Number(row.foreignLong) - Number(prior.foreignLong) : null,
      foreignShortDelta1d: prior && finite(row.foreignShort) && finite(prior.foreignShort) ? Number(row.foreignShort) - Number(prior.foreignShort) : null,
      foreignShortDelta3d: prior3 && finite(row.foreignShort) && finite(prior3.foreignShort) ? Number(row.foreignShort) - Number(prior3.foreignShort) : null,
      foreignShortDelta5d: prior5 && finite(row.foreignShort) && finite(prior5.foreignShort) ? Number(row.foreignShort) - Number(prior5.foreignShort) : null,
      foreignFuturesDelta5d: prior5 && finite(row.foreignFutures) && finite(prior5.foreignFutures) ? Number(row.foreignFutures) - Number(prior5.foreignFutures) : null,
      foreignFuturesDelta1d: prior && finite(row.foreignFutures) && finite(prior.foreignFutures) ? Number(row.foreignFutures) - Number(prior.foreignFutures) : null,
      trustFuturesDelta1d: prior && finite(row.trustFutures) && finite(prior.trustFutures) ? Number(row.trustFutures) - Number(prior.trustFutures) : null,
      dealerFuturesDelta1d: prior && finite(row.dealerFutures) && finite(prior.dealerFutures) ? Number(row.dealerFutures) - Number(prior.dealerFutures) : null,
      marketOiDelta1d: cleanOiDelta(raw, index, 1),
      marketOiDelta3d: cleanOiDelta(raw, index, 3),
      marginBalanceDelta1dE: prior && finite(row.marginBalanceE) && finite(prior.marginBalanceE) ? Number(row.marginBalanceE) - Number(prior.marginBalanceE) : null,
      marginBalanceDelta3dE: prior3 && finite(row.marginBalanceE) && finite(prior3.marginBalanceE) ? Number(row.marginBalanceE) - Number(prior3.marginBalanceE) : null,
      marginBalanceDelta5dE: prior5 && finite(row.marginBalanceE) && finite(prior5.marginBalanceE) ? Number(row.marginBalanceE) - Number(prior5.marginBalanceE) : null,
      shortBalanceDelta1dLots: prior && finite(row.shortBalanceLots) && finite(prior.shortBalanceLots) ? Number(row.shortBalanceLots) - Number(prior.shortBalanceLots) : null,
      shortBalanceDelta3dLots: prior3 && finite(row.shortBalanceLots) && finite(prior3.shortBalanceLots) ? Number(row.shortBalanceLots) - Number(prior3.shortBalanceLots) : null,
      txReturn1d: prior && finite(prior.txClose) ? Number(row.txClose) / Number(prior.txClose) - 1 : null,
      txReturn3d: prior3 && finite(prior3.txClose) ? Number(row.txClose) / Number(prior3.txClose) - 1 : null,
      atr20: atrWindow(raw, index, 20),
      maxPainSignedDistance: signedDistance,
      maxPainDistance: distance,
      maxPainDistanceChange: priorDistance == null || distance == null ? null : distance - priorDistance,
      callWallMove1d,
      putWallMove1d,
      callWallOiDelta1d,
      putWallOiDelta1d,
      callWallStableDays: sameWallStreak(raw, index, 'callWallStrike'),
      putWallStableDays: sameWallStreak(raw, index, 'putWallStrike'),
      wallPosition: finite(row.callWallStrike) && Number(row.txClose) > Number(row.callWallStrike) ? 'above_call'
        : finite(row.putWallStrike) && Number(row.txClose) < Number(row.putWallStrike) ? 'below_put'
          : finite(row.callWallStrike) && finite(row.putWallStrike) ? 'inside' : 'unknown',
      callBreakout,
      putBreakdown,
      regime: marketRegime(raw, index),
      nextTradeDate: next?.tradeDate || null,
      nextTxOpen: next?.txOpen ?? null,
      nextTxClose: next?.txClose ?? null,
      futureTradeDate2: raw[index + 2]?.tradeDate || null,
      futureTxClose2: raw[index + 2]?.txClose ?? null,
      futureTradeDate3: raw[index + 3]?.tradeDate || null,
      futureTxClose3: raw[index + 3]?.txClose ?? null,
      futureTradeDate5: raw[index + 5]?.tradeDate || null,
      futureTxClose5: raw[index + 5]?.txClose ?? null,
      nextTxContract: raw[index + 1]?.txContract || null,
      futureTxContract2: raw[index + 2]?.txContract || null,
      futureTxContract3: raw[index + 3]?.txContract || null,
      futureTxContract5: raw[index + 5]?.txContract || null,
      futureBars: raw.slice(index + 1, index + 6).map((future) => ({
        tradeDate: future.tradeDate, txContract: future.txContract, open: future.txOpen,
        high: future.txHigh, low: future.txLow, close: future.txClose,
      })),
      nextReturnPct: next ? (Number(next.txClose) / Number(row.txClose) - 1) * 100 : null,
      priorTxClose: prior?.txClose ?? null,
      sameDayReturnPct: finite(row.txOpen) ? (Number(row.txClose) / Number(row.txOpen) - 1) * 100 : null,
    };
  }).filter((row) => options.includeUnresolved || (row.nextTradeDate && finite(row.nextReturnPct)));
}

function thresholdsFor(strategy, trainingRows, assumptions = {}) {
  const lowQuantile = assumptions.quantileLow ?? 0.30;
  const highQuantile = assumptions.quantileHigh ?? 0.70;
  const features = strategy.mode === 'composite' ? ['foreignSpot5d', 'foreignFuturesDelta5d', 'optionPc'] : strategy.feature ? [strategy.feature] : [];
  return Object.fromEntries(features.map((feature) => {
    const values = trainingRows.map((row) => row[feature]).filter(finite);
    return [feature, { low: quantile(values, lowQuantile), high: quantile(values, highQuantile), samples: values.length }];
  }));
}

function quantileSignal(value, threshold) {
  if (!finite(value) || !finite(threshold?.low) || !finite(threshold?.high)) return 0;
  if (Number(value) >= threshold.high) return 1;
  if (Number(value) <= threshold.low) return -1;
  return 0;
}

function commonNonZeroDirection(values) {
  if (!values.every(finite)) return 0;
  const directions = values.map((value) => Math.sign(Number(value)));
  return directions[0] && directions.every((value) => value === directions[0]) ? directions[0] : 0;
}

export function institutionalAlignmentSignal(row, mode = 'net') {
  const signal = mode === 'net'
    ? commonNonZeroDirection([row.foreignFutures, row.trustFutures, row.dealerFutures])
    : commonNonZeroDirection([row.foreignFuturesDelta1d, row.trustFuturesDelta1d, row.dealerFuturesDelta1d]);
  if (!signal || mode !== 'confirmed') return signal;
  return finite(row.txReturn1d) && Math.sign(Number(row.txReturn1d)) === signal
    && finite(row.marketOiDelta1d) && Number(row.marketOiDelta1d) > 0 ? signal : 0;
}

export function institutionalPairSignal(row, pair = 'foreign_trust') {
  const counterpart = pair === 'foreign_dealer' ? row.dealerFuturesDelta1d : row.trustFuturesDelta1d;
  return commonNonZeroDirection([row.foreignFuturesDelta1d, counterpart]);
}

export function foreignLedConfirmedSignal(row, threshold) {
  const signal = quantileSignal(row.foreignFuturesDelta1d, threshold);
  if (!signal || !finite(row.trustFuturesDelta1d) || Math.sign(Number(row.trustFuturesDelta1d)) === -signal) return 0;
  return finite(row.txReturn1d) && Math.sign(Number(row.txReturn1d)) === signal
    && finite(row.marketOiDelta1d) && Number(row.marketOiDelta1d) > 0 ? signal : 0;
}

function signalFor(strategy, row, thresholds) {
  if (strategy.allowedRegimes?.length && !strategy.allowedRegimes.includes(row.regime)) return 0;
  if (strategy.mode === 'quantile') return quantileSignal(row[strategy.feature], thresholds[strategy.feature]) * (strategy.direction || 1);
  if (strategy.mode === 'max_pain') {
    if (!finite(row.maxPainDistanceChange) || Number(row.maxPainDistanceChange) >= 0 || Number(row.daysToExpiry) > 5 || !finite(row.maxPainSignedDistance)) return 0;
    return Number(row.maxPainSignedDistance) > 0 ? -1 : Number(row.maxPainSignedDistance) < 0 ? 1 : 0;
  }
  if (strategy.mode === 'max_pain_strict') {
    if (!finite(row.maxPainDistanceChange) || Number(row.maxPainDistanceChange) >= 0
      || !finite(row.daysToExpiry) || Number(row.daysToExpiry) < 1 || Number(row.daysToExpiry) > 3
      || !finite(row.maxPainDistance) || !finite(row.atr20) || Number(row.maxPainDistance) > Number(row.atr20)
      || !finite(row.maxPainSignedDistance)) return 0;
    return Number(row.maxPainSignedDistance) > 0 ? -1 : Number(row.maxPainSignedDistance) < 0 ? 1 : 0;
  }
  if (strategy.mode === 'futures_price_oi') {
    const positionSignal = quantileSignal(row[strategy.feature], thresholds[strategy.feature]);
    if (!positionSignal || !finite(row.txReturn1d) || !finite(row.marketOiDelta1d) || Number(row.marketOiDelta1d) <= 0) return 0;
    return Math.sign(Number(row.txReturn1d)) === positionSignal ? positionSignal : 0;
  }
  if (strategy.mode === 'price_continuation') return finite(row.txReturn1d) ? Math.sign(Number(row.txReturn1d)) : 0;
  if (strategy.mode === 'price_oi') {
    return finite(row.txReturn1d) && finite(row.marketOiDelta1d) && Number(row.marketOiDelta1d) > 0
      ? Math.sign(Number(row.txReturn1d)) : 0;
  }
  if (strategy.mode === 'price_oi_reversal') {
    return finite(row.txReturn1d) && finite(row.marketOiDelta1d) && Number(row.marketOiDelta1d) > 0
      ? -Math.sign(Number(row.txReturn1d)) : 0;
  }
  if (strategy.mode === 'futures_price') {
    const positionSignal = quantileSignal(row[strategy.feature], thresholds[strategy.feature]);
    return positionSignal && finite(row.txReturn1d) && Math.sign(Number(row.txReturn1d)) === positionSignal ? positionSignal : 0;
  }
  if (strategy.mode === 'foreign_short_add') {
    const threshold = thresholds[strategy.feature];
    return finite(row[strategy.feature]) && finite(threshold?.high) && Number(row[strategy.feature]) >= Number(threshold.high) ? -1 : 0;
  }
  if (strategy.mode === 'foreign_short_add_reversal') {
    const threshold = thresholds[strategy.feature];
    return finite(row[strategy.feature]) && finite(threshold?.high) && Number(row[strategy.feature]) >= Number(threshold.high) ? 1 : 0;
  }
  if (strategy.mode === 'foreign_short_no_drop') {
    const threshold = thresholds[strategy.feature];
    return finite(row[strategy.feature]) && finite(threshold?.high) && Number(row[strategy.feature]) >= Number(threshold.high)
      && finite(row.marketOiDelta3d) && Number(row.marketOiDelta3d) > 0
      && finite(row.txReturn3d) && Number(row.txReturn3d) >= 0 ? -1 : 0;
  }
  if (strategy.mode === 'institutional_net_alignment') return institutionalAlignmentSignal(row, 'net');
  if (strategy.mode === 'institutional_delta_alignment') return institutionalAlignmentSignal(row, 'delta');
  if (strategy.mode === 'institutional_delta_confirmed') return institutionalAlignmentSignal(row, 'confirmed');
  if (strategy.mode === 'institutional_pair_delta') return institutionalPairSignal(row, strategy.pair);
  if (strategy.mode === 'foreign_led_confirmed') return foreignLedConfirmedSignal(row, thresholds[strategy.feature]);
  if (strategy.mode === 'wall_migration') {
    if (!finite(row.callWallMove1d) || !finite(row.putWallMove1d)) return 0;
    if (Number(row.callWallMove1d) > 0 && Number(row.putWallMove1d) > 0) return 1;
    if (Number(row.callWallMove1d) < 0 && Number(row.putWallMove1d) < 0) return -1;
    return 0;
  }
  if (strategy.mode === 'wall_breakout_oi') {
    if (row.callBreakout && ((finite(row.callWallOiDelta1d) && Number(row.callWallOiDelta1d) < 0) || (finite(row.callWallMove1d) && Number(row.callWallMove1d) > 0))) return 1;
    if (row.putBreakdown && ((finite(row.putWallOiDelta1d) && Number(row.putWallOiDelta1d) < 0) || (finite(row.putWallMove1d) && Number(row.putWallMove1d) < 0))) return -1;
    return 0;
  }
  if (strategy.mode === 'global_context') {
    const votes = [
      finite(row.soxReturnPct) ? Math.sign(Number(row.soxReturnPct)) : 0,
      finite(row.ndxReturnPct) ? Math.sign(Number(row.ndxReturnPct)) : 0,
      finite(row.usdtwdReturnPct) ? -Math.sign(Number(row.usdtwdReturnPct)) : 0,
    ];
    const total = votes.reduce((sum, value) => sum + value, 0);
    return Math.abs(total) >= 2 ? Math.sign(total) : 0;
  }
  const votes = [
    quantileSignal(row.foreignSpot5d, thresholds.foreignSpot5d),
    quantileSignal(row.foreignFuturesDelta5d, thresholds.foreignFuturesDelta5d),
    quantileSignal(row.optionPc, thresholds.optionPc),
  ];
  const total = votes.reduce((sum, value) => sum + value, 0);
  const signal = Math.abs(total) >= 2 ? Math.sign(total) : 0;
  if (strategy.signalSide === 'long') return signal > 0 ? signal : 0;
  if (strategy.signalSide === 'short') return signal < 0 ? signal : 0;
  return signal;
}

export function calculateMetrics(trades) {
  const active = trades.filter((trade) => trade.signal !== 0);
  let equity = 0; let peak = 0; let maxDrawdown = 0;
  for (const trade of active) { equity += trade.netPoints; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const gains = active.filter((trade) => trade.netPoints > 0).reduce((sum, trade) => sum + trade.netPoints, 0);
  const losses = Math.abs(active.filter((trade) => trade.netPoints < 0).reduce((sum, trade) => sum + trade.netPoints, 0));
  const returns = active.map((trade) => trade.netReturnPct);
  const average = mean(returns); const deviation = stddev(returns);
  const mae = active.map((trade) => Number(trade.maePoints)).filter(Number.isFinite);
  const mfe = active.map((trade) => Number(trade.mfePoints)).filter(Number.isFinite);
  const excursionRatios = active.map((trade) => Number(trade.maePoints) < 0 ? Number(trade.mfePoints) / Math.abs(Number(trade.maePoints)) : null).filter(Number.isFinite);
  return {
    evaluatedDays: trades.length,
    trades: active.length,
    exposurePct: trades.length ? active.length / trades.length * 100 : 0,
    winRatePct: active.length ? active.filter((trade) => trade.netPoints > 0).length / active.length * 100 : null,
    averageNetPoints: active.length ? mean(active.map((trade) => trade.netPoints)) : null,
    totalNetPoints: active.reduce((sum, trade) => sum + trade.netPoints, 0),
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? null : 0,
    maxDrawdownPoints: maxDrawdown,
    sharpe: deviation && average != null ? average / deviation * Math.sqrt(252) : null,
    averageMaePoints: mae.length ? mean(mae) : null,
    mae10PctPoints: mae.length ? quantile(mae, 0.10) : null,
    worstMaePoints: mae.length ? Math.min(...mae) : null,
    averageMfePoints: mfe.length ? mean(mfe) : null,
    mfe90PctPoints: mfe.length ? quantile(mfe, 0.90) : null,
    averageMfeMaeRatio: excursionRatios.length ? mean(excursionRatios) : null,
  };
}

export function enforceNonOverlappingTrades(trades) {
  let occupiedThrough = null;
  return trades.map((trade) => {
    if (trade.signal === 0) return trade;
    const entryTradeDate = trade.entryTradeDate || trade.tradeDate;
    if (occupiedThrough && entryTradeDate <= occupiedThrough) {
      return { ...trade, signal: 0, grossPoints: 0, costPoints: 0, netPoints: 0, netReturnPct: 0, overlapSuppressed: true };
    }
    occupiedThrough = trade.targetTradeDate || entryTradeDate;
    return { ...trade, overlapSuppressed: false };
  });
}

function fallbackFuturePath(row, holdingDays) {
  return Array.from({ length: holdingDays }, (_, offset) => {
    const day = offset + 1; const close = day === 1 ? row.nextTxClose : row[`futureTxClose${day}`];
    return { tradeDate: day === 1 ? row.nextTradeDate : row[`futureTradeDate${day}`], txContract: day === 1 ? row.nextTxContract : row[`futureTxContract${day}`], open: day === 1 ? row.nextTxOpen : null, high: close, low: close, close };
  });
}

function outcomeFor(strategy, row) {
  if (strategy.target === 'same_day') {
    if (!finite(row.txOpen) || !finite(row.txClose)) return null;
    return { entryClose: Number(row.txOpen), exitClose: Number(row.txClose), entryTradeDate: row.tradeDate, targetTradeDate: row.tradeDate,
      entryContract: row.txContract || null, targetContract: row.txContract || null,
      pathHigh: finite(row.txHigh) ? Number(row.txHigh) : Number(row.txClose), pathLow: finite(row.txLow) ? Number(row.txLow) : Number(row.txClose), contractConsistent: true };
  }
  if (strategy.target === 'next_open_to_close') {
    const holdingDays = strategy.holdingDays || 1;
    const path = Array.isArray(row.futureBars) && row.futureBars.length >= holdingDays ? row.futureBars.slice(0, holdingDays) : fallbackFuturePath(row, holdingDays);
    const entryContract = path[0]?.txContract || null; const contracts = path.map((bar) => bar.txContract).filter(Boolean);
    if (entryContract && contracts.some((contract) => contract !== entryContract)) return null;
    const exit = path.at(-1); const highs = path.map((bar) => Number(bar.high)).filter(Number.isFinite); const lows = path.map((bar) => Number(bar.low)).filter(Number.isFinite);
    if (!finite(row.nextTxOpen) || !finite(exit?.close) || !exit?.tradeDate || highs.length !== holdingDays || lows.length !== holdingDays) return null;
    return { entryClose: Number(row.nextTxOpen), exitClose: Number(exit.close), entryTradeDate: row.nextTradeDate, targetTradeDate: exit.tradeDate,
      entryContract, targetContract: exit.txContract || entryContract, pathHigh: Math.max(...highs), pathLow: Math.min(...lows), contractConsistent: true };
  }
  if (!finite(row.txClose) || !finite(row.nextTxClose)) return null;
  if (row.txContract && row.nextTxContract && row.txContract !== row.nextTxContract) return null;
  return { entryClose: Number(row.txClose), exitClose: Number(row.nextTxClose), entryTradeDate: row.tradeDate, targetTradeDate: row.nextTradeDate,
    entryContract: row.txContract || null, targetContract: row.nextTxContract || row.txContract || null,
    pathHigh: finite(row.futureBars?.[0]?.high) ? Number(row.futureBars[0].high) : Number(row.nextTxClose),
    pathLow: finite(row.futureBars?.[0]?.low) ? Number(row.futureBars[0].low) : Number(row.nextTxClose), contractConsistent: true };
}

function excursionsFor(signal, outcome) {
  if (!outcome || signal === 0 || !finite(outcome.pathHigh) || !finite(outcome.pathLow)) return { maePoints: null, mfePoints: null };
  if (signal > 0) return { maePoints: Math.min(0, Number(outcome.pathLow) - Number(outcome.entryClose)), mfePoints: Math.max(0, Number(outcome.pathHigh) - Number(outcome.entryClose)) };
  return { maePoints: Math.min(0, Number(outcome.entryClose) - Number(outcome.pathHigh)), mfePoints: Math.max(0, Number(outcome.entryClose) - Number(outcome.pathLow)) };
}

function tradeCostFor(signal, outcome, assumptions) {
  if (!signal || !outcome) return { costPoints: 0, costBreakdown: null };
  if (!assumptions.costModel?.instrument) {
    return { costPoints: assumptions.costPoints ?? 8, costBreakdown: { kind: 'legacy_fixed_points' } };
  }
  const costBreakdown = calculateFuturesRoundTripCost({
    instrument: assumptions.costModel.instrument,
    entryPrice: outcome.entryClose,
    exitPrice: outcome.exitClose,
    commissionPerSide: assumptions.costModel.commissionPerSide,
    slippagePointsRoundTrip: assumptions.costModel.slippagePointsRoundTrip ?? 2,
  });
  return { costPoints: costBreakdown.totalPoints, costBreakdown };
}

export function walkForward(rows, strategy, assumptions = {}) {
  const minTrainDays = assumptions.minTrainDays ?? 100; const testWindowDays = assumptions.testWindowDays ?? 20; const costPoints = assumptions.costPoints ?? 8;
  const folds = []; const daily = []; let occupiedThrough = null;
  for (let testStart = minTrainDays, foldIndex = 0; testStart < rows.length; testStart += testWindowDays, foldIndex += 1) {
    const training = rows.slice(0, testStart); const testing = rows.slice(testStart, Math.min(rows.length, testStart + testWindowDays));
    if (!testing.length) break;
    const thresholds = thresholdsFor(strategy, training, assumptions);
    const outcomeBoundary = rows.at(-1)?.tradeDate;
    const candidateTrades = testing.map((row) => {
      const candidateOutcome = outcomeFor(strategy, row);
      const outcome = candidateOutcome && candidateOutcome.targetTradeDate <= outcomeBoundary ? candidateOutcome : null;
      const signal = outcome ? signalFor(strategy, row, thresholds) : 0;
      const excursions = excursionsFor(signal, outcome);
      const grossPoints = outcome ? signal * (outcome.exitClose - outcome.entryClose) : 0;
      const cost = tradeCostFor(signal, outcome, assumptions); const netPoints = grossPoints - cost.costPoints;
      return { ...row, ...outcome, ...excursions, foldIndex, signal, grossPoints, costPoints: cost.costPoints, costBreakdown: cost.costBreakdown, netPoints, netReturnPct: outcome ? netPoints / outcome.entryClose * 100 : 0 };
    });
    const trades = candidateTrades.map((trade) => {
      if (trade.signal === 0) return trade;
      if (occupiedThrough && trade.entryTradeDate <= occupiedThrough) {
        return { ...trade, signal: 0, grossPoints: 0, costPoints: 0, netPoints: 0, netReturnPct: 0, overlapSuppressed: true };
      }
      occupiedThrough = trade.targetTradeDate || trade.entryTradeDate;
      return { ...trade, overlapSuppressed: false };
    });
    daily.push(...trades);
    folds.push({ foldIndex, trainStart: training[0].tradeDate, trainEnd: training.at(-1).tradeDate, testStart: testing[0].tradeDate, testEnd: testing.at(-1).tradeDate, thresholds, metrics: calculateMetrics(trades) });
  }
  const byRegime = Object.fromEntries(['bull', 'bear', 'range', 'high_vol', 'insufficient'].map((regime) => [regime, calculateMetrics(daily.filter((row) => row.regime === regime))]));
  const holdingPeriod = strategy.target === 'same_day' ? 'current_taiwan_open_to_current_taiwan_close'
    : strategy.target === 'next_open_to_close' ? `next_taiwan_open_to_${strategy.holdingDays || 1}_day_close`
      : 'current_close_to_next_close';
  return { strategy, assumptions: { minTrainDays, testWindowDays, costPoints, costModel: assumptions.costModel || null, quantileLow: assumptions.quantileLow ?? 0.30, quantileHigh: assumptions.quantileHigh ?? 0.70, holdingPeriod, executionModelVersion: assumptions.executionModelVersion || '3.0.0-contract-tax-commission-slippage', dataAvailableAt: strategy.target === 'same_day' ? 'before_current_taiwan_open' : 'after_current_close' }, folds, daily, metrics: calculateMetrics(daily), byRegime };
}

export function evaluateHoldout(rows, strategy, assumptions = {}) {
  const holdoutPct = assumptions.holdoutPct ?? 0.20;
  const minTrainDays = assumptions.minTrainDays ?? 100;
  const costPoints = assumptions.costPoints ?? 8;
  const splitIndex = Math.max(minTrainDays, Math.floor(rows.length * (1 - holdoutPct)));
  const training = rows.slice(0, splitIndex);
  const testing = rows.slice(splitIndex);
  if (!training.length || !testing.length) return { available: false, trainingDays: training.length, holdoutDays: testing.length, daily: [], metrics: calculateMetrics([]) };
  const thresholds = thresholdsFor(strategy, training, assumptions);
  const candidateDaily = testing.map((row) => {
    const candidateOutcome = outcomeFor(strategy, row);
    const outcome = candidateOutcome && candidateOutcome.targetTradeDate <= rows.at(-1).tradeDate ? candidateOutcome : null;
    const signal = outcome ? signalFor(strategy, row, thresholds) : 0;
    const excursions = excursionsFor(signal, outcome);
    const grossPoints = outcome ? signal * (outcome.exitClose - outcome.entryClose) : 0;
    const cost = tradeCostFor(signal, outcome, assumptions);
    const netPoints = grossPoints - cost.costPoints;
    return { ...row, ...outcome, ...excursions, foldIndex: -1, signal, grossPoints, costPoints: cost.costPoints, costBreakdown: cost.costBreakdown, netPoints, netReturnPct: outcome ? netPoints / outcome.entryClose * 100 : 0 };
  });
  const daily = enforceNonOverlappingTrades(candidateDaily);
  return {
    available: true,
    trainStart: training[0].tradeDate,
    trainEnd: training.at(-1).tradeDate,
    testStart: testing[0].tradeDate,
    testEnd: testing.at(-1).tradeDate,
    trainingDays: training.length,
    holdoutDays: testing.length,
    thresholds,
    daily,
    metrics: calculateMetrics(daily),
    byRegime: Object.fromEntries(['bull', 'bear', 'range', 'high_vol', 'insufficient'].map((regime) => [regime, calculateMetrics(daily.filter((row) => row.regime === regime))])),
  };
}

export function runAllStrategies(rows, assumptions = {}) {
  return STRATEGIES.map((strategy) => walkForward(rows, strategy, assumptions));
}

function diagnosticGroup(rows, predicate, direction = 0) {
  const selected = rows.filter(predicate);
  const nextPoints = selected.map((row) => Number(row.nextTxClose) - Number(row.txClose)).filter(Number.isFinite);
  const correct = direction === 0 ? null : nextPoints.filter((value) => Math.sign(value) === direction).length;
  return {
    samples: nextPoints.length,
    averageNextPoints: mean(nextPoints),
    directionHitPct: direction && nextPoints.length ? correct / nextPoints.length * 100 : null,
    averageAbsoluteMove: mean(nextPoints.map(Math.abs)),
  };
}

export function analyzeOptionWalls(rows) {
  return {
    disclaimer: '公開OI無法辨認買賣方；以下只檢驗牆位結構與下一交易日收盤變化，不代表壓力支撐必然有效。',
    migration: {
      bothUp: diagnosticGroup(rows, (row) => Number(row.callWallMove1d) > 0 && Number(row.putWallMove1d) > 0, 1),
      bothDown: diagnosticGroup(rows, (row) => Number(row.callWallMove1d) < 0 && Number(row.putWallMove1d) < 0, -1),
      mixed: diagnosticGroup(rows, (row) => finite(row.callWallMove1d) && finite(row.putWallMove1d) && Math.sign(Number(row.callWallMove1d)) !== Math.sign(Number(row.putWallMove1d))),
    },
    stability: {
      bothStable3Days: diagnosticGroup(rows, (row) => Number(row.callWallStableDays) >= 3 && Number(row.putWallStableDays) >= 3),
      moving: diagnosticGroup(rows, (row) => Number(row.callWallStableDays) < 3 || Number(row.putWallStableDays) < 3),
    },
    breakout: {
      aboveCall: diagnosticGroup(rows, (row) => row.callBreakout, 1),
      aboveCallWithOiWeakening: diagnosticGroup(rows, (row) => row.callBreakout && Number(row.callWallOiDelta1d) < 0, 1),
      belowPut: diagnosticGroup(rows, (row) => row.putBreakdown, -1),
      belowPutWithOiWeakening: diagnosticGroup(rows, (row) => row.putBreakdown && Number(row.putWallOiDelta1d) < 0, -1),
    },
  };
}

function correlation(rows, feature, target = 'sameDayReturnPct') {
  const pairs = rows.map((row) => [Number(row[feature]), Number(row[target])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return { samples: pairs.length, pearson: null };
  const xs = pairs.map(([x]) => x); const ys = pairs.map(([, y]) => y); const mx = mean(xs); const my = mean(ys);
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const denominator = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0) * ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return { samples: pairs.length, pearson: denominator ? numerator / denominator : null };
}

export function analyzeGlobalContext(rows) {
  const directional = (feature, inverse = false) => {
    const selected = rows.filter((row) => finite(row[feature]) && finite(row.sameDayReturnPct));
    const hits = selected.filter((row) => Math.sign(Number(row.sameDayReturnPct)) === Math.sign(Number(row[feature])) * (inverse ? -1 : 1)).length;
    return { ...correlation(rows, feature), directionHitPct: selected.length ? hits / selected.length * 100 : null };
  };
  return {
    timing: '每個台灣交易日只使用日期早於該日的最近一筆海外收盤；研究目標為該台指期日盤開盤到收盤。',
    sox: directional('soxReturnPct'),
    ndx: directional('ndxReturnPct'),
    usdtwd: directional('usdtwdReturnPct', true),
  };
}

export function strategyDefinitions() { return STRATEGIES.map((item) => ({ ...item })); }
