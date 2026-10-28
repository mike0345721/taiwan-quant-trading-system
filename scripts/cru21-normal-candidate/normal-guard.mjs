// Isolated maintenance fixture only. No runtime adapter or operating-system control.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCT = Object.freeze({
  head: 'f221ee21448987ea5c675e36d82573c65dbbe09b',
  tree: 'fae6e3c9fda81fd4632fa5f3900542ade257ea1d',
  branch: 'codex/cru21-offline-compatibility-20261027',
  main: '4d8251686bdb4abbdb469bc00ae798717c0fd583',
});
export const DURATION_MS = 900_000;
export function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
export function runtimeGate() {
  return deepFreeze({ allowed: false, status: 'WINDOW_HOLD', evidenceClass: 'ISOLATED_FIXTURE', reasons: [
    'No live authority or accepted deadline fault model is active; isolated native evidence is not a live grant.',
    'Read-only AI status has scoped Windows evidence; normal account and browser behavior remain unverified.',
    'Prior controller and health-operation refusals remain unresolved; no retry is authorized.',
    'No real candidate window, startup adapter, login or network operation is authorized.',
  ] });
}
function requireValue(condition) {
  if (!condition) throw Object.assign(new Error('Fixture observation rejected.'), { code: 'CANDIDATE_OBSERVATION_INVALID' });
}
function sameIdentity(a, b) {
  return a && b && typeof a.path === 'string' && a.path === b.path && a.dev === b.dev && a.ino === b.ino;
}
export function assertObservation(ticket, observation) {
  requireValue(ticket?.mode === 'ISOLATED_FIXTURE' && ticket.runtimeAllowed === false && ticket.durationMs === DURATION_MS);
  requireValue(Object.entries(PRODUCT).every(([key, value]) => ticket.product?.[key] === value && observation?.product?.[key] === value));
  requireValue(observation.clean === true && observation.host === '127.0.0.1' && observation.port === 18722 && observation.dataMode === 'LIVE');
  requireValue(observation.normalAuth === true && observation.inlineEnabled === true && observation.privateWritesVerified === true);
  requireValue(observation.guest === false && observation.cru55 === false && observation.formalRouting === false);
  requireValue(/^[a-f0-9]{64}$/.test(ticket.binaryHash) && observation.binaryHash === ticket.binaryHash);
  requireValue(['normalGuard', 'supervisor', 'prepare'].every((name) => /^[a-f0-9]{64}$/.test(ticket.helperHashes?.[name]) && observation.helperHashes?.[name] === ticket.helperHashes[name]));
  requireValue(['sourceRoot', 'producerRoot', 'privateRoot'].every((name) => sameIdentity(ticket.bindings?.[name], observation.bindings?.[name])));
  // Caller observations are synthetic assertions, never Windows or live authorization.
  return deepFreeze({ valid: true, evidenceClass: 'ISOLATED_FIXTURE', runtimeAllowed: false });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.stderr.write(`${JSON.stringify(runtimeGate())}\n`);
  process.exitCode = 2;
}
