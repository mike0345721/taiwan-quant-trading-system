const TAIPEI_TZ = 'Asia/Taipei';

export const SOURCE_METADATA = Object.freeze({
  marketOverview: { scope: '加權指數、櫃買指數、美元臺幣與美國 VIX', release: '盤中行情；非交易時段沿用最近收盤' },
  taiwanVix: { scope: '臺指選擇權波動率指數', release: '日盤收盤後更新', pendingUntilMinute: 14 * 60 + 30 },
  marketBreadth: { scope: '上市與上櫃漲跌、漲停與跌停家數', release: '收盤後更新', pendingUntilMinute: 15 * 60 },
  spotInstitutional: { scope: '上市市場三大法人買賣超', release: '收盤後更新', pendingUntilMinute: 15 * 60 + 30 },
  margin: { scope: '上市市場融資金額與融券餘額', release: '證交所約於每交易日 21:00 產製', pendingUntilMinute: 21 * 60 + 15 },
  futuresMarket: { scope: 'TX 與微型臺指日盤、夜盤行情及 OI', release: '各交易時段結束後更新', pendingUntilMinute: 14 * 60 + 45 },
  futuresInstitutional: { scope: '臺股期貨法人多空未平倉', release: '日盤收盤後陸續公布', pendingUntilMinute: 15 * 60 + 30 },
  options: { scope: 'TXO 各到期契約成交量、OI 與履約價結構', release: '日盤收盤後更新', pendingUntilMinute: 16 * 60 + 45 },
  largeTraders: { scope: 'TX+MTX/4+TMF/20 換算後的臺指期貨大額交易人未沖銷部位', release: '日盤收盤後陸續公布', pendingUntilMinute: 16 * 60 + 30 },
});

function taipeiClock(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function mostRecentFriday(clock) {
  const offset = clock.weekday === 'Sat' ? 1 : clock.weekday === 'Sun' ? 2 : 0;
  if (!offset) return null;
  const date = new Date(`${clock.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function evaluateSourceFreshness(key, source, snapshotDate, now = new Date()) {
  if (!source?.ok) return 'failed';
  if (source.fallbackFromCache) return 'cached';
  if (!source.stale) return 'current';
  const clock = taipeiClock(now);
  const metadata = SOURCE_METADATA[key] || {};
  // During a weekend the latest Friday close is current, not stale.  This is
  // intentionally narrow; weekday holidays still remain visible for review
  // until an exchange calendar is connected.
  if (source.dataDate && source.dataDate === mostRecentFriday(clock)) return 'current';
  if (metadata.pendingUntilMinute != null && snapshotDate === clock.date && source.dataDate < snapshotDate && clock.minute < metadata.pendingUntilMinute) return 'pending_publication';
  return 'stale';
}

export function sourceQualityMetadata(key, source, snapshotDate, now = new Date()) {
  const metadata = SOURCE_METADATA[key] || {};
  return { freshness: evaluateSourceFreshness(key, source, snapshotDate, now), scope: metadata.scope || null, release: metadata.release || null };
}

const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function dailySourceStatus(key, source, { now = new Date(), calendar = null } = {}) {
  const clock=taipeiClock(now), metadata=SOURCE_METADATA[key]||{}, currentMs=now.getTime();
  let targetDate=clock.date,calendarReason=null;
  if(calendar){
    for(let offset=0;offset<370;offset++){
      const day=new Date(Date.parse(clock.date+'T00:00:00Z')-offset*86400000).toISOString().slice(0,10);
      const exception=calendar.exceptions?.get(day);
      if(calendar.pendingCandidateDates?.has(day)){targetDate=null;calendarReason='CALENDAR_CANDIDATE_NOT_ACTIVATED';break;}
      if(exception?.officialTradingDay===true||(!exception&&calendar.tradingDates?.has(day))){targetDate=day;break;}
      if(exception?.officialTradingDay===false||calendar.nonTradingDates?.has(day))continue;
      targetDate=null;calendarReason='CALENDAR_NOT_COVERED';break;
    }
  }else{targetDate=null;calendarReason='CALENDAR_UNVERIFIED';}
  const dueAt=targetDate?new Date(`${targetDate}T00:00:00+08:00`).getTime()+(metadata.pendingUntilMinute??0)*60000:null;
  const fetchedAt=validTime(source?.fetchedAt)&&Date.parse(source.fetchedAt)<=currentMs?source.fetchedAt:null;
  const knownSuccess=source?.lastSuccessfulAt??(!source?.fallbackFromCache&&source?.ok?fetchedAt:null);
  const lastSuccessfulAt=validTime(knownSuccess)&&Date.parse(knownSuccess)<=currentMs?knownSuccess:null;
  const sourceTime=validTime(source?.sourceTime)&&Date.parse(source.sourceTime)<=currentMs?source.sourceTime:null;
  let status,reason;
  if(!targetDate){status='STALE';reason=calendarReason;}
  else if(source?.fetchedAt&&!fetchedAt){status='STALE';reason='SOURCE_ATTEMPT_TIMESTAMP_INVALID_OR_FUTURE';}
  else if(source?.ok&&fetchedAt&&!source.fallbackFromCache&&!source.error&&source.dataDate===targetDate
    &&(!source.stale||(targetDate<clock.date&&source.staleReason==='DATA_DATE_BEFORE_CALENDAR_DAY'))){status='AVAILABLE';reason=null;}
  else if(currentMs<dueAt){status='NOT_DUE';reason='BEFORE_EXPECTED_PUBLICATION_WINDOW';}
  else if(fetchedAt&&Date.parse(fetchedAt)>=dueAt&&(!source?.ok||source.fallbackFromCache||source.error)){status='JOB_FAILED';reason=source.error||'SOURCE_FETCH_FAILED';}
  else if(fetchedAt&&Date.parse(fetchedAt)>=dueAt&&source?.ok&&!source.fallbackFromCache&&source.dataDate&&source.dataDate<targetDate){status='SOURCE_NOT_PUBLISHED';reason='LATEST_SUCCESSFUL_SOURCE_RESPONSE_HAS_EARLIER_DATA_DATE';}
  else if(!fetchedAt||Date.parse(fetchedAt)<dueAt){status='JOB_NOT_RUN';reason='NO_RECORDED_FETCH_AFTER_EXPECTED_PUBLICATION_WINDOW';}
  else{status='STALE';reason=source?.error||'SOURCE_DATE_OR_QUALITY_NOT_CURRENT';}
  return {status,reason,targetDate,dataDate:source?.dataDate??null,sourceTime,lastSuccessfulAt,lastAttemptAt:fetchedAt,
    expectedAt:dueAt===null?null:new Date(dueAt).toISOString(),checkedAt:now.toISOString(),
    jobScope:'DASHBOARD_SOURCE_REFRESH; SCHEDULED_BATCH_STATUS_IS_SEPARATE',
    sourceTimeReason:sourceTime?null:'SOURCE_PUBLICATION_TIMESTAMP_NOT_PROVIDED'};
}

export function sourceStatusesForSnapshot(snapshot, {now=new Date(),calendar=null}={}) {
  return Object.fromEntries(Object.keys(SOURCE_METADATA).map(key=>[key,{
    ...(snapshot?.sources?.[key]??{}),...sourceQualityMetadata(key,snapshot?.[key],snapshot?.asOfDate,now),
    update:dailySourceStatus(key,snapshot?.[key],{now,calendar}),
  }]));
}
