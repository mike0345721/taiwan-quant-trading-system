import { buildDealerMap } from './dealer-map.mjs';

function value(snapshot, path) {
  return path.split('.').reduce((item, key) => item?.[key], snapshot);
}

function dataDate(snapshot) {
  return snapshot?.spotInstitutional?.dataDate || snapshot?.futuresInstitutional?.dataDate || snapshot?.asOfDate || null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumLast(rows, path, count) {
  const values = rows.slice(-count).map((row) => finite(value(row, path))).filter((item) => item != null);
  return values.length === count ? values.reduce((sum, item) => sum + item, 0) : null;
}

function percentile(rows, path, current) {
  const values = rows.map((row) => finite(value(row, path))).filter((item) => item != null);
  if (values.length < 20 || current == null) return null;
  return Math.round(values.filter((item) => item <= current).length / values.length * 100);
}

function marketTrend(rows) {
  const closes = rows.map((row) => finite(value(row, 'marketOverview.data.twii.price'))).filter((item) => item != null);
  const current = closes.at(-1);
  const return5d = closes.length >= 6 ? (current / closes.at(-6) - 1) * 100 : null;
  const return20d = closes.length >= 21 ? (current / closes.at(-21) - 1) * 100 : null;
  const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((sum, item) => sum + item, 0) / 20 : null;
  let realizedVol20 = null;
  if (closes.length >= 21) {
    const recent = closes.slice(-21);
    const returns = recent.slice(1).map((item, index) => Math.log(item / recent[index]));
    const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
    const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    realizedVol20 = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }
  return { return5d, return20d, sma20, realizedVol20 };
}

function optionContractChanges(currentContracts = [], previousContracts = []) {
  const previousMap = new Map(previousContracts.map((item) => [item.contract, item]));
  return currentContracts.map((contract) => {
    const prior = previousMap.get(contract.contract);
    const previousStrikes = new Map((prior?.strikes || []).map((item) => [Number(item.strike), item]));
    const strikeChanges = (contract.strikes || []).map((item) => {
      const previousStrike = previousStrikes.get(Number(item.strike));
      return {
        strike: Number(item.strike),
        callOiDelta: previousStrike ? finite(item.callOi) - finite(previousStrike.callOi) : null,
        putOiDelta: previousStrike ? finite(item.putOi) - finite(previousStrike.putOi) : null,
      };
    });
    return {
      contract: contract.contract,
      type: contract.type,
      expiryDate: contract.expiryDate,
      daysToExpiry: contract.daysToExpiry,
      callOi: finite(contract.callOi),
      putOi: finite(contract.putOi),
      oiPcRatio: finite(contract.oiPcRatio),
      comparisonAvailable: Boolean(prior),
      callOiDelta: prior ? finite(contract.callOi) - finite(prior.callOi) : null,
      putOiDelta: prior ? finite(contract.putOi) - finite(prior.putOi) : null,
      topCallOiIncreases: strikeChanges.filter((item) => item.callOiDelta > 0).sort((a, b) => b.callOiDelta - a.callOiDelta).slice(0, 3),
      topPutOiIncreases: strikeChanges.filter((item) => item.putOiDelta > 0).sort((a, b) => b.putOiDelta - a.putOiDelta).slice(0, 3),
    };
  });
}

export function enrichSnapshot(snapshot, history = []) {
  const byDate = new Map();
  for (const row of [...history, snapshot]) {
    if (row?.dataMode !== 'live') continue;
    const date = dataDate(row);
    if (date) byDate.set(date, row);
  }
  const rows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
  const currentIndex = rows.findIndex((row) => row === snapshot);
  const throughCurrent = currentIndex >= 0 ? rows.slice(0, currentIndex + 1) : rows;
  const previous = throughCurrent.at(-2) || null;
  const spot = snapshot.spotInstitutional?.data || {};
  const futures = snapshot.futuresInstitutional?.data || {};
  const futuresMarket = snapshot.futuresMarket?.data || {};
  const twii = finite(snapshot.marketOverview?.data?.twii?.price);
  const tx = finite(futuresMarket.txDay?.close);
  const nextTx = finite(futuresMarket.txNext?.close);
  const basis = tx != null && twii != null ? tx - twii : null;
  const previousOi = finite(previous?.largeTraders?.data?.marketOi ?? previous?.futuresMarket?.data?.txDay?.openInterest);
  const currentOi = finite(snapshot.largeTraders?.data?.marketOi ?? futuresMarket.txDay?.openInterest);
  const optionContract = snapshot.options?.data?.contract;
  const previousOption = previous?.options?.data?.contract === optionContract ? previous.options.data : null;
  const contractChanges = optionContractChanges(snapshot.options?.data?.contracts, previous?.options?.data?.contracts);

  const result = {
    sampleDays: throughCurrent.length,
    previousDataDate: dataDate(previous),
    market: {
      basis,
      basisPct: basis != null && twii ? basis / twii * 100 : null,
      calendarSpread: tx != null && nextTx != null ? nextTx - tx : null,
      ...marketTrend(throughCurrent),
    },
    spot: {
      institutionalTotalE: [spot.foreignNetE, spot.trustNetE, spot.dealerTotalNetE].map(finite).every((item) => item != null)
        ? finite(spot.foreignNetE) + finite(spot.trustNetE) + finite(spot.dealerTotalNetE)
        : null,
      foreign5dE: sumLast(throughCurrent, 'spotInstitutional.data.foreignNetE', 5),
      foreign20dE: sumLast(throughCurrent, 'spotInstitutional.data.foreignNetE', 20),
      foreignPercentile252: percentile(throughCurrent.slice(-252), 'spotInstitutional.data.foreignNetE', finite(spot.foreignNetE)),
    },
    futures: {
      foreignNetDelta: previous ? finite(futures.foreignNet) - finite(previous?.futuresInstitutional?.data?.foreignNet) : null,
      foreignShortDelta: previous ? finite(futures.foreignShort) - finite(previous?.futuresInstitutional?.data?.foreignShort) : null,
      foreignNet5dDelta: throughCurrent.length >= 6 ? finite(futures.foreignNet) - finite(throughCurrent.at(-6)?.futuresInstitutional?.data?.foreignNet) : null,
      openInterestDelta: currentOi != null && previousOi != null ? currentOi - previousOi : null,
      top5LongConcentration: currentOi ? finite(snapshot.largeTraders?.data?.top5Long) / currentOi * 100 : null,
      top5ShortConcentration: currentOi ? finite(snapshot.largeTraders?.data?.top5Short) / currentOi * 100 : null,
      top10LongConcentration: currentOi ? finite(snapshot.largeTraders?.data?.top10Long) / currentOi * 100 : null,
      top10ShortConcentration: currentOi ? finite(snapshot.largeTraders?.data?.top10Short) / currentOi * 100 : null,
    },
    options: {
      callOiDelta: previousOption ? finite(snapshot.options?.data?.totalCallOi) - finite(previousOption.totalCallOi) : null,
      putOiDelta: previousOption ? finite(snapshot.options?.data?.totalPutOi) - finite(previousOption.totalPutOi) : null,
      contractChanges,
    },
  };
  snapshot.derived = result;
  snapshot.dealerMap = buildDealerMap({ snapshot, history: throughCurrent });
  return snapshot;
}
