import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const APPROVED = Object.freeze({
  ownerBriefHash: 'c144144ef1e14564f2003993cf3b8bd7267c59cddad3546014d0fd8ea79a4d67',
  draftManifestHash: '65f5e1b46b50cbef8d79546cb2522f06700f465f60314895f05055d796c0e4ad',
  validationEvidenceHash: '39b2733a1af109076c0baad2aca0284cc13dbf14c00a0deff60ac21aa2e47b00',
  baselineFreezeHash: '9664ca8777cfdf827e6383b952ac006f7577f59c0abe86e7182d44e8dd2451cf',
});

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, canonicalJson(value), { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

export function contractCompleteness(contractsById) {
  const issues = [];
  const requireValue = (contractId, label, value) => {
    if (value === undefined || value === null || value === '') {
      issues.push({ contractId, field: label, severity: 'HARD_FAIL', reason: 'MISSING_EXECUTION_SEMANTIC' });
    }
  };

  const threshold = contractsById.THRESHOLD;
  requireValue('THRESHOLD', 'quantileMethod', threshold?.quantileMethod);
  requireValue('THRESHOLD', 'tieMethod', threshold?.tieMethod);
  requireValue('THRESHOLD', 'scorePrecision', threshold?.scorePrecision);
  requireValue('THRESHOLD', 'nullHandling', threshold?.nullHandling);

  const bootstrap = contractsById.BOOTSTRAP_INFERENCE;
  requireValue('BOOTSTRAP_INFERENCE', 'prngAlgorithm', bootstrap?.prngAlgorithm);
  requireValue('BOOTSTRAP_INFERENCE', 'hashToSeedMapping', bootstrap?.hashToSeedMapping);
  requireValue('BOOTSTRAP_INFERENCE', 'canonicalSerialization', bootstrap?.canonicalSerialization);
  requireValue('BOOTSTRAP_INFERENCE', 'numericPrecision', bootstrap?.numericPrecision);
  requireValue('BOOTSTRAP_INFERENCE', 'unavailableRepresentation', bootstrap?.unavailableRepresentation);

  const negative = contractsById.NEGATIVE_CONTROL_EXACT;
  requireValue('NEGATIVE_CONTROL_EXACT', 'withinFoldScorePermutation.algorithm', negative?.withinFoldScorePermutation?.algorithm);
  requireValue('NEGATIVE_CONTROL_EXACT', 'withinFoldScorePermutation.hashToSeedMapping', negative?.withinFoldScorePermutation?.hashToSeedMapping);
  requireValue('NEGATIVE_CONTROL_EXACT', 'randomFeatureControl.generationAlgorithm', negative?.randomFeatureControl?.generationAlgorithm);
  requireValue('NEGATIVE_CONTROL_EXACT', 'randomFeatureControl.distribution', negative?.randomFeatureControl?.distribution);
  requireValue('NEGATIVE_CONTROL_EXACT', 'randomFeatureControl.hashToSeedMapping', negative?.randomFeatureControl?.hashToSeedMapping);

  return {
    status: issues.length ? 'HARD_FAIL' : 'PASS',
    executable: issues.length === 0,
    issueCount: issues.length,
    issues,
  };
}

