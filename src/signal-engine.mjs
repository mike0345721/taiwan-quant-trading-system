function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signedScale(value, neutral, strong) {
  const abs = Math.abs(value);
  if (abs <= neutral) return 0;
  const score = ((abs - neutral) / Math.max(1, strong - neutral)) * 100;
  return Math.sign(value) * clamp(score, 0, 100);
}

function numberText(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '—';
}

function signedText(value, suffix = '', digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '資料不足';
  return `${number > 0 ? '+' : ''}${numberText(number, digits)}${suffix}`;
}

export function buildSignal(snapshot) {
  const spot = snapshot.spotInstitutional?.data || {};
  const futures = snapshot.futuresInstitutional?.data || {};
  const options = snapshot.options?.data || {};
  const breadth = snapshot.marketBreadth?.data || {};
  const macro = snapshot.marketOverview?.data || {};
  const derivedMarket = snapshot.derived?.market || {};

  const spotScore = clamp(
    signedScale(spot.foreignNetE || 0, 20, 250) * 0.65 +
    signedScale(spot.trustNetE || 0, 5, 50) * 0.25 +
    signedScale(spot.dealerProprietaryNetE || 0, 3, 30) * 0.10,
    -100,
    100,
  );

  const netDelta = snapshot.derived?.futures?.foreignNetDelta ?? futures.foreignNetDelta ?? 0;
  const shortDelta = snapshot.derived?.futures?.foreignShortDelta ?? futures.foreignShortDelta ?? 0;
  const futuresDeltaAvailable = snapshot.derived?.futures?.foreignNetDelta != null || futures.deltaAvailable;
  const futuresScore = futuresDeltaAvailable
    ? clamp(signedScale(netDelta, 1_000, 12_000) * 0.55 - signedScale(shortDelta, 1_000, 12_000) * 0.45, -100, 100)
    : 0;

  const pcRatio = options.oiPcRatio || 0;
  let optionsScore = 0;
  if (pcRatio > 0) {
    if (pcRatio >= 1.25) optionsScore = clamp((pcRatio - 1) * 80, 0, 50);
    else if (pcRatio <= 0.8) optionsScore = -clamp((1 - pcRatio) * 80, 0, 50);
  }

  const advance = Number(breadth.listed?.advance || 0) + Number(breadth.otc?.advance || 0);
  const decline = Number(breadth.listed?.decline || 0) + Number(breadth.otc?.decline || 0);
  const breadthTotal = advance + decline;
  const breadthScore = breadthTotal > 0 ? clamp(((advance - decline) / breadthTotal) * 100, -100, 100) : 0;

  const spotAvailable = Boolean(snapshot.spotInstitutional?.ok)
    && [spot.foreignNetE, spot.trustNetE, spot.dealerProprietaryNetE].some((value) => Number.isFinite(Number(value)));
  const optionsAvailable = Boolean(snapshot.options?.ok) && Number.isFinite(Number(pcRatio)) && Number(pcRatio) > 0;
  const breadthAvailable = Boolean(snapshot.marketBreadth?.ok) && breadthTotal > 0;

  const usVix = macro.vix || 0;
  const taiwanVix = Number(snapshot.taiwanVix?.data?.close || 0);
  const volatilityRisk = taiwanVix >= 35 ? 100 : taiwanVix >= 30 ? 80 : taiwanVix >= 25 ? 65 : taiwanVix >= 20 ? 50 : taiwanVix >= 18 ? 35 : taiwanVix > 0 ? 15 : usVix >= 25 ? 65 : usVix >= 18 ? 35 : usVix > 0 ? 15 : 0;

  const components = [
    { key: 'spot', score: spotScore, weight: 0.30, available: spotAvailable },
    { key: 'futures', score: futuresScore, weight: 0.30, available: Boolean(snapshot.futuresInstitutional?.ok && futuresDeltaAvailable) },
    { key: 'options', score: optionsScore, weight: 0.20, available: optionsAvailable },
    { key: 'breadth', score: breadthScore, weight: 0.20, available: breadthAvailable },
  ];

  const activeWeight = components.filter((item) => item.available).reduce((sum, item) => sum + item.weight, 0);
  const totalScore = activeWeight > 0
    ? components.filter((item) => item.available).reduce((sum, item) => sum + item.score * item.weight, 0) / activeWeight
    : 0;

  const sourceList = Object.values(snapshot.sources || {});
  const okSources = sourceList.filter((item) => item.ok).length;
  const completeness = sourceList.length > 0 ? okSources / sourceList.length : 0;
  const directionStrength = Math.round(Math.abs(totalScore));
  const directional = components.filter((item) => item.available && Math.abs(item.score) >= 10);
  const directionalWeight = directional.reduce((sum, item) => sum + item.weight, 0);
  const dominantSign = Math.sign(totalScore);
  const alignedWeight = directional.filter((item) => Math.sign(item.score) === dominantSign).reduce((sum, item) => sum + item.weight, 0);
  const agreementPct = directionalWeight > 0 ? Math.round(alignedWeight / directionalWeight * 100) : 0;

  const criticalSourceKeys = ['marketOverview', 'marketBreadth', 'spotInstitutional', 'futuresMarket', 'futuresInstitutional', 'options'];
  const criticalSources = criticalSourceKeys.map((key) => snapshot.sources?.[key]).filter(Boolean);
  const criticalProblems = criticalSources.filter((item) => !item.ok || ['stale', 'cached', 'failed'].includes(item.freshness)).length;

  let bias = 'neutral';
  if (totalScore >= 25) bias = 'long';
  else if (totalScore <= -25) bias = 'short';
  else if (totalScore >= 10) bias = 'lean_long';
  else if (totalScore <= -10) bias = 'lean_short';

  const indexPct = macro.twii?.changePct || 0;
  let regime = 'range';
  const trendReady = derivedMarket.return20d != null && derivedMarket.sma20 != null
    && Number.isFinite(Number(derivedMarket.return20d)) && Number.isFinite(Number(derivedMarket.sma20));
  if (taiwanVix >= 30) regime = 'high_volatility';
  else if (trendReady) {
    if (Number(derivedMarket.realizedVol20) >= 30) regime = 'high_volatility';
    else if (Number(derivedMarket.return20d) >= 3 && Number(macro.twii?.price) > Number(derivedMarket.sma20)) regime = 'bull_trend';
    else if (Number(derivedMarket.return20d) <= -3 && Number(macro.twii?.price) < Number(derivedMarket.sma20)) regime = 'bear_trend';
  } else if (volatilityRisk >= 80) regime = taiwanVix > 0 ? 'high_volatility' : 'high_volatility_background';
  else if (indexPct >= 0.8 && breadthScore >= 10) regime = 'bullish_day';
  else if (indexPct <= -0.8 && breadthScore <= -10) regime = 'bearish_day';

  const conflicts = [];
  const availableScores = components.filter((item) => item.available && Math.abs(item.score) >= 20);
  if (availableScores.some((item) => item.score > 0) && availableScores.some((item) => item.score < 0)) {
    conflicts.push('主要指標方向不一致');
  }
  if (completeness < 0.75) conflicts.push('資料完整度不足 75%');
  if (volatilityRisk >= 65) conflicts.push('波動風險偏高');

  const nightMovePct = Number(snapshot.futuresMarket?.data?.txNight?.changePct || 0);
  const gapRisk = clamp(Math.round(Math.abs(nightMovePct) * 25 + Math.max(0, usVix - 18) * 3), 0, 100);
  const tradabilityScore = clamp(Math.round(
    100 - criticalProblems * 18 - conflicts.length * 12 - volatilityRisk * 0.35 - 30,
  ), 0, 100);
  const vetoReasons = [
    ...(criticalProblems ? [`${criticalProblems}個關鍵來源不是最新可用`] : []),
    ...(volatilityRisk >= 65 ? ['波動風險偏高'] : []),
    ...(conflicts.length ? conflicts : []),
    '5分鐘價格、VWAP與成交量確認尚未接入',
  ];

  const spotBearish = spotScore <= -25 && breadthScore <= -10;
  const spotBullish = spotScore >= 25 && breadthScore >= 10;
  const optionDays = Number(options.daysToExpiry);
  const optionStructure = pcRatio >= 1.25 ? 'Put OI相對偏高，結構偏多觀察' : pcRatio <= 0.8 && pcRatio > 0 ? 'Call OI相對偏高，結構偏空觀察' : 'OI P/C位於中性區，沒有明確方向優勢';
  const derived = snapshot.derived || {};
  const tx = snapshot.futuresMarket?.data?.txDay || {};
  const txClose = Number(tx.close || 0);
  const txChange = Number(tx.change || 0);
  const oiDelta = derived.futures?.openInterestDelta;
  const basis = derived.market?.basis;
  let priceOiReading = '價格與未平倉量比較資料不足';
  if (Number.isFinite(Number(oiDelta))) {
    if (txChange > 0 && oiDelta > 0) priceOiReading = '期貨上漲且OI增加，新風險部位進場';
    else if (txChange > 0 && oiDelta < 0) priceOiReading = '期貨上漲但OI下降，偏向空單回補';
    else if (txChange < 0 && oiDelta > 0) priceOiReading = '期貨下跌且OI增加，新空或避險增加';
    else if (txChange < 0 && oiDelta < 0) priceOiReading = '期貨下跌且OI下降，偏向多單撤退';
  }
  const activeContract = (options.contracts || []).find((item) => item.contract === options.contract);
  const callWall = activeContract?.callWall || options.callWall;
  const putWall = activeContract?.putWall || options.putWall;
  const maxPain = activeContract?.maxPain || options.maxPain;
  const contractChanges = derived.options?.contractChanges || [];
  const putIncrease = [...contractChanges]
    .filter((item) => item.comparisonAvailable && Number(item.putOiDelta) > 0)
    .sort((a, b) => Number(b.putOiDelta) - Number(a.putOiDelta))[0];
  const highPcContract = [...contractChanges]
    .filter((item) => Number(item.callOi) + Number(item.putOi) >= 1_000 && Number(item.oiPcRatio) > 0)
    .sort((a, b) => Number(b.oiPcRatio) - Number(a.oiPcRatio))[0];
  const optionWatch = putIncrease || highPcContract;
  const optionChangeText = putIncrease
    ? `${putIncrease.contract} Put OI單日 ${signedText(putIncrease.putOiDelta, '口')}${putIncrease.topPutOiIncreases?.length ? `，增量集中 ${putIncrease.topPutOiIncreases.map((item) => `${numberText(item.strike)}（+${numberText(item.putOiDelta)}）`).join('、')}` : ''}`
    : optionWatch
      ? `${optionWatch.contract} OI P/C ${numberText(optionWatch.oiPcRatio, 2)}；目前只有存量，尚無前日同契約增量可確認` 
      : '各到期契約尚無足夠比較資料';
  const spotTrend = `外資今日 ${signedText(spot.foreignNetE, '億', 1)}、5日 ${signedText(derived.spot?.foreign5dE, '億', 1)}、20日 ${signedText(derived.spot?.foreign20dE, '億', 1)}`;
  const futuresTrend = `外資淨部位 ${signedText(futures.foreignNet, '口')}，單日 ${signedText(derived.futures?.foreignNetDelta, '口')}、5日 ${signedText(derived.futures?.foreignNet5dDelta, '口')}；${priceOiReading}；基差 ${signedText(basis, '點', 1)}`;
  const longTrigger = callWall?.strike ? `多方需有效突破Call牆 ${numberText(callWall.strike)}，且期貨量、OI同步增加` : '多方需突破壓力並有量、OI確認';
  const shortTrigger = putWall?.strike ? `空方需有效跌破Put牆 ${numberText(putWall.strike)}，且Put OI、波動率與期貨OI同步增加` : '空方需跌破支撐並有Put OI、波動率與期貨OI確認';
  const advice = {
    action: conflicts.length ? '訊號衝突，等待確認' : '盤後偏向僅供觀察',
    conclusion: `${bias === 'long' ? '偏多' : bias === 'short' ? '偏空' : bias === 'lean_long' ? '中性偏多' : bias === 'lean_short' ? '中性偏空' : '中性'}，目前不進場`,
    reason: `現貨 ${Math.round(spotScore)}、期貨 ${Math.round(futuresScore)}、選擇權 ${Math.round(optionsScore)}、市場寬度 ${Math.round(breadthScore)}；${optionChangeText}。`,
    trigger: `${longTrigger}；${shortTrigger}。5分鐘成交量與VWAP尚未接入，盤中仍需人工確認。`,
    invalidation: `突破或跌破後重新回到攻防區即視為失效；資料過期、期現貨不同步或OI未配合時不採用。${maxPain ? ` Max Pain ${numberText(maxPain)}僅作結算結構參考。` : ''}`,
    stocks: spotBearish
      ? `偏保守：${spotTrend}；法人賣超且下跌家數較多，避免追高，只觀察相對強勢且量價正常的個股。`
      : spotBullish
        ? `偏多觀察：${spotTrend}；法人資金與市場寬度同向，可追蹤強勢族群，但仍等待價格與成交量確認。`
        : `中性觀察：${spotTrend}；法人與市場寬度尚未形成足夠一致訊號。`,
    futures: totalScore <= -25
      ? `臺指期偏空觀察；${futuresTrend}。不追空，等待支撐跌破且量、OI配合。`
      : totalScore >= 25
        ? `臺指期偏多觀察；${futuresTrend}。不追多，等待壓力突破且量、OI配合。`
        : totalScore <= -10
          ? `臺指期中性偏空；${futuresTrend}。分數尚未達偏空門檻，暫不建立方向部位。`
          : totalScore >= 10
            ? `臺指期中性偏多；${futuresTrend}。等待現貨、期貨與價格進一步同向。`
            : `臺指期中性；${futuresTrend}。沒有足夠方向優勢，優先等待。`,
    options: `${optionStructure}；主力契約 ${options.contract || '—'}，Call牆 ${numberText(callWall?.strike)}、Put牆 ${numberText(putWall?.strike)}、Max Pain ${numberText(maxPain)}。${optionChangeText}${Number.isFinite(optionDays) && optionDays <= 2 ? '；接近到期，Gamma與時間價值變化快，避免裸賣與過度槓桿。' : '；OI牆只作攻防參考，必須等待價格與OI共同確認。'}`,
    risk: taiwanVix > 0
      ? `臺指選擇權波動率指數 ${taiwanVix.toFixed(2)}${taiwanVix >= 30 ? '，本地預期波動偏高，期貨與選擇權部位應降低槓桿。' : taiwanVix >= 18 ? '，本地波動需注意。' : '，本地波動相對溫和。'} 美國 VIX ${usVix.toFixed(2)}僅作全球背景。`
      : `臺指本地波動率尚未取得；美國 VIX ${usVix.toFixed(2)}僅作全球背景。`,
  };

  return {
    version: 'v1.5.0',
    generatedAt: new Date().toISOString(),
    totalScore: Math.round(totalScore),
    bias,
    confidence: directionStrength,
    directionStrength,
    agreementPct,
    directionalCount: directional.length,
    availableComponentCount: components.filter((item) => item.available).length,
    modelCoveragePct: Math.round(activeWeight * 100),
    regime,
    regimeMethod: trendReady ? '20日趨勢模型' : '單日暫行模型（歷史資料累積中）',
    tradeState: 'wait',
    volatilityRisk,
    gapRisk,
    tradabilityScore,
    vetoReasons: [...new Set(vetoReasons)],
    completenessPct: Math.round(completeness * 100),
    components: {
      spot: Math.round(spotScore),
      futures: Math.round(futuresScore),
      options: Math.round(optionsScore),
      breadth: Math.round(breadthScore),
    },
    conflicts,
    advice,
    calculation: {
      activeWeight,
      weights: { spot: 30, futures: 30, options: 20, breadth: 20 },
      included: components.filter((item) => item.available).map((item) => ({ key: item.key, score: Math.round(item.score), weightPct: Math.round(item.weight * 100) })),
      note: '缺少的分項不以0分計入，剩餘權重會重新正規化。',
    },
    validation: {
      directionScore: 'research_only_unvalidated_weights',
      volatilityRisk: 'rule_based_not_probability',
      gapRisk: 'heuristic_not_probability',
      tradabilityScore: 'process_readiness_not_expected_return',
    },
    disclaimer: 'V1 分數只用於研究與篩選，不構成下單指令。',
  };
}
