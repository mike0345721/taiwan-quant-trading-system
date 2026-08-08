function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number == null ? null : Math.trunc(number);
}

export function snapshotTradeDate(snapshot) {
  return snapshot?.spotInstitutional?.dataDate
    || snapshot?.futuresInstitutional?.dataDate
    || snapshot?.options?.dataDate
    || snapshot?.asOfDate
    || null;
}

export function normalizeSnapshot(snapshot) {
  const tradeDate = snapshotTradeDate(snapshot);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('Snapshot has no valid trade date');
  const overview = snapshot.marketOverview?.data || {};
  const breadth = snapshot.marketBreadth?.data || {};
  const tx = snapshot.futuresMarket?.data?.txDay || {};
  const spot = snapshot.spotInstitutional?.data || {};
  const futures = snapshot.futuresInstitutional?.data || {};
  const large = snapshot.largeTraders?.data || {};
  const margin = snapshot.margin?.data || {};
  const options = snapshot.options?.data || {};
  const signal = snapshot.signal || {};
  const basis = finite(snapshot.derived?.market?.basis) ?? (finite(tx.close) != null && finite(overview.twii?.price) != null ? finite(tx.close) - finite(overview.twii.price) : null);

  const contracts = (options.contracts || []).map((contract) => ({
    tradeDate,
    contract: String(contract.contract),
    contractType: contract.type || null,
    expiryDate: contract.expiryDate || null,
    daysToExpiry: integer(contract.daysToExpiry),
    isActive: contract.contract === options.contract ? 1 : 0,
    callVolume: integer(contract.callVolume),
    putVolume: integer(contract.putVolume),
    volumePcRatio: finite(contract.volumePcRatio),
    callOi: integer(contract.callOi),
    putOi: integer(contract.putOi),
    oiPcRatio: finite(contract.oiPcRatio),
    callWallStrike: finite(contract.callWall?.strike),
    callWallOi: integer(contract.callWall?.openInterest),
    putWallStrike: finite(contract.putWall?.strike),
    putWallOi: integer(contract.putWall?.openInterest),
    maxPain: finite(contract.maxPain),
    strikes: (contract.strikes || []).map((item) => ({ strike: finite(item.strike), callOi: integer(item.callOi) || 0, putOi: integer(item.putOi) || 0 })).filter((item) => item.strike != null),
  }));

  if (contracts.length === 0 && options.contract) {
    contracts.push({
      tradeDate, contract: String(options.contract), contractType: options.contractType || null,
      expiryDate: options.expiryDate || null, daysToExpiry: integer(options.daysToExpiry), isActive: 1,
      callVolume: integer(options.totalCallVolume), putVolume: integer(options.totalPutVolume), volumePcRatio: finite(options.volumePcRatio),
      callOi: integer(options.totalCallOi), putOi: integer(options.totalPutOi), oiPcRatio: finite(options.oiPcRatio),
      callWallStrike: finite(options.callWall?.strike), callWallOi: integer(options.callWall?.openInterest),
      putWallStrike: finite(options.putWall?.strike), putWallOi: integer(options.putWall?.openInterest), maxPain: finite(options.maxPain), strikes: [],
    });
  }

  return {
    tradeDate,
    generatedAt: snapshot.generatedAt || null,
    asOfDate: snapshot.asOfDate || tradeDate,
    dataMode: snapshot.dataMode || 'unknown',
    sources: Object.entries(snapshot.sources || {}).map(([key, source]) => ({
      tradeDate, key, name: source.source || key, dataDate: source.dataDate || null,
      fetchedAt: source.fetchedAt || null, ok: source.ok ? 1 : 0, stale: source.stale ? 1 : 0,
      fallback: source.fallbackFromCache ? 1 : 0, error: source.error || null,
    })),
    market: {
      tradeDate, twiiClose: finite(overview.twii?.price), twiiChange: finite(overview.twii?.change), twiiChangePct: finite(overview.twii?.changePct),
      otcClose: finite(overview.otc?.price), otcChangePct: finite(overview.otc?.changePct), taiwanVix: finite(snapshot.taiwanVix?.data?.close), usVix: finite(overview.vix),
      txContract: tx.contract || null, txClose: finite(tx.close), txChange: finite(tx.change), txChangePct: finite(tx.changePct), txVolume: integer(tx.volume),
      txOpenInterest: integer(tx.openInterest), basis,
      listedAdvance: integer(breadth.listed?.advance), listedDecline: integer(breadth.listed?.decline), listedLimitUp: integer(breadth.listed?.limitUp), listedLimitDown: integer(breadth.listed?.limitDown),
      otcAdvance: integer(breadth.otc?.advance), otcDecline: integer(breadth.otc?.decline), otcLimitUp: integer(breadth.otc?.limitUp), otcLimitDown: integer(breadth.otc?.limitDown),
    },
    spot: {
      tradeDate, foreignNetE: finite(spot.foreignNetE), trustNetE: finite(spot.trustNetE), dealerProprietaryNetE: finite(spot.dealerProprietaryNetE),
      dealerHedgeNetE: finite(spot.dealerHedgeNetE), dealerTotalNetE: finite(spot.dealerTotalNetE), institutionalTotalE: finite(snapshot.derived?.spot?.institutionalTotalE),
    },
    futures: {
      tradeDate, foreignLong: integer(futures.foreignLong), foreignShort: integer(futures.foreignShort), foreignNet: integer(futures.foreignNet),
      dealerLong: integer(futures.dealerLong), dealerShort: integer(futures.dealerShort), dealerNet: integer(futures.dealerNet),
      trustLong: integer(futures.trustLong), trustShort: integer(futures.trustShort), trustNet: integer(futures.trustNet), marketOpenInterest: integer(large.marketOi ?? tx.openInterest),
      top5Long: integer(large.top5Long), top5Short: integer(large.top5Short), top10Long: integer(large.top10Long), top10Short: integer(large.top10Short),
    },
    domesticFutures: [
      { institutionType: 'investment_trust', long: integer(futures.trustLong), short: integer(futures.trustShort), net: integer(futures.trustNet) },
      { institutionType: 'dealer', long: integer(futures.dealerLong), short: integer(futures.dealerShort), net: integer(futures.dealerNet) },
    ].filter((row) => row.net != null),
    largeTraders: (large.scopes || [large]).filter((row) => row?.top5Long != null).map((row) => ({
      tradeDate,
      expiryScope: row.scope || 'all_contracts',
      expiryLabel: row.scopeLabel || null,
      top5Long: integer(row.top5Long), top5LongSpecific: integer(row.top5LongSpecific),
      top10Long: integer(row.top10Long), top10LongSpecific: integer(row.top10LongSpecific),
      top5Short: integer(row.top5Short), top5ShortSpecific: integer(row.top5ShortSpecific),
      top10Short: integer(row.top10Short), top10ShortSpecific: integer(row.top10ShortSpecific),
      marketOpenInterest: integer(row.marketOi),
      fetchedAt: snapshot.largeTraders?.fetchedAt || snapshot.generatedAt || new Date().toISOString(),
    })),
    margin: {
      tradeDate,
      marginBalanceE: finite(margin.marginBalanceE),
      shortBalanceLots: integer(margin.shortBalanceLots),
      sourceName: snapshot.margin?.source || 'TWSE MI_MARGN',
      sourceDataDate: snapshot.margin?.dataDate || null,
      fetchedAt: snapshot.margin?.fetchedAt || null,
    },
    contracts,
    signal: {
      tradeDate, version: signal.version || null, totalScore: finite(signal.totalScore), bias: signal.bias || null, regime: signal.regime || null,
      volatilityRisk: finite(signal.volatilityRisk), spotScore: finite(signal.components?.spot), futuresScore: finite(signal.components?.futures),
      optionsScore: finite(signal.components?.options), breadthScore: finite(signal.components?.breadth), modelCoveragePct: finite(signal.modelCoveragePct),
      completenessPct: finite(signal.completenessPct), adviceJson: signal.advice ? JSON.stringify(signal.advice) : null,
    },
  };
}
