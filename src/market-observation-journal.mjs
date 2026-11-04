import { createDecisionSnapshot,decisionDigest } from './dashboard-decision-workspace.mjs';
import { OBSERVATION_VERSION } from './market-observation-core.mjs';

// The existing manual journal and Outcome chain remain the only durable user-event store.
export function observationDecisionSnapshot(observation){
  if(observation?.schemaVersion!==OBSERVATION_VERSION||!observation.snapshotId||!observation.identity
    ||observation.researchOnly!==true||observation.formalWeight!==0||observation.executionAuthorized!==false||observation.orderRoutesEnabled!==false)return null;
  const identity=observation.identity;
  const cutoff=new Date(observation.cutoff).toISOString();
  const lastTradeAt=observation.cvd.series?.at(-1)?.availableAt??null;
  const base=createDecisionSnapshot({dataHealth:{items:[]},snapshotTime:observation.cutoff,
    chart:{actualContract:identity.actualContract,tradeDate:identity.tradeDate,session:identity.session,
      availableAt:lastTradeAt,asOf:cutoff,lastPrice:observation.price.last,bars:observation.price.bars.slice(-1)}});
  const {snapshotHash,...body}=base;
  body.marketObservation={snapshotId:observation.snapshotId,cutoff,identity,timeframe:observation.timeframe,
    mode:observation.mode,summary:observation.summary,rules:observation.rules,reasonCodes:observation.reasonCodes,
    cvd:{value:observation.cvd.value,observedStart:observation.cvd.observedStart,classifiedCoverage:observation.cvd.classifiedCoverage,unknownVolume:observation.cvd.unknownVolume},
    profile:{poc:observation.profile.poc,vah:observation.profile.vah,val:observation.profile.val,binSize:observation.profile.binSize,
      valueAreaFraction:observation.profile.valueAreaFraction,partial:observation.profile.partial,observedStart:observation.profile.observedStart,observedEnd:observation.profile.observedEnd},
    events:observation.events.slice(-100),eventRetention:'LAST_100_DISPLAYED; SOURCE_SNAPSHOT_HASH_RETAINED',
    researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false};
  return {...body,snapshotHash:decisionDigest(body)};
}
