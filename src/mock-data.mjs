export function createMockSnapshot() {
  const fetchedAt = new Date().toISOString();
  const asOfDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const source = (name, dataDate = asOfDate) => ({ ok: true, source: name, dataDate, fetchedAt, stale: false });
  return {
    schemaVersion: 1,
    asOfDate,
    generatedAt: fetchedAt,
    marketOverview: {
      ...source('Yahoo Finance / TWSE'),
      data: {
        twii: { price: 23842.15, previousClose: 23690.31, change: 151.84, changePct: 0.64, dayHigh: 23910.22, dayLow: 23680.40 },
        otc: { price: 269.12, previousClose: 267.98, change: 1.14, changePct: 0.43 },
        usdtwd: 30.52,
        vix: 16.8,
      },
    },
    marketBreadth: {
      ...source('TWSE / TPEx'),
      data: {
        listed: { advance: 512, decline: 401, unchanged: 92, limitUp: 18, limitDown: 2, turnoverE: 3980 },
        otc: { advance: 392, decline: 310, unchanged: 71, limitUp: 14, limitDown: 1, turnoverE: 910 },
      },
    },
    spotInstitutional: {
      ...source('TWSE BFI82U'),
      data: { foreignNetE: 126.4, trustNetE: 18.7, dealerProprietaryNetE: 6.2, dealerHedgeNetE: -22.5, dealerTotalNetE: -16.3 },
    },
    margin: {
      ...source('TWSE MI_MARGN'),
      data: { marginBalanceE: 3185.4, shortBalanceLots: 221430 },
    },
    futuresMarket: {
      ...source('TAIFEX DailyMarketReportFut'),
      data: {
        txDay: { contract: '202607', close: 23860, change: 148, changePct: 0.62, volume: 82410, openInterest: 83520, session: '一般' },
        txNight: { contract: '202607', close: 23825, change: -35, changePct: -0.15, volume: 38210, openInterest: 0, session: '盤後' },
        tmfDay: { contract: '202607', close: 23858, change: 146, changePct: 0.62, volume: 110320, openInterest: 130440, session: '一般' },
      },
    },
    futuresInstitutional: {
      ...source('TAIFEX Institutional'),
      data: {
        foreignLong: 60420, foreignShort: 92310, foreignNet: -31890,
        foreignNetDelta: 4620, foreignShortDelta: -3510, deltaAvailable: true,
        dealerLong: 22120, dealerShort: 19980, dealerNet: 2140,
        trustLong: 6120, trustShort: 4510, trustNet: 1610,
      },
    },
    largeTraders: {
      ...source('TAIFEX Large Traders'),
      data: { top5Long: 41220, top5Short: 36510, top10Long: 53810, top10Short: 50540, marketOi: 83520 },
    },
    options: {
      ...source('TAIFEX TXO'),
      data: {
        contract: '202607W3', contractType: 'weekly', expiryDate: null,
        totalCallOi: 105420, totalPutOi: 131980, oiPcRatio: 1.25,
        callWall: { strike: 24200, openInterest: 12600 },
        putWall: { strike: 23400, openInterest: 14820 },
        maxPain: 23800,
        contracts: [],
      },
    },
    sources: {},
  };
}
