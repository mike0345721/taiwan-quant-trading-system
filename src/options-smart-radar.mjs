const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 1) => value == null ? null : Number(value.toFixed(digits));

function component(key, label, value, weight, available, explanation) {
  return { key, label, value: available ? round(clamp(value), 1) : null, weight, available, explanation };
}

function sideRadar(row, side, context) {
  const prefix = side === 'call' ? 'call' : 'put';
  const label = side === 'call' ? 'Call' : 'Put';
  const volume = finite(row[`${prefix}Volume`]);
  const volumeMa20 = finite(row[`${prefix}VolumeMa20`]);
  const volumeSampleDays = finite(row[`${prefix}VolumeSampleDays`]);
  const oi = finite(row[`${prefix}Oi`]);
  const oiDelta = finite(row[`${prefix}OiDelta1d`]);
  const premium = finite(row[`${prefix}Close`]);
  const previousPremium = finite(row[`${prefix}PreviousClose`]);
  const volumeRatio = volumeMa20 != null && volume != null && volumeSampleDays >= 5 ? volume / Math.max(volumeMa20, 20) : null;
  const previousOi = oi != null && oiDelta != null ? oi - oiDelta : null;
  const oiDeltaPct = previousOi > 0 && oiDelta != null ? oiDelta / previousOi : null;
  const premiumChangePct = previousPremium > 0 && premium != null ? (premium - previousPremium) / previousPremium : null;
  const ivChange = finite(context.atmIvChange1d);
  const underlying = finite(context.underlying);
  const distancePct = underlying > 0 ? Math.abs(Number(row.strike) - underlying) / underlying : null;
  const days = finite(context.daysToExpiry);

  const components = [
    component('volume_burst', '成交量相對20日', volumeRatio == null ? 0
      : clamp((volumeRatio - 1) / 2, 0, 1) * clamp((volume || 0) / 500, 0, 1) * 100, 30,
      volumeRatio != null, volumeRatio == null ? '至少需要5個同契約同履約價歷史日' : `${label}成交量為穩健基準的${round(volumeRatio, 2)}倍，絕對量${volume}口`),
    component('oi_build', 'OI單日異動', oiDeltaPct == null ? 0
      : clamp(Math.abs(oiDeltaPct) / 0.5, 0, 1) * clamp(Math.abs(oiDelta || 0) / 500, 0, 1) * 100, 25,
      oiDeltaPct != null, oiDeltaPct == null ? '缺少前一交易日同契約OI' : `${label} OI單日${oiDelta >= 0 ? '增加' : '減少'}${round(Math.abs(oiDeltaPct) * 100, 1)}%`),
    component('premium_move', '權利金變化', premiumChangePct == null ? 0 : Math.abs(premiumChangePct) / 0.5 * 100, 20,
      premiumChangePct != null, premiumChangePct == null ? '缺少前一交易日收盤權利金' : `${label}權利金單日${premiumChangePct >= 0 ? '上升' : '下降'}${round(Math.abs(premiumChangePct) * 100, 1)}%`),
    component('iv_change', 'ATM IV變化', ivChange == null ? 0 : Math.abs(ivChange) / 0.08 * 100, 15,
      ivChange != null, ivChange == null ? '缺少可比較ATM IV' : `契約ATM IV單日變化${round(ivChange * 100, 2)}個百分點`),
    component('expiry_sensitivity', '到期／價位敏感度', distancePct == null || days == null ? 0
      : (clamp(1 - distancePct / 0.03, 0, 1) * 0.65 + clamp((7 - days) / 7, 0, 1) * 0.35) * 100,
    10, distancePct != null && days != null,
    distancePct == null || days == null ? '缺少標的或到期資訊' : `距標的${round(distancePct * 100, 2)}%，剩${days}天`),
  ];
  const availableWeight = components.filter((item) => item.available).reduce((sum, item) => sum + item.weight, 0);
  const weighted = components.filter((item) => item.available)
    .reduce((sum, item) => sum + item.value * item.weight, 0);
  const score = availableWeight ? round(weighted / availableWeight, 0) : null;
  const tags = [];
  if (volumeRatio >= 2) tags.push(`${label}爆量`);
  if (oiDeltaPct != null && oiDeltaPct >= 0.25 && Math.abs(oiDelta) >= 500) tags.push('OI明顯增加');
  if (oiDeltaPct != null && oiDeltaPct <= -0.25 && Math.abs(oiDelta) >= 500) tags.push('OI明顯減少');
  if (premiumChangePct != null && premiumChangePct >= 0.4) tags.push('權利金急升');
  if (premiumChangePct != null && premiumChangePct <= -0.4) tags.push('權利金急跌');
  if (ivChange != null && ivChange >= 0.04) tags.push('IV升溫');
  if (days != null && days <= 2) tags.push('Theta／Gamma敏感');

  let activity = '一般';
  if (score >= 80) activity = '極端異常';
  else if (score >= 65) activity = '高度異常';
  else if (score >= 45) activity = '值得注意';
  const interpretation = oiDelta > 0 && premiumChangePct > 0
    ? 'OI與權利金同步上升，但公開資料無法分辨買方或賣方發起。'
    : oiDelta < 0 && premiumChangePct > 0
      ? '權利金上升但OI下降，可能含平倉或回補，不能視為新方向單。'
      : volumeRatio >= 2
        ? '成交明顯放大，仍需Bid／Ask成交方向與標的價格確認。'
        : '尚未形成多項同步異常。';
  return {
    side, strike: finite(row.strike), score, activity, tags, volume, volumeMa20: round(volumeMa20, 1),
    volumeRatio: round(volumeRatio, 2), volumeSampleDays, oi, oiDelta, oiDeltaPct: round(oiDeltaPct, 4), premium,
    previousPremium, premiumChangePct: round(premiumChangePct, 4), components,
    dataCoveragePct: round(availableWeight, 0), interpretation,
  };
}

function heatScore(rows) {
  const scores = rows.map((row) => row.score).filter(Number.isFinite).sort((a, b) => b - a).slice(0, 5);
  return scores.length ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 0) : null;
}

export function buildOptionsSmartRadar({ selected, strikes = [], volatility = null, previousVolatility = null, underlying = null, live = null } = {}) {
  if (!selected || !strikes.length) {
    return { available: false, state: 'insufficient_data', reason: '沒有可用的契約或履約價資料', liveConnected: false };
  }
  const atmIv = finite(volatility?.atmIv);
  const previousAtmIv = finite(previousVolatility?.atmIv);
  const context = {
    underlying: finite(underlying) ?? finite(volatility?.underlyingClose),
    daysToExpiry: finite(selected.daysToExpiry),
    atmIvChange1d: atmIv != null && previousAtmIv != null ? atmIv - previousAtmIv : null,
  };
  const calls = strikes.map((row) => sideRadar(row, 'call', context)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const puts = strikes.map((row) => sideRadar(row, 'put', context)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const callHeat = heatScore(calls); const putHeat = heatScore(puts);
  const difference = callHeat != null && putHeat != null ? callHeat - putHeat : null;
  const focus = difference == null || Math.abs(difference) < 8 ? '雙側接近' : difference > 0 ? 'Call側異常較強' : 'Put側異常較強';
  const liveConnected = Boolean(live?.connected && live?.bidAsk && live?.greeks);
  return {
    available: true,
    version: 'options-smart-radar-1.0.0-eod',
    generatedAt: new Date().toISOString(),
    tradeDate: selected.tradeDate,
    contract: selected.contract,
    contractType: selected.contractType,
    daysToExpiry: selected.daysToExpiry,
    updateMode: liveConnected ? 'live' : 'end_of_day',
    refreshSeconds: liveConnected ? finite(live.refreshSeconds) || 5 : null,
    liveConnected,
    scoreMeaning: '異常強度，不是勝率、方向機率或AI可信度',
    callHeat, putHeat, focus,
    direction: liveConnected ? 'awaiting_price_confirmation' : 'unconfirmed',
    directionLabel: liveConnected ? '等待價格與成交確認' : '盤後結構觀察，方向未確認',
    recommendation: liveConnected
      ? '需再通過標的VWAP、CVD、主動成交與風控條件，才可成為盤中候選。'
      : '先用來找異常履約價與攻防區；未接Bid／Ask、逐筆Greeks及價格確認前，不產生多空下單建議。',
    volatility: {
      atmIv, atmIvChange1d: round(context.atmIvChange1d, 4), skew25d: finite(volatility?.skew25d),
      ivRvSpread: finite(volatility?.ivRvSpread), qualityStatus: volatility?.qualityStatus || null,
    },
    topCalls: calls.slice(0, 10),
    topPuts: puts.slice(0, 10),
    safeguards: {
      publicOiDoesNotRevealBuyerSeller: true,
      dealerExposureEstimated: false,
      zeroGammaAvailable: false,
      blackScholesLiveGreeksAvailable: liveConnected,
      orderEndpointPresent: false,
    },
    pendingInputs: liveConnected ? [] : ['逐筆成交方向', 'Bid／Ask與五檔', '逐履約價即時IV／Greeks', '標的VWAP／CVD', '即時OI（若資料源提供）'],
  };
}
