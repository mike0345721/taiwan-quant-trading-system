// This process only: use existing Windows trust, never disable TLS validation.
// https://nodejs.org/api/tls.html#tlssetdefaultcacertificatescerts
import tls from 'node:tls';
import {PlanError} from './chatgpt-plan-auth.mjs';
export function configurePlanTransport({platform=process.platform,tlsApi=tls,env=process.env}={}) {
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new PlanError('TLS_VERIFICATION_DISABLED');
  if(platform!=='win32')return {policy:'NODE_DEFAULT_CA',verificationRequired:true};
  if(typeof tlsApi.getCACertificates!=='function'||typeof tlsApi.setDefaultCACertificates!=='function')throw new PlanError('SYSTEM_CA_RUNTIME_UNSUPPORTED');
  const defaults=tlsApi.getCACertificates('default');
  const system=tlsApi.getCACertificates('system');
  if(!Array.isArray(defaults)||!Array.isArray(system)||!defaults.length)throw new PlanError('SYSTEM_CA_UNAVAILABLE');
  tlsApi.setDefaultCACertificates([...new Set([...defaults,...system])]);
  return {policy:'WINDOWS_SYSTEM_AND_NODE_DEFAULT_CA',verificationRequired:true};
}
