// CRU-21: official SIWC public-client prerequisite; no dashboard/broker imports.
// Contract: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export const APP_NAME = 'Taiwan Quant Dashboard';
const nonce = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class PlanError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new PlanError(code); };
export function publicError(error) { return error instanceof PlanError ? error.code : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'REQUEST_TIMED_OUT' : 'REQUEST_FAILED'; }
function issued(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,200}$/.test(id) && id !== 'dynamic_agent_client'; }
export function prepareAuthorization({ hostId, redirectUri, browserSession, saved = null, now = Date.now() }) {
  const callback = new URL(redirectUri);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/auth/callback' || callback.search || callback.hash || callback.username || callback.password) fail('INVALID_LOOPBACK_CALLBACK');
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(hostId) || !browserSession) fail('INVALID_HOST_OR_SESSION');
  if (saved && !issued(saved.client_id)) fail('INVALID_SAVED_CLIENT');
  const state = nonce(), oidcNonce = nonce(), verifier = nonce();
  const pending = { state, oidcNonce, verifier, redirectUri, browserSession, saved, expiresAt: now + 600_000, consumed: false };
  const url = new URL(ISSUER + '/api/accounts/authorize');
  const params = { client_id: saved?.client_id || 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: RESOURCE, state, nonce: oidcNonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
  if (!saved) params.agent_name_hint = APP_NAME;
  // Do not expose retained ID-token hints to application JavaScript or diagnostics.
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { pending, url: url.href };
}
export function consumeCallback(pending, callbackUrl, browserSession, now = Date.now()) {
  if (!pending || pending.consumed) fail('AUTH_ATTEMPT_MISSING_OR_USED');
  const url = new URL(callbackUrl);
  if (url.origin + url.pathname !== pending.redirectUri) fail('CALLBACK_MISMATCH');
  for (const key of ['state', 'code', 'client_id', 'error']) if (url.searchParams.getAll(key).length > 1) fail('DUPLICATE_CALLBACK_PARAMETER');
  if (!same(browserSession, pending.browserSession) || !same(url.searchParams.get('state'), pending.state)) fail('AUTH_STATE_MISMATCH');
  pending.consumed = true; // Consume before network operations; never reuse a code.
  if (now > pending.expiresAt) fail('AUTH_ATTEMPT_EXPIRED');
  if (url.searchParams.has('error')) fail('AUTHORIZATION_DECLINED');
  const clientId = url.searchParams.get('client_id') || pending.saved?.client_id;
  if (!issued(clientId)) fail('ISSUED_CLIENT_ID_MISSING');
  if (pending.saved && clientId !== pending.saved.client_id) fail('CLIENT_ID_MISMATCH');
  const code = url.searchParams.get('code');
  if (!code || code.length > 8192) fail('AUTH_CODE_MISSING');
  return { clientId, code, verifier: pending.verifier, redirectUri: pending.redirectUri, oidcNonce: pending.oidcNonce, saved: pending.saved };
}
export function validateIdToken(token, jwks, { clientId, oidcNonce, expectedSubject, now = Date.now() }) {
  try {
    if (typeof token !== 'string' || token.length > 32_768) fail('ID_TOKEN_INVALID');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) fail('ID_TOKEN_INVALID');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || header.crit || typeof header.kid !== 'string') fail('ID_TOKEN_ALGORITHM_REJECTED');
    const keys = (jwks?.keys || []).filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig') && (!k.key_ops || k.key_ops.includes('verify')));
    if (keys.length !== 1) fail('ID_TOKEN_KEY_NOT_FOUND');
    const key = createPublicKey({ key: keys[0], format: 'jwk' });
    if (key.asymmetricKeyDetails?.modulusLength < 2048 || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) fail('ID_TOKEN_SIGNATURE_INVALID');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== ISSUER || !aud.includes(clientId) || (aud.length > 1 && payload.azp !== clientId) || (payload.azp && payload.azp !== clientId)) fail('ID_TOKEN_IDENTITY_INVALID');
    const seconds = now / 1000;
    if (!Number.isFinite(payload.exp) || payload.exp <= seconds || !Number.isFinite(payload.iat) || payload.iat > seconds + 60 || (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > seconds + 60))) fail('ID_TOKEN_EXPIRED_OR_EARLY');
    if (!same(payload.nonce, oidcNonce) || typeof payload.sub !== 'string' || !payload.sub || (expectedSubject && expectedSubject !== payload.sub)) fail('ID_TOKEN_NONCE_OR_ACCOUNT_MISMATCH');
    return { issuer: payload.iss, subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
  } catch (error) { if (error instanceof PlanError) throw error; fail('ID_TOKEN_INVALID'); }
}
async function boundedJson(response) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 1_048_576) fail('UPSTREAM_BODY_TOO_LARGE'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('UPSTREAM_INVALID_JSON'); }
}
async function requestJson(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); fail(response.status === 401 ? 'AUTHENTICATION_REJECTED' : response.status === 403 ? 'PLAN_ACCESS_DENIED' : response.status === 429 ? 'USAGE_LIMIT_OR_RATE_LIMIT' : 'UPSTREAM_REQUEST_FAILED'); }
  return boundedJson(response);
}
export async function discovery(fetcher = fetch) {
  const config = await requestJson(ISSUER + '/.well-known/openid-configuration', {}, fetcher);
  if (config.issuer !== ISSUER || config.authorization_endpoint !== ISSUER + '/api/accounts/authorize' || config.token_endpoint !== ISSUER + '/api/accounts/oauth/token' || config.jwks_uri !== ISSUER + '/.well-known/jwks.json') fail('DISCOVERY_ENDPOINT_MISMATCH');
  if (!config.id_token_signing_alg_values_supported?.includes('RS256')) fail('ID_TOKEN_ALGORITHM_UNSUPPORTED');
  return config;
}
export async function exchangeAuthorization(transaction, { fetcher = fetch, now = Date.now() } = {}) {
  await discovery(fetcher);
  const raw = await requestJson(ISSUER + '/api/accounts/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: transaction.clientId, code: transaction.code, code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE }) }, fetcher);
  if (raw.token_type?.toLowerCase() !== 'bearer' || typeof raw.access_token !== 'string' || !raw.access_token || typeof raw.id_token !== 'string' || !Number.isFinite(raw.expires_in) || raw.expires_in <= 0 || raw.expires_in > 86400) fail('TOKEN_RESPONSE_INVALID');
  const jwks = await requestJson(ISSUER + '/.well-known/jwks.json', {}, fetcher);
  const identity = validateIdToken(raw.id_token, jwks, { clientId: transaction.clientId, oidcNonce: transaction.oidcNonce, expectedSubject: transaction.saved?.subject, now });
  const scopes = typeof raw.scope === 'string' ? raw.scope.split(/\s+/).filter(Boolean) : [];
  return { ...identity, client_id: transaction.clientId, access_token: raw.access_token, refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : null, id_token: raw.id_token, scopes, expiresAt: now + raw.expires_in * 1000, savedAt: new Date(now).toISOString() };
}
export function requirePlanPermission(record, now = Date.now()) {
  if (!record || !issued(record.client_id) || !record.subject || !record.access_token) fail('SIGN_IN_REQUIRED');
  if (!record.scopes?.includes(DIRECT_SCOPE) || !record.scopes.includes('resource.invoke')) fail('PLAN_PERMISSION_NOT_GRANTED');
  // This prerequisite deliberately has no unattended renewal or background requests.
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now + 30_000) fail('REAUTHORIZE_REQUIRED');
}
export async function listPlanModels(record, fetcher = fetch) {
  requirePlanPermission(record);
  const payload = await requestJson(RESOURCE + '/models', { headers: { Authorization: 'Bearer ' + record.access_token } }, fetcher);
  if (!Array.isArray(payload.models)) fail('MODEL_CATALOG_UNSUPPORTED');
  const models = payload.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(m.slug) && typeof m.display_name === 'string').map(m => ({ slug: m.slug, display_name: m.display_name.slice(0,150) }));
  if (!models.length) fail('NO_DISPLAYABLE_MODELS');
  return models;
}
export async function consumeResponseStream(body) {
  const decoder = new TextDecoder(); let buffer = '', bytes = 0, text = '', terminal = null;
  const handle = block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event; try { event = JSON.parse(data); } catch { fail('STREAM_INVALID_JSON'); }
    if (event.type === 'response.output_text.delta') { text += event.delta || ''; if (text.length > 8192) fail('PROBE_OUTPUT_LIMIT'); }
    if (event.type === 'response.failed' || event.type === 'error') fail(event.response?.error?.code === 'subscription_sharing_usage_limit_exceeded' ? 'PLAN_USAGE_LIMIT_REACHED' : event.response?.error?.code === 'subscription_sharing_usage_unavailable' ? 'PLAN_USAGE_UNAVAILABLE' : 'MODEL_RESPONSE_FAILED');
    if (event.type === 'response.incomplete') fail('MODEL_RESPONSE_INCOMPLETE');
    if (event.type === 'response.completed') { if (terminal || event.response?.status !== 'completed') fail('MODEL_TERMINAL_INVALID'); terminal = event.response; }
  };
  for await (const chunk of body) {
    bytes += chunk.length; if (bytes > 1_048_576) fail('STREAM_TOO_LARGE');
    buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
    let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { handle(buffer.slice(0,boundary)); buffer = buffer.slice(boundary+2); }
  }
  buffer += decoder.decode(); if (buffer.trim()) handle(buffer);
  if (!terminal || !text.trim()) fail('STREAM_INTERRUPTED');
  return { text, requestId: terminal.id || null, model: terminal.model || null, usage: terminal.usage || null, terminal: 'response.completed' };
}
export async function probePlanInference(record, model, { creditsDisabledConfirmed = false, fetcher = fetch } = {}) {
  requirePlanPermission(record);
  if (!creditsDisabledConfirmed) fail('CREDITS_SETTING_CONFIRMATION_REQUIRED');
  const models = await listPlanModels(record, fetcher);
  if (!models.some(m => m.slug === model)) fail('MODEL_NOT_IN_ACCOUNT_CATALOG');
  const response = await fetcher(RESOURCE + '/responses', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { Authorization: 'Bearer ' + record.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, instructions: 'This is a connectivity test, not market analysis. Reply briefly in Traditional Chinese. Do not use tools.', input: [{ role: 'user', content: '請只回覆：訂閱模型連線已驗證。' }], store: false, stream: true }) });
  if (!response.ok) { await response.body?.cancel(); fail(response.status === 429 ? 'USAGE_LIMIT_OR_RATE_LIMIT' : response.status === 401 ? 'AUTHENTICATION_REJECTED' : 'MODEL_REQUEST_REJECTED'); }
  return consumeResponseStream(response.body);
}
