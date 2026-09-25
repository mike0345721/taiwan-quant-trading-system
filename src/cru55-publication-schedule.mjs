// Explicit opt-in: scheduling changes publication history, never verification.
export const CATCHUP_PUBLICATION_SCHEDULE = Object.freeze({version:'COMPLETE_RECORD_PREFIX_V1',maxRecords:32768});
export function validatePublicationSchedule(value){
  if(value===null||value===undefined)return null;
  if(!value||Object.keys(value).sort().join(',')!=='maxRecords,version'
    ||value.version!==CATCHUP_PUBLICATION_SCHEDULE.version
    ||!Number.isSafeInteger(value.maxRecords)||value.maxRecords<1||value.maxRecords>32768)throw Error('STREAM_PUBLICATION_SCHEDULE_INVALID');
  return {version:value.version,maxRecords:value.maxRecords};
}
