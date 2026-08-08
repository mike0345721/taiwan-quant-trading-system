import crypto from 'node:crypto';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value)));
}

function round(value) {
  return Math.round(clamp(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function axis({ key, label, value = null, signedValue = null, available, state, meaning, formula, inputs }) {
  return {
    key,
    label,
    value: available && finite(value) != null ? round(value) : null,
    signedValue: available && finite(signedValue) != null
      ? Math.round(clamp(signedValue, -100, 100))
      : null,
    available: Boolean(available),
    state: available ? state : 'unknown',
    meaning: available ? meaning : '資料不足，不納入影子觀察值',
    formula,
    inputs,
    formalWeight: 0,
    influencesOfficialDecision: false,
  };
}

export function buildSixAxisShadow(snapshot = {}) {
  const signal = snapshot.signal || {};
  const risk = snapshot.researchDecision?.v362Risk || {};
  const price = snapshot.priceConfirmation || {};
  const optionRisk = risk.options || {};
  const direction = finite(signal.totalScore);
  const volatility = finite(signal.volatilityRisk);
  const tradability = finite(signal.tradabilityScore);
  const evidenceLevel = finite(risk.evidence?.level);
  const oiPcRatio = finite(snapshot.options?.data?.oiPcRatio);
  const atmIv = finite(optionRisk.atmIv);
  const skew = finite(optionRisk.skew);

  const directionAvailable = direction != null && Number(signal.availableComponentCount || 0) > 0;
  const volatilityAvailable = volatility != null
    && (finite(snapshot.taiwanVix?.data?.close) != null || finite(snapshot.marketOverview?.data?.vix) != null);
  const optionAvailable = Boolean(snapshot.options?.ok)
    && (oiPcRatio != null || atmIv != null || skew != null);
  const optionPressure = optionRisk.level === 'high'
    ? 80
    : optionRisk.level === 'medium'
      ? 55
      : optionRisk.level === 'low'
        ? 25
        : oiPcRatio != null
          ? clamp(Math.abs(oiPcRatio - 1) * 100, 0, 70)
          : null;
  const priceAvailable = Boolean(price.ready);
  const priceValue = priceAvailable
    ? ['long_confirmed', 'short_confirmed'].includes(price.state) ? 100
      : ['above_vwap_wait', 'below_vwap_wait'].includes(price.state) ? 55
        : 35
    : null;
  const evidenceAvailable = evidenceLevel != null;

  const axes = [
    axis({
      key: 'direction',
      label: '方向一致性',
      value: directionAvailable ? Math.abs(direction) : null,
      signedValue: direction,
      available: directionAvailable,
      state: direction >= 25 ? 'bullish' : direction <= -25 ? 'bearish' : 'neutral',
      meaning: `${direction >= 0 ? '偏多' : '偏空'}強度 ${Math.abs(Math.round(direction || 0))}/100；不是漲跌機率`,
      formula: 'abs(正式研究方向分數)',
      inputs: {
        totalScore: direction,
        agreementPct: finite(signal.agreementPct),
        componentCount: finite(signal.availableComponentCount),
        coveragePct: finite(signal.modelCoveragePct),
      },
    }),
    axis({
      key: 'volatility',
      label: '波動風險',
      value: volatility,
      available: volatilityAvailable,
      state: volatility >= 65 ? 'high_risk' : volatility >= 40 ? 'medium_risk' : 'low_risk',
      meaning: `${volatility >= 65 ? '高' : volatility >= 40 ? '中' : '低'}波動風險；分數越高越應縮小部位`,
      formula: '既有臺指VIX優先、缺漏時使用美國VIX的規則風險尺',
      inputs: {
        taiwanVix: finite(snapshot.taiwanVix?.data?.close),
        usVix: finite(snapshot.marketOverview?.data?.vix),
        volatilityRisk: volatility,
      },
    }),
    axis({
      key: 'options',
      label: '選擇權壓力',
      value: optionPressure,
      available: optionAvailable && optionPressure != null,
      state: optionPressure >= 70 ? 'high_risk' : optionPressure >= 40 ? 'medium_risk' : 'low_risk',
      meaning: `${optionPressure >= 70 ? '壓力升高' : optionPressure >= 40 ? '需要觀察' : '未見極端'}；不直接推論多空`,
      formula: 'ATM IV／Skew風險層級；不足時只用OI P/C偏離1的程度',
      inputs: {
        contract: optionRisk.contract || snapshot.options?.data?.contract || null,
        atmIv,
        skew,
        oiPcRatio,
        riskLevel: optionRisk.level || null,
      },
    }),
    axis({
      key: 'price',
      label: '價格確認',
      value: priceValue,
      available: priceAvailable,
      state: ['long_confirmed', 'short_confirmed'].includes(price.state) ? 'confirmed' : 'waiting',
      meaning: ['long_confirmed', 'short_confirmed'].includes(price.state)
        ? '價格條件已確認，仍不代表可自動下單'
        : '已有盤中價格資料，但觸發條件尚未完整',
      formula: '方向確認=100、VWAP單側等待=55、其他有效狀態=35',
      inputs: {
        state: price.state || null,
        vwap: finite(price.vwap),
        volumeRatio: finite(price.volumeRatio),
        bars: finite(price.bars),
      },
    }),
    axis({
      key: 'tradability',
      label: '可交易性',
      value: tradability,
      available: tradability != null,
      state: tradability >= 70 ? 'ready' : tradability >= 40 ? 'observe' : 'blocked',
      meaning: `${tradability >= 70 ? '流程條件較完整' : tradability >= 40 ? '僅適合觀察' : '目前不適合交易'}；不是期望報酬`,
      formula: '資料問題、訊號衝突與波動風險的流程準備度',
      inputs: {
        tradabilityScore: tradability,
        tradeState: signal.tradeState || null,
        vetoCount: Array.isArray(signal.vetoReasons) ? signal.vetoReasons.length : 0,
        completenessPct: finite(signal.completenessPct),
      },
    }),
    axis({
      key: 'evidence',
      label: '證據品質',
      value: evidenceAvailable ? clamp(evidenceLevel / 2 * 100) : null,
      available: evidenceAvailable,
      state: risk.evidence?.liveEligible ? 'eligible' : 'research_only',
      meaning: risk.evidence?.liveEligible
        ? '已達目前研究門檻，仍須前向驗證'
        : '只屬研究候選，不得轉成實單依據',
      formula: '目前證據等級 ÷ 最高等級2 × 100',
      inputs: {
        level: evidenceLevel,
        liveEligible: risk.evidence?.liveEligible === true,
        interpretation: risk.evidence?.interpretation || null,
      },
    }),
  ];

  const availableAxes = axes.filter((item) => item.available);
  const shadowObservation = availableAxes.length
    ? Math.round(availableAxes.reduce((sum, item) => sum + item.value, 0) / availableAxes.length)
    : null;
  const recordedAt = new Date().toISOString();
  const record = {
    schemaVersion: '3.9.6-six-axis-shadow-v1',
    dataDate: risk.dataDate || snapshot.asOfDate || null,
    recordedAt,
    mode: 'shadow_only',
    formalWeight: 0,
    influencesOfficialDecision: false,
    executionAuthorized: false,
    shadowObservation,
    availableAxes: availableAxes.length,
    totalAxes: axes.length,
    axes,
    note: '影子觀察值不是勝率、方向機率或期望報酬；通過樣本外與前向驗證前，正式權重固定為0。',
  };
  record.inputHash = crypto.createHash('sha256')
    .update(JSON.stringify(canonical({
      dataDate: record.dataDate,
      axes: axes.map(({ key, value, signedValue, available, inputs }) => ({ key, value, signedValue, available, inputs })),
    })))
    .digest('hex');
  return record;
}
