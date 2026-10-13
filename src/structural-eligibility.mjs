// A calculation capability, never a replacement for the original quality status.
export function hasSourceTimeGeometry(value) {
  const proof = value?.structureEligibility;
  return proof?.schemaVersion === 'source-time-structure-v1'
    && proof.state === 'ELIGIBLE'
    && proof.basis === 'REPORTED_SOURCE_TIME_GEOMETRY'
    && proof.scope === 'LIVE_DESCRIPTIVE_ONLY'
    && proof.executionAuthorized === false
    && Number.isFinite(Date.parse(proof.availableAt))
    && ['PASS', 'QUALITY_INSUFFICIENT'].includes(value.qualityStatus)
    && (value.qualityStatus === 'PASS' || value.qualityReasons?.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'))
    && (value.qualityReasons || []).every(reason => reason === 'TIMESTAMP_LINEAGE_INSUFFICIENT');
}

export function isStructureEligible(value) {
  return value?.structureEligibility ? hasSourceTimeGeometry(value) : value?.qualityStatus === 'PASS';
}
