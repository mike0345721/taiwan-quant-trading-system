import fs from 'node:fs';

const ALLOWED_SOURCES = new Set(['licensed_vendor', 'broker_market_data', 'historical_replay', 'mock']);
function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function median(values) { const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return null; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }

export function validateFiveMinutePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['payload_required'] };
  if (!ALLOWED_SOURCES.has(payload.source)) errors.push('source_not_allowed');
  if (payload.timeframe !== '5m') errors.push('timeframe_must_be_5m');
  if (payload.product !== 'TX') errors.push('product_must_be_TX');
  if (!['day', 'night'].includes(payload.session)) errors.push('session_invalid');
  if (!Array.isArray(payload.bars)) errors.push('bars_required');
  const bars = Array.isArray(payload.bars) ? payload.bars : [];
  let previousTime = Number.NEGATIVE_INFINITY;
  bars.forEach((bar, index) => {
    const timestamp = Date.parse(bar?.timestamp);
    if (!bar?.timestamp || Number.isNaN(timestamp)) errors.push(`bar_${index}_timestamp_invalid`);
    for (const key of ['open', 'high', 'low', 'close', 'volume']) if (!finite(bar?.[key])) errors.push(`bar_${index}_${key}_invalid`);
    if (finite(bar?.volume) && Number(bar.volume) < 0) errors.push(`bar_${index}_volume_negative`);
    if (finite(bar?.high) && finite(bar?.low) && Number(bar.high) < Number(bar.low)) errors.push(`bar_${index}_range_invalid`);
    if (['open', 'close'].every((key) => finite(bar?.[key])) && finite(bar?.high) && finite(bar?.low)) {
      if (Number(bar.open) > Number(bar.high) || Number(bar.open) < Number(bar.low)) errors.push(`bar_${index}_open_out_of_range`);
      if (Number(bar.close) > Number(bar.high) || Number(bar.close) < Number(bar.low)) errors.push(`bar_${index}_close_out_of_range`);
    }
    if (!Number.isNaN(timestamp) && timestamp <= previousTime) errors.push(`bar_${index}_not_in_order`);
    if (!Number.isNaN(timestamp)) previousTime = timestamp;
  });
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function calculatePriceConfirmation(payload, now = new Date()) {
  const validation = validateFiveMinutePayload(payload);
  if (!validation.ok) return { available: false, ready: false, state: 'invalid', reasons: validation.errors, executionAuthorized: false };
  if (payload.source === 'mock') return { available: true, ready: false, state: 'mock_only', reasons: ['模擬資料不能用於正式價格確認'], executionAuthorized: false };
  const bars = payload.bars.filter((bar) => bar.complete !== false);
  if (bars.length < 6) return { available: true, ready: false, state: 'insufficient_bars', reasons: ['至少需要 6 根完整的 5 分鐘 K 棒'], executionAuthorized: false };
  const last = bars.at(-1);
  const ageMinutes = (now.getTime() - Date.parse(last.timestamp)) / 60_000;
  if (ageMinutes < -1 || ageMinutes > 10) return { available: true, ready: false, state: 'stale', reasons: [`最新 K 棒距現在約 ${Math.round(ageMinutes)} 分鐘，暫停價格確認`], executionAuthorized: false };
  const totalVolume = bars.reduce((sum, bar) => sum + Number(bar.volume), 0);
  const vwap = totalVolume > 0 ? bars.reduce((sum, bar) => sum + ((Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3) * Number(bar.volume), 0) / totalVolume : null;
  const openingBars = bars.slice(0, 3);
  const openingRangeHigh = Math.max(...openingBars.map((bar) => Number(bar.high)));
  const openingRangeLow = Math.min(...openingBars.map((bar) => Number(bar.low)));
  const baselineVolume = median(bars.slice(-6, -1).map((bar) => bar.volume));
  const volumeRatio = baselineVolume ? Number(last.volume) / baselineVolume : null;
  const aboveVwap = finite(vwap) && Number(last.close) > vwap;
  const belowVwap = finite(vwap) && Number(last.close) < vwap;
  const breakoutLong = Number(last.close) > openingRangeHigh && aboveVwap && finite(volumeRatio) && volumeRatio >= 1.2;
  const breakoutShort = Number(last.close) < openingRangeLow && belowVwap && finite(volumeRatio) && volumeRatio >= 1.2;
  const direction = breakoutLong ? 'long_confirmed' : breakoutShort ? 'short_confirmed' : aboveVwap ? 'above_vwap_wait' : belowVwap ? 'below_vwap_wait' : 'neutral_wait';
  return {
    available: true, ready: true, state: direction, direction,
    mode: payload.source === 'historical_replay' ? 'replay' : 'live', researchOnly: payload.source === 'historical_replay',
    lastTimestamp: last.timestamp, lastClose: Number(last.close), vwap, openingRangeHigh, openingRangeLow, volumeRatio, bars: bars.length,
    reasons: breakoutLong ? ['突破開盤 15 分鐘區間上緣、站上 VWAP，且量比至少 1.2'] : breakoutShort ? ['跌破開盤 15 分鐘區間下緣、跌破 VWAP，且量比至少 1.2'] : ['尚未同時滿足開盤區間、VWAP 與成交量確認'],
    executionAuthorized: false,
  };
}

export function buildReplayFrame(payload, cursor) {
  const validation = validateFiveMinutePayload(payload);
  if (!validation.ok) return { available: false, ready: false, state: 'invalid', reasons: validation.errors, executionAuthorized: false };
  const totalBars = payload.bars.length;
  const requested = Number.parseInt(cursor, 10);
  const visibleBars = Math.max(1, Math.min(totalBars, Number.isFinite(requested) ? requested : totalBars));
  const bars = payload.bars.slice(0, visibleBars);
  const replayPayload = { ...payload, source: 'historical_replay', bars };
  const virtualNow = bars.at(-1)?.timestamp ? new Date(bars.at(-1).timestamp) : new Date(0);
  const confirmation = calculatePriceConfirmation(replayPayload, virtualNow);
  // Even before six bars exist, show honest replay observations (last price,
  // approximate VWAP and the still-forming opening range).  These values are
  // descriptive only; `ready` remains false until the confirmation rules have
  // enough complete bars.
  const last = bars.at(-1);
  const totalVolume = bars.reduce((sum, bar) => sum + Number(bar.volume), 0);
  const descriptiveVwap = totalVolume > 0
    ? bars.reduce((sum, bar) => sum + ((Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3) * Number(bar.volume), 0) / totalVolume
    : null;
  const openingBars = bars.slice(0, Math.min(3, bars.length));
  return {
    ...confirmation,
    lastTimestamp: confirmation.lastTimestamp ?? last?.timestamp ?? null,
    lastClose: confirmation.lastClose ?? (finite(last?.close) ? Number(last.close) : null),
    vwap: confirmation.vwap ?? descriptiveVwap,
    openingRangeHigh: confirmation.openingRangeHigh ?? (openingBars.length ? Math.max(...openingBars.map((bar) => Number(bar.high))) : null),
    openingRangeLow: confirmation.openingRangeLow ?? (openingBars.length ? Math.min(...openingBars.map((bar) => Number(bar.low))) : null),
    source: 'historical_replay', cursor: visibleBars, totalBars,
    hasPrevious: visibleBars > 1, hasNext: visibleBars < totalBars, bars,
    executionAuthorized: false,
  };
}

export function loadReplayFrame(filePath, cursor) {
  if (!fs.existsSync(filePath)) return { available: false, ready: false, state: 'replay_not_imported', reasons: ['尚未匯入歷史 5 分鐘 K 棒'], cursor: 0, totalBars: 0, bars: [], executionAuthorized: false };
  try { return buildReplayFrame(JSON.parse(fs.readFileSync(filePath, 'utf8')), cursor); }
  catch { return { available: false, ready: false, state: 'replay_read_failed', reasons: ['歷史 5 分鐘 K 棒讀取失敗'], cursor: 0, totalBars: 0, bars: [], executionAuthorized: false }; }
}

export function loadPriceConfirmation(filePath, now = new Date()) {
  if (!fs.existsSync(filePath)) return { available: false, ready: false, state: 'not_connected', reasons: ['尚未連接 5 分鐘行情資料'], executionAuthorized: false };
  try { return calculatePriceConfirmation(JSON.parse(fs.readFileSync(filePath, 'utf8')), now); }
  catch { return { available: false, ready: false, state: 'read_failed', reasons: ['5 分鐘行情資料讀取失敗'], executionAuthorized: false }; }
}
