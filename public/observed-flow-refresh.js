/* Presentation/transport only. Never recompute governed Flow evidence. */
(function (root) {
  'use strict';
  const unavailable = reason => ({ sourceState: 'UNAVAILABLE', unavailableReason: reason, windows: null });
  const parsed = value => typeof value === 'string' ? Date.parse(value) : NaN;
  function identity(value) {
    const i = value?.identity;
    const d = value?.delivery;
    const parts = [d?.runtimeCommit, d?.workerInstanceId, value?.source?.sourceMode,
      value?.lineage?.sourceLedgerIdentity, i?.instrument, i?.actualContract, i?.tradeDate, i?.session, i?.continuityEpoch];
    return parts.every(v => v != null && v !== '') ? JSON.stringify(parts) : null;
  }
  // Daily bars cover a trade date; Flow keeps its actual DAY/NIGHT source identity.
  // This is display compatibility only, never a continuity or quality override.
  function matchesChartIdentity(chart, flowIdentity) {
    if (!['actualContract', 'tradeDate'].every(key => typeof chart?.[key] === 'string'
        && chart[key] && chart[key] === flowIdentity?.[key])) return false;
    if (chart.timeframe === '1D') return chart.mode === 'LIVE'
      && chart.session === 'NIGHT_PLUS_DAY' && ['DAY', 'NIGHT'].includes(flowIdentity?.session);
    return typeof chart.session === 'string' && Boolean(chart.session)
      && chart.session === flowIdentity?.session;
  }
  function createFlowChannel({ now = Date.now, monotonic = () => performance.now(), request,
    render = () => {}, authenticated = () => true, visible = () => true, chartIdentity = () => null,
    onUnauthorized = () => {}, schedule = setTimeout, cancel = clearTimeout,
    cadenceMs = 5000, timeoutMs = 8000 } = {}) {
    let value = null, generation = 0, sequence = 0, accepted = 0, failure = null;
    let evidence = null;
    const retiredIdentities = new Set();
    let receivedMono = 0, receivedWall = 0, running = false, pending = null, pollTimer, ageTimer;
    const ticket = () => ({ generation, sequence: ++sequence });
    function view() {
      if (!value) return unavailable(failure || 'FLOW_WAITING_FOR_RESPONSE');
      if (failure) return { ...value, sourceState: 'UNAVAILABLE', unavailableReason: failure, windows: null };
      const chart = chartIdentity();
      if (chart?.actualContract && chart?.tradeDate && chart?.session && value.identity
          && !matchesChartIdentity(chart, value.identity)) {
        return { ...value, sourceState: 'UNAVAILABLE', unavailableReason: 'CHART_FLOW_IDENTITY_MISMATCH', windows: null };
      }
      if (!['LIVE', 'WARMING_UP'].includes(value.sourceState)) return value;
      if (!identity(value) || !Number.isSafeInteger(value.lineage?.cutoffLedgerOrdinal))
        return { ...value, sourceState: 'UNAVAILABLE', unavailableReason: 'FLOW_IDENTITY_UNVERIFIED', windows: null };
      const available = parsed(value.source?.availableAt), observed = parsed(value.source?.observedAt);
      const until = parsed(value.source?.validUntil), served = parsed(value.delivery?.servedAt);
      const elapsed = Math.max(0, monotonic() - receivedMono);
      const wall = now();
      const safeNow = Math.max(wall, receivedWall + elapsed, served + elapsed);
      if (![available, observed, until, served].every(Number.isFinite) || until < available
          || available > served + 5000 || observed > served + 5000
          || Math.abs(receivedWall - served) > 5000 || wall < receivedWall - 5000) {
        return { ...value, sourceState: 'UNAVAILABLE', unavailableReason: 'FLOW_TIME_UNVERIFIED', windows: null };
      }
      if (safeNow > until) return { ...value, sourceState: 'STALE', presentationReason: 'VALID_UNTIL_EXPIRED',
        windows: Object.fromEntries(Object.entries(value.windows || {}).map(([key, window]) =>
          [key, { ...window, truthState: 'STALE' }])) };
      return value;
    }
    const paint = () => render(view());
    function merge(next, token) {
      if (!token || token.generation !== generation || token.sequence < accepted) return false;
      const previousIdentity = identity(evidence), nextIdentity = identity(next);
      if (nextIdentity && retiredIdentities.has(nextIdentity)) return false;
      if (previousIdentity && previousIdentity === nextIdentity) {
        const oldOrdinal = evidence.lineage?.cutoffLedgerOrdinal, newOrdinal = next.lineage?.cutoffLedgerOrdinal;
        if (Number.isSafeInteger(oldOrdinal) && (!Number.isSafeInteger(newOrdinal) || newOrdinal < oldOrdinal)) return false;
        for (const key of ['availableAt', 'observedAt']) {
          const before = parsed(evidence.source?.[key]), after = parsed(next.source?.[key]);
          if (Number.isFinite(before) && (!Number.isFinite(after) || after < before)) return false;
        }
      }
      if (nextIdentity && Number.isSafeInteger(next.lineage?.cutoffLedgerOrdinal)
          && ['availableAt', 'observedAt'].every(key => Number.isFinite(parsed(next.source?.[key])))) {
        if (previousIdentity && previousIdentity !== nextIdentity) retiredIdentities.add(previousIdentity);
        evidence = next;
      }
      accepted = token.sequence;
      value = next || unavailable('FLOW_PAYLOAD_MISSING');
      failure = null; receivedMono = monotonic(); receivedWall = now(); paint(); return true;
    }
    function fail(reason, token = ticket()) {
      if (token.generation !== generation || token.sequence < accepted) return;
      accepted = token.sequence; failure = reason; paint();
    }
    function reset() {
      generation++; accepted = 0; value = null; evidence = null; retiredIdentities.clear(); failure = null;
      pending?.controller.abort(); paint();
    }
    async function poll() {
      if (!running || pending || !authenticated() || !visible()) return;
      const token = ticket(), controller = new AbortController();
      const slot = { controller }; pending = slot;
      const timer = schedule(() => controller.abort(), timeoutMs);
      try {
        const result = await request(controller.signal);
        if (token.generation === generation) merge(result.data, token);
      } catch (error) {
        if (token.generation === generation) {
          if (error.status === 401) { stop(); reset(); onUnauthorized(); }
          else fail(controller.signal.aborted ? 'FLOW_REQUEST_TIMEOUT' : (error.message || 'FLOW_REQUEST_FAILED'), token);
        }
      } finally {
        cancel(timer); if (pending === slot) pending = null;
        if (running && visible() && authenticated()) pollTimer = schedule(poll, cadenceMs);
      }
    }
    function age() { if (!running) return; if (visible()) paint(); ageTimer = schedule(age, 1000); }
    function start() { if (running) return; running = true; paint(); void poll(); ageTimer = schedule(age, 1000); }
    function stop() { running = false; cancel(pollTimer); cancel(ageTimer); pending?.controller.abort(); }
    function visibilityChanged() {
      cancel(pollTimer); paint();
      if (running && visible()) void poll();
      else pending?.controller.abort();
    }
    return { ticket, merge, view, fail, reset, start, stop, poll, visibilityChanged,
      isCurrentSession: token => token?.generation === generation };
  }
  root.Cru49Flow = Object.freeze({ createFlowChannel, matchesChartIdentity });
})(globalThis);
