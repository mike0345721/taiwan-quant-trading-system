import { Worker } from 'node:worker_threads';
import { CHART_BAR_CONTRACT } from './dashboard-tx-chart.mjs';
import { createTxChartReadBudget } from './dashboard-tx-chart-source.mjs';

const frames = new Set(CHART_BAR_CONTRACT.supportedTimeframes);
function normalize(input = {}) {
  const timeframe = input.timeframe || '5m', mode = input.mode || 'LIVE';
  if (!frames.has(timeframe) || !['LIVE','REPLAY'].includes(mode)) throw Error('CHART_SELECTION_INVALID');
  const value = { timeframe, mode, tradeDate: input.tradeDate || null, session: input.session || null,
    actualContract: input.actualContract || null, asOf: input.asOf || null };
  if (value.tradeDate && !/^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate)) throw Error('CHART_SELECTION_INVALID');
  if (value.session && !['DAY','NIGHT'].includes(value.session)) throw Error('CHART_SELECTION_INVALID');
  if (value.actualContract && !/^TXF[A-L]\d$/.test(value.actualContract)) throw Error('CHART_SELECTION_INVALID');
  if (value.asOf && (typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf)))) throw Error('CHART_SELECTION_INVALID');
  return value;
}
function unavailable(selection, reason) {
  return { schemaVersion:'governed-tx-decision-chart-v2', barContract:CHART_BAR_CONTRACT,
    ...selection, status:'UNAVAILABLE', reason, qualityStatus:'UNAVAILABLE', qualityReasons:[reason],
    bars:[],vwap:[],levels:{},availableAt:null,sourceComplete:false,sourceReadState:'UNAVAILABLE',
    formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false };
}

export function createTxChartService({ dataRoot, cacheRoot = null, calendar, sourceLimits = {},
  requestTimeoutMs = 8000, idleTimeoutMs = 30000, maxQueue = 1, cacheTtlMs = 1000,
  peekMaxAgeMs = 10000, maxCacheEntries = 8,
  workerFactory = (url, options) => new Worker(url, options), clock = () => Date.now(),
} = {}) {
  if (!dataRoot || !calendar) throw Error('CHART_SERVICE_CONFIG_INVALID');
  for (const value of [requestTimeoutMs,idleTimeoutMs,peekMaxAgeMs,maxCacheEntries]) {
    if (!Number.isSafeInteger(value) || value < 1) throw Error('CHART_SERVICE_LIMIT_INVALID');
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 1
      || !Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > peekMaxAgeMs
      || maxCacheEntries > 16 || requestTimeoutMs > 15000 || idleTimeoutMs > 60000) throw Error('CHART_SERVICE_LIMIT_INVALID');
  createTxChartReadBudget(sourceLimits);
  const base = structuredClone({ dataRoot,cacheRoot,calendar,sourceLimits });
  const cached = new Map(), pending = new Map();
  let worker = null, terminating = null, active = null, queued = null, sequence = 0, idleTimer = null, closed = false;

  function settle(job, chart) {
    if (!job || job.settled) return;
    job.settled = true; clearTimeout(job.timer); pending.delete(job.key); job.resolve(chart);
  }
  function stop(reason) {
    clearTimeout(idleTimer); idleTimer = null;
    const previous = worker; worker = null;
    settle(active, unavailable(active?.selection || {}, reason));
    settle(queued, unavailable(queued?.selection || {}, reason)); active = null; queued = null;
    if (previous) {
      // Keep the single-worker fence until the old thread has actually exited.
      // A failed termination remains fenced; it cannot authorize another worker.
      const barrier = {}; terminating = barrier;
      previous.once('exit',()=>{ if(terminating===barrier) terminating=null; });
      try { Promise.resolve(previous.terminate()).then(()=>{ if(terminating===barrier) terminating=null; },()=>{}); } catch {}
    }
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(()=>{ if (!active && !queued) stop('CHART_WORKER_IDLE'); },idleTimeoutMs);
    idleTimer.unref?.();
  }
  function start(job) {
    clearTimeout(idleTimer); active = job;
    try {
      if (!worker) {
        const created = workerFactory(new URL('./dashboard-tx-chart-worker.mjs',import.meta.url), {
          workerData: base,
          // The parent can run with --env-file. Never inherit that flag or env.
          env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb:256, maxYoungGenerationSizeMb:32 },
          stdout:true, stderr:true,
        });
        worker = created;
        created.stdout?.on('data',()=>{}); created.stderr?.on('data',()=>{});
        created.on('error',()=>{ if(worker===created) stop('CHART_WORKER_UNAVAILABLE'); });
        created.on('exit',()=>{ if(worker===created) stop('CHART_WORKER_UNAVAILABLE'); });
        created.on('message',message=>{
          if(worker!==created || !active || message.id!==active.id) return;
          const completed = active; active = null;
          const chart = message.chart && message.chart.timeframe === completed.selection.timeframe
            ? message.chart : unavailable(completed.selection,message.error || 'CHART_CALCULATION_UNAVAILABLE');
          cached.delete(completed.key); cached.set(completed.key,{chart,receivedAt:clock()});
          while(cached.size > maxCacheEntries) cached.delete(cached.keys().next().value);
          settle(completed,chart);
          const next = queued; queued = null;
          if(next && !next.settled) start(next); else armIdle();
        });
      }
      worker.postMessage({ id:job.id, selection:job.selection });
    } catch { stop('CHART_WORKER_UNAVAILABLE'); }
  }
  return Object.freeze({
    load(input={}) {
      let selection;
      try { selection=normalize(input); } catch { return Promise.resolve(unavailable({timeframe:input?.timeframe || '5m',mode:'LIVE'},'CHART_SELECTION_INVALID')); }
      if(closed) return Promise.resolve(unavailable(selection,'CHART_SERVICE_CLOSED'));
      if(terminating) return Promise.resolve(unavailable(selection,'CHART_WORKER_RESTARTING'));
      const key=JSON.stringify(selection), existing=pending.get(key);
      if(existing) return existing.promise;
      const previous=cached.get(key);
      if(previous && clock()-previous.receivedAt >= 0 && clock()-previous.receivedAt < cacheTtlMs) return Promise.resolve(previous.chart);
      if(active && (maxQueue===0 || queued)) return Promise.resolve(unavailable(selection,'CHART_REQUEST_BUSY'));
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      const job={id:++sequence,key,selection,promise,resolve,settled:false};
      pending.set(key,job);
      // Deadline includes time in the bounded waiting slot.
      job.timer=setTimeout(()=>{
        if(active===job) stop('CHART_REQUEST_TIMEOUT');
        else { if(queued===job) queued=null; settle(job,unavailable(selection,'CHART_REQUEST_TIMEOUT')); }
      },requestTimeoutMs);
      if(active) queued=job; else start(job);
      return promise;
    },
    peek(input={}) {
      let selection;
      try { selection=normalize(input); } catch { return unavailable({timeframe:'5m',mode:'LIVE'},'CHART_SELECTION_INVALID'); }
      const value=cached.get(JSON.stringify(selection));
      if(!value) return unavailable(selection,'CHART_NOT_READY');
      const age=clock()-value.receivedAt;
      if(age<0 || age>peekMaxAgeMs) return unavailable(selection,'CHART_SNAPSHOT_STALE');
      return value.chart;
    },
    close() { closed=true; stop('CHART_SERVICE_CLOSED'); cached.clear(); },
  });
}
