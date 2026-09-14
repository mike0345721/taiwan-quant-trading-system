import http from 'node:http';
import crypto from 'node:crypto';
import { FRAMES, withFreshness, CHART_LIMITS } from './cvd-chart-projection.mjs';
import { SAFETY } from './cvd-observation-core.mjs';

// This handler receives a bounded, already verified memory projection and fixed assets only.
// It has no ledger path, fs dependency, collector or materializer call.
export function createCvdCandidateServer({ frames, relationships = null, handoffs = null, assets, head, port = 3054, token = crypto.randomBytes(32).toString('hex') }) {
  const previewType = handoffs ? 'ISOLATED_PHASE_D' : relationships ? 'ISOLATED_PHASE_C' : 'ISOLATED_PHASE_B';
  const cookie = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const expectedHost = `127.0.0.1:${port}`;
  const json = (res, status, value) => { const bytes = JSON.stringify(value); if (Buffer.byteLength(bytes) > CHART_LIMITS.responseBytes + 2048) throw Error('CVD_HTTP_RESPONSE_BUDGET'); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(bytes); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const actualHost = port === 0 ? `127.0.0.1:${server.address().port}` : expectedHost;
      if (req.headers.host !== actualHost || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || (req.headers.origin && req.headers.origin !== `http://${actualHost}`)
        || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return json(res, 403, { reason: 'CANDIDATE_ORIGIN_REFUSED' });
      if ((req.url || '').length > 512) return json(res, 414, { reason: 'REQUEST_TOO_LONG' });
      const url = new URL(req.url, `http://${actualHost}`);
      if (Date.now() >= expiresAt && (url.pathname.startsWith('/api/') || url.pathname === '/session')) return json(res, 401, { reason: 'CANDIDATE_SESSION_EXPIRED' });
      if (url.pathname === '/session' && req.method === 'POST') {
        if (req.headers.origin !== `http://${actualHost}` || req.headers['content-type'] !== 'text/plain') return json(res, 403, { reason: 'SESSION_ORIGIN_REQUIRED' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 128) return json(res, 413, { reason: 'SESSION_BODY_TOO_LARGE' }); }
        if (body.length !== token.length || !crypto.timingSafeEqual(Buffer.from(body), Buffer.from(token))) return json(res, 401, { reason: 'CANDIDATE_SESSION_REQUIRED' });
        res.setHeader('Set-Cookie', `cru54=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return json(res, 200, { state: 'ISOLATED_SESSION' });
      }
      if (req.method !== 'GET') return json(res, 405, { reason: 'READ_ONLY_CANDIDATE' });
      if (url.pathname.startsWith('/api/')) {
        if (!(req.headers.cookie || '').split(';').some(c => c.trim() === `cru54=${cookie}`)) return json(res, 401, { reason: 'CANDIDATE_SESSION_REQUIRED' });
        if (url.pathname === '/api/identity') return json(res, 200, { head, previewType, ...SAFETY, sourceMode: 'PINNED_HISTORICAL_GENERATION', rawReadsPerRequest: 0 });
        if (url.pathname !== '/api/cvd' && !(relationships && url.pathname === '/api/relationship') && !(handoffs && url.pathname === '/api/handoff')) return json(res, 404, { reason: 'ROUTE_UNAVAILABLE' });
        if ([...url.searchParams.keys()].some(k => k !== 'timeframe') || url.searchParams.getAll('timeframe').length > 1) return json(res, 400, { reason: 'QUERY_UNSUPPORTED' });
        const timeframe = url.searchParams.get('timeframe') || '1m';
        if (!FRAMES.includes(timeframe)) return json(res, 400, { reason: 'CVD_CHART_TIMEFRAME_INVALID' });
        const projection = frames[timeframe];
        if (!projection) return json(res, 503, { state: 'UNAVAILABLE', reason: 'CVD_PROJECTION_MISSING', ...SAFETY });
        if (url.pathname === '/api/handoff') {
          const handoff = handoffs[timeframe];
          if (!handoff || handoff.generationHash !== projection.generationHash || handoff.semanticHash !== projection.semanticHash
            || handoff.sourceCutoff?.recordHash !== projection.cutoff.recordHash || handoff.timeframe !== timeframe) return json(res,503,{ reason:'HANDOFF_PROJECTION_MISSING', ...SAFETY });
          return json(res,200,{ ...handoff, freshness:withFreshness(projection).freshness, head, previewType, rawReadsPerRequest:0 });
        }
        if (url.pathname === '/api/relationship') {
          const relationship = relationships[timeframe];
          if (!relationship || relationship.generationHash !== projection.generationHash) return json(res, 503, { reason: 'RELATIONSHIP_PROJECTION_MISSING', ...SAFETY });
          return json(res, 200, { ...relationship, freshness: withFreshness(projection).freshness, head, previewType });
        }
        return json(res, 200, { ...withFreshness(projection), head, previewType });
      }
      const asset = assets[url.pathname];
      if (!asset) return json(res, 404, { reason: 'ROUTE_UNAVAILABLE' });
      res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.body);
    } catch { if (!res.headersSent) json(res, 500, { reason: 'CANDIDATE_REQUEST_FAILED' }); else res.destroy(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  return { server, token };
}
