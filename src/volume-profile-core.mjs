// Deterministic research-only volume-at-price. No I/O, classification, or wall clock.
export const VOLUME_PROFILE_VERSION = 'cru61-volume-profile-v1';
const SAFETY = Object.freeze({ researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false });
const KEYS = ['actualContract', 'tradeDate', 'session', 'continuityEpoch', 'sourceLedgerIdentity'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const timestamp = x => typeof x === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const identityKey = x => JSON.stringify(KEYS.map(key => x?.[key]));
function checkIdentity(identity) {
  if (!identity || !KEYS.every(key => identity[key] !== undefined && identity[key] !== null && identity[key] !== '')
      || !['DAY', 'NIGHT'].includes(identity.session) || !/^\d{4}-\d{2}-\d{2}$/.test(identity.tradeDate)
      || !/^sha256:[a-f0-9]{64}$/.test(identity.sourceLedgerIdentity)) throw new Error('PROFILE_IDENTITY_REQUIRED');
  return Object.fromEntries(KEYS.map(key => [key, identity[key]]));
}
const fail = code => { throw new Error(code); };
// Decimal-number inputs use their shortest round-trip decimal representation.
// Integer arithmetic avoids 100.3 / 0.1 landing in bin 1002 through binary error.
function decimalRatio(value) {
  const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const exponent = Number(exponentText) - fraction.length;
  const digits = BigInt(whole + fraction);
  return exponent >= 0 ? [digits * 10n ** BigInt(exponent), 1n] : [digits, 10n ** BigInt(-exponent)];
}
function binIndex(price, size) {
  if(Number.isSafeInteger(price)&&Number.isSafeInteger(size))return Math.floor(price/size);
  const [pn,pd]=decimalRatio(price),[sn,sd]=decimalRatio(size);
  return Number(pn*sd/(pd*sn));
}
function binPrice(index,size){
  const [numerator,denominator]=decimalRatio(size);
  return Number(`${BigInt(index)*numerator}e-${denominator.toString().length-1}`);
}

export function createVolumeProfileState({ identity, binSize = 1, valueAreaFraction = 0.7, maxBins = 20000, maxTrades = 250000, retainTrades = true } = {}) {
  if (!finite(binSize) || binSize <= 0 || !finite(valueAreaFraction) || valueAreaFraction <= 0 || valueAreaFraction > 1
      || !Number.isSafeInteger(maxBins) || maxBins < 1 || maxBins > 20000
      || typeof retainTrades !== 'boolean' || !Number.isSafeInteger(maxTrades) || maxTrades < 1 || maxTrades > 250000) fail('PROFILE_PARAMETERS_INVALID');
  return { schemaVersion: VOLUME_PROFILE_VERSION, identity: checkIdentity(identity), binSize, valueAreaFraction,
    maxBins, maxTrades, ...(retainTrades ? {} : {retainTrades:false,tradeCount:0,firstTrade:null,lastTrade:null,observedStart:null,observedEnd:null}),
    bins: {}, binCount: 0, minBin: null, maxBin: null, trades: [], totalVolume: 0, lastOrdinal: null, lastAvailableAt: null, ...SAFETY };
}

function validate(state) {
  if (state?.schemaVersion !== VOLUME_PROFILE_VERSION || !Array.isArray(state.trades)
      || state.trades.length > state.maxTrades || !state.bins || !finite(state.totalVolume)
      || Object.entries(SAFETY).some(([k,v]) => state[k] !== v)) fail('PROFILE_STATE_INVALID');
  checkIdentity(state.identity);
}

// Only already-governed CRU34 ticks enter this boundary. UNKNOWN side is lawful volume.
export function appendVolumeProfileTrades(before, trades, { cutoff, mutatePrivateState = false } = {}) {
  validate(before);
  const cutoffMs = cutoff === undefined ? Infinity : timestamp(cutoff);
  if (cutoffMs === null || !Array.isArray(trades) || trades.length > 25000 || (before.retainTrades!==false&&before.trades.length + trades.length > before.maxTrades)) fail('PROFILE_INPUT_BUDGET_OR_CUTOFF');
  // The durable adapter owns a private clone inside its atomic transaction.
  // Standalone callers retain the original immutable input/output contract.
  const state = mutatePrivateState ? before : structuredClone(before);
  for (const trade of trades) {
    const at = timestamp(trade?.availableAt), event = timestamp(trade?.eventTime);
    const price = trade?.payload?.close, volume = trade?.payload?.volume;
    if (identityKey(trade) !== identityKey(state.identity)) fail('PROFILE_IDENTITY_MISMATCH');
    if (trade.kind !== 'futures_tick' || trade.identityStatus !== 'USABLE' || trade.availabilityLineageStatus !== 'USABLE'
        || trade.payload?.simtrade === true || trade.payload?.simtrade === 1 || trade.duplicate === true
        || !/^[a-f0-9]{64}$/.test(trade.recordHash || '') || !Number.isSafeInteger(trade.ledgerOrdinal) || trade.ledgerOrdinal < 0
        || at === null || event === null || event > at || at > cutoffMs
        || !finite(price) || price <= 0 || !finite(volume) || volume <= 0) fail('PROFILE_TRADE_INELIGIBLE');
    if (state.lastOrdinal !== null && trade.ledgerOrdinal <= state.lastOrdinal) fail('PROFILE_ORDINAL_NOT_ADVANCING');
    if (state.lastAvailableAt !== null && at < timestamp(state.lastAvailableAt)) fail('PROFILE_AVAILABILITY_REGRESSION');
    const index = binIndex(price,state.binSize);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(index+1) || !finite(binPrice(index+1,state.binSize))) fail('PROFILE_PRICE_RANGE_UNSUPPORTED');
    if (!(index in state.bins)) {
      if (state.binCount >= state.maxBins) fail('PROFILE_BIN_BUDGET');
      state.binCount++;
    }
    state.minBin = state.minBin === null ? index : Math.min(state.minBin,index);
    state.maxBin = state.maxBin === null ? index : Math.max(state.maxBin,index);
    if(state.maxBin-state.minBin+1>state.maxBins)fail('PROFILE_PRICE_SPAN_BUDGET');
    state.bins[index] = (state.bins[index] || 0) + volume;
    state.totalVolume += volume;
    if (!finite(state.totalVolume) || !finite(state.bins[index])) fail('PROFILE_NUMERIC_OVERFLOW');
    const entry={ bin: index, volume, eventTime: trade.eventTime, availableAt: trade.availableAt,
      ledgerOrdinal: trade.ledgerOrdinal, recordHash: trade.recordHash };
    if(state.retainTrades===false){
      state.tradeCount++;state.firstTrade??=entry;state.lastTrade=entry;
      if(state.observedStart===null||event<timestamp(state.observedStart))state.observedStart=trade.eventTime;
      if(state.observedEnd===null||event>timestamp(state.observedEnd))state.observedEnd=trade.eventTime;
    }else state.trades.push(entry);
    state.lastOrdinal = trade.ledgerOrdinal; state.lastAvailableAt = trade.availableAt;
  }
  return state;
}

function distribution(bins, binSize, total, fraction, maxBins) {
  const occupied = Object.keys(bins).map(Number).sort((a,b) => a-b);
  if (!occupied.length) return { bins: [], totalVolume: null, poc: null, val: null, vah: null, valueAreaVolume: null, hvn: [], lvn: [] };
  // Empty price bins are known zero *within* the observed range, never missing trades.
  const min = occupied[0], max = occupied.at(-1);
  if (max - min + 1 > maxBins) fail('PROFILE_PRICE_SPAN_BUDGET');
  const rows = [];
  for (let index = min; index <= max; index++) rows.push({ index, price: binPrice(index,binSize),
    lower: binPrice(index,binSize), upperExclusive: binPrice(index+1,binSize), volume: bins[index] || 0 });
  let pocIndex = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].volume > rows[pocIndex].volume) pocIndex = i;
  let lo = pocIndex, hi = pocIndex, valueAreaVolume = rows[pocIndex].volume;
  while (valueAreaVolume < total * fraction && (lo > 0 || hi < rows.length - 1)) {
    const lower = lo > 0 ? rows[lo-1].volume : -1;
    const upper = hi < rows.length - 1 ? rows[hi+1].volume : -1;
    // Ties always expand down first, one adjacent bin at a time.
    if (lower >= upper) { lo--; valueAreaVolume += rows[lo].volume; }
    else { hi++; valueAreaVolume += rows[hi].volume; }
  }
  const peak = rows[pocIndex].volume;
  return { bins: rows, totalVolume: total, poc: rows[pocIndex].price, val: rows[lo].lower,
    vah: rows[hi].upperExclusive, valueAreaVolume,
    hvn: rows.filter(row => row.volume >= peak * 0.7).map(row => row.price),
    lvn: rows.filter(row => row.volume <= peak * 0.2).map(row => row.price) };
}

export function volumeProfileSnapshot(state, { cutoff = state?.lastAvailableAt, completeSessionEvidence = null, history = null } = {}) {
  validate(state);
  const at = cutoff === null ? null : timestamp(cutoff);
  if (cutoff !== null && at === null) fail('PROFILE_CUTOFF_INVALID');
  const all = at !== null && (state.lastAvailableAt === null || at >= timestamp(state.lastAvailableAt));
  if(state.retainTrades===false){
    if(!all&&!history)fail('PROFILE_HISTORY_REQUIRED');
    const summary=all?{bins:state.bins,totalVolume:state.totalVolume,tradeCount:state.tradeCount,
      firstTrade:state.firstTrade,lastTrade:state.lastTrade,observedStart:state.observedStart,observedEnd:state.observedEnd}:history(cutoff);
    // Reuse the reference renderer and completeness checks, then restore the
    // independently stored count/range. No invented per-price trades are used.
    const proxy={...state,retainTrades:true,trades:summary.tradeCount?[summary.firstTrade,...(summary.tradeCount>1?[summary.lastTrade]:[])]:[],
      bins:summary.bins,totalVolume:summary.totalVolume,lastAvailableAt:summary.lastTrade?.availableAt??null};
    const result=volumeProfileSnapshot(proxy,{cutoff,completeSessionEvidence});
    return {...result,tradeCount:summary.tradeCount,observedStart:summary.observedStart,observedEnd:summary.observedEnd};
  }
  const trades = all ? state.trades : state.trades.filter(trade => at !== null && timestamp(trade.availableAt) <= at && timestamp(trade.eventTime) <= at);
  const bins = all ? state.bins : {}, total = all ? state.totalVolume : trades.reduce((sum, trade) => {
    bins[trade.bin] = (bins[trade.bin] || 0) + trade.volume; return sum + trade.volume;
  }, 0);
  const complete = trades.length > 0 && completeSessionEvidence?.state === 'COMPLETE' && completeSessionEvidence?.sessionStartProven === true
    && completeSessionEvidence?.captureCompleteness === 'PROVEN'
    && identityKey(completeSessionEvidence.identity) === identityKey(state.identity)
    && typeof completeSessionEvidence.artifactHash === 'string' && /^[a-f0-9]{64}$/.test(completeSessionEvidence.artifactHash)
    && timestamp(completeSessionEvidence.availableAt) !== null && timestamp(completeSessionEvidence.availableAt) <= at
    && timestamp(completeSessionEvidence.sessionEnd) !== null && timestamp(completeSessionEvidence.sessionEnd) <= at
    && completeSessionEvidence.firstOrdinal === trades[0]?.ledgerOrdinal
    && completeSessionEvidence.lastOrdinal === trades.at(-1)?.ledgerOrdinal
    && completeSessionEvidence.totalVolume === total;
  let observedStart=null,observedEnd=null;
  for(const trade of trades){
    if(observedStart===null||timestamp(trade.eventTime)<timestamp(observedStart))observedStart=trade.eventTime;
    if(observedEnd===null||timestamp(trade.eventTime)>timestamp(observedEnd))observedEnd=trade.eventTime;
  }
  return { schemaVersion: VOLUME_PROFILE_VERSION, identity: structuredClone(state.identity), cutoff,
    state: trades.length ? 'OBSERVATION_CANDIDATE' : 'UNAVAILABLE', scope: complete ? 'COMPLETE_SESSION' : 'OBSERVED_FRAGMENT',
    partial: !complete, binSize: state.binSize, valueAreaFraction: state.valueAreaFraction,
    rules: { bin: 'FLOOR_PRICE_DIV_BIN_SIZE', pocTie: 'LOWER_PRICE', valueArea: 'CONTIGUOUS_GREEDY_LOWER_TIE',
      vah: 'UPPER_EXCLUSIVE', nodes: 'HVN_GE_70PCT_POC_LVN_LE_20PCT_POC' },
    observedStart, observedEnd, firstAvailableAt:trades[0]?.availableAt??null,
    availableAt: trades.at(-1)?.availableAt ?? null, cutoffLedgerOrdinal: trades.at(-1)?.ledgerOrdinal ?? null,
    tradeCount: trades.length, ...distribution(bins, state.binSize, total, state.valueAreaFraction, state.maxBins),
    completeSessionEvidence: complete ? structuredClone(completeSessionEvidence) : null,
    limitations: ['VOLUME_AT_PRICE_NOT_POSITIONS_OR_HOLDER_COST', ...(complete ? [] : ['CAPTURE_COMPLETENESS_UNPROVEN'])], ...SAFETY };
}

export function selectPreviousCompleteProfile(profiles, currentIdentity, cutoff) {
  const at = timestamp(cutoff);
  if (!Array.isArray(profiles) || profiles.length > 32 || at === null) return null;
  return profiles.filter(profile => profile?.schemaVersion === VOLUME_PROFILE_VERSION && profile.scope === 'COMPLETE_SESSION'
    && profile.partial === false && profile.identity?.actualContract === currentIdentity?.actualContract
    && profile.tradeCount > 0 && profile.totalVolume > 0
    && profile.completeSessionEvidence?.state === 'COMPLETE' && profile.completeSessionEvidence?.sessionStartProven === true
    && profile.completeSessionEvidence?.captureCompleteness === 'PROVEN'
    && identityKey(profile.completeSessionEvidence?.identity) === identityKey(profile.identity)
    && /^[a-f0-9]{64}$/.test(profile.completeSessionEvidence?.artifactHash||'')
    && profile.completeSessionEvidence?.lastOrdinal === profile.cutoffLedgerOrdinal
    && profile.completeSessionEvidence?.totalVolume === profile.totalVolume
    && (profile.identity?.tradeDate !== currentIdentity?.tradeDate || profile.identity?.session !== currentIdentity?.session)
    && timestamp(profile.completeSessionEvidence?.availableAt) !== null && timestamp(profile.completeSessionEvidence.availableAt) <= at
    && timestamp(profile.completeSessionEvidence?.sessionEnd) !== null && timestamp(profile.completeSessionEvidence.sessionEnd) <= at
    && timestamp(profile.cutoff) !== null && timestamp(profile.cutoff) <= at)
    .sort((a,b) => timestamp(b.completeSessionEvidence.sessionEnd) - timestamp(a.completeSessionEvidence.sessionEnd))[0] ?? null;
}
