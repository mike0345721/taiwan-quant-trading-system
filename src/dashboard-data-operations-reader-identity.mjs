import { resolveOperationsReader } from './data-operations-binding.mjs';

const schemaVersion = 'data-operations-reader-identity-v1';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Resolve only the bounded manifest/calendar binding. This must never load the
// operations report, ledger, database contents or change runtime readiness.
export function readDataOperationsReaderIdentity({ candidateReadOnly, ...readerOptions }, resolveReader = resolveOperationsReader) {
  if (candidateReadOnly !== true) return null;
  const unverified = () => ({ schemaVersion, state: 'UNVERIFIED', reasonCodes: ['DATA_OPERATIONS_READER_UNVERIFIED'] });
  if (!readerOptions.manifestPath) return unverified();
  try {
    const identity = resolveReader(readerOptions)?.bindingIdentity;
    if (!hash(identity?.manifestSha256) || !hash(identity?.calendarSha256)) return unverified();
    return { schemaVersion, state: 'VALIDATED', bindingIdentity: {
      manifestSha256: identity.manifestSha256, calendarSha256: identity.calendarSha256,
    } };
  } catch {
    // Paths, parsing errors and underlying filesystem details are not public.
    return unverified();
  }
}
