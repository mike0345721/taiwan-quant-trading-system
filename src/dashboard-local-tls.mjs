// Explicit MSI-local market/research release. No account-store or broker access.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { Socket } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertMarketCandidateMode } from './cru21-market-candidate.mjs';

export const LOCAL_MARKET_SCOPE = 'MARKET_RESEARCH_AI_DISABLED';
const fail = code => { throw Error(code); };

export function assertLocalMarketMode(env, config) {
  const declared = env.DASHBOARD_RELEASE_SCOPE;
  if (!declared) {
    if (env.DASHBOARD_TLS_BUNDLE || env.DASHBOARD_TLS_CERT_SHA256) fail('LOCAL_TLS_SCOPE_REQUIRED');
    return false;
  }
  if (declared !== LOCAL_MARKET_SCOPE || config.host !== '127.0.0.1' || config.port !== 8787
      || config.nodeEnv !== 'production' || !config.cookieSecure || config.mockData
      || env.ASK_GPT_INLINE_ENABLED !== '0' || config.trustProxy
      || config.cru55Candidate || config.cru55Acceptance
      || env.DASHBOARD_PREVIEW_TYPE || env.CRU21_GUEST_ENABLED === '1'
      || Object.entries(env).some(([key,value]) => value && /^(CRU55_|FORWARD_SHADOW_)/i.test(key))
      || env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.NODE_OPTIONS) fail('LOCAL_MARKET_MODE_REJECTED');
  if (!path.isAbsolute(env.DASHBOARD_TLS_BUNDLE || '')
      || /^[\\/]{2}/.test(env.DASHBOARD_TLS_BUNDLE || '')
      || !/^[a-f0-9]{64}$/.test(env.DASHBOARD_TLS_CERT_SHA256 || '')) fail('LOCAL_TLS_IDENTITY_REQUIRED');
  return true;
}

// DPAPI is used only on this deployment's encrypted TLS bundle, never an AI/broker store.
export function unprotectLocalBytes(encrypted) {
  if (process.platform !== 'win32') fail('LOCAL_TLS_WINDOWS_REQUIRED');
  const shell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; try { $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::OpenStandardOutput().Write($p,0,$p.Length); [Array]::Clear($p,0,$p.Length) } catch { [Console]::Error.WriteLine('LOCAL_DPAPI_FAILED'); exit 2 }";
  try {
    return execFileSync(shell, ['-NoProfile','-NonInteractive','-Command',command], {
      input:encrypted.toString('base64'), timeout:15_000, maxBuffer:256*1024, windowsHide:true,
      stdio:['pipe','pipe','pipe'], env:{SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,
        LOCALAPPDATA:process.env.LOCALAPPDATA,APPDATA:process.env.APPDATA,TEMP:process.env.TEMP,TMP:process.env.TMP},
    });
  } catch { fail('LOCAL_DPAPI_FAILED'); }
}

export function readLocalProtectedBytes(file, unprotect=unprotectLocalBytes, {expectedSha256}={}) {
  if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file)) fail('LOCAL_TLS_PATH_ALIAS');
  const absolute=path.resolve(file);
  let current=absolute;
  for (;;) {
    const st=fs.lstatSync(current);
    if (st.isSymbolicLink()) fail('LOCAL_TLS_PATH_ALIAS');
    const parent=path.dirname(current); if(parent===current)break; current=parent;
  }
  if (fs.realpathSync.native(absolute).toLowerCase()!==absolute.toLowerCase()) fail('LOCAL_TLS_PATH_ALIAS');
  const fd=fs.openSync(absolute,'r');
  try {
    const before=fs.fstatSync(fd);
    if(!before.isFile() || before.nlink!==1 || before.size<1 || before.size>128*1024) fail('LOCAL_TLS_FILE_REJECTED');
    const encrypted=fs.readFileSync(fd), after=fs.fstatSync(fd), named=fs.statSync(absolute);
    if(before.size!==after.size || before.mtimeMs!==after.mtimeMs || before.ino!==named.ino || before.dev!==named.dev) fail('LOCAL_TLS_FILE_CHANGED');
    if(expectedSha256 && createHash('sha256').update(encrypted).digest('hex')!==expectedSha256) fail('LOCAL_TLS_BUNDLE_HASH_REJECTED');
    return unprotect(encrypted);
  } finally {fs.closeSync(fd);}
}

// Inspect the actual PFX leaf through documented TLS APIs without opening a
// listener or making a connection. A separate PEM cannot attest another PFX.
export function assertLocalPfxIdentity(pfx, passphrase, certificate) {
  const options={pfx,passphrase,minVersion:'TLSv1.2'};
  let socket, transport;
  try {
    const secureContext=createSecureContext(options);
    transport=new Socket();
    socket=new TLSSocket(transport,{isServer:true,secureContext});
    const actual=socket.getX509Certificate();
    if(!actual || !actual.raw.equals(certificate.raw)) fail('LOCAL_TLS_PFX_IDENTITY_REJECTED');
    return options;
  } catch { fail('LOCAL_TLS_PFX_IDENTITY_REJECTED'); }
  finally {socket?.destroy();transport?.destroy();}
}

export function loadLocalTls(env, config, {readProtected=readLocalProtectedBytes, now=Date.now()}={}) {
  const candidate=assertMarketCandidateMode(env,config);
  if(!candidate&&!assertLocalMarketMode(env,config))return null;
  let plain;
  try {
    plain=candidate?readProtected(env.DASHBOARD_TLS_BUNDLE,unprotectLocalBytes,{expectedSha256:env.DASHBOARD_TLS_BUNDLE_SHA256})
      :readProtected(env.DASHBOARD_TLS_BUNDLE);
    const value=JSON.parse(plain.toString('utf8'));
    if(value.schema!=='cru21-local-tls-bundle-v1' || typeof value.pfx!=='string'
        || typeof value.passphrase!=='string' || value.passphrase.length<32) fail('LOCAL_TLS_BUNDLE_INVALID');
    const cert=new X509Certificate(value.certificatePem);
    if(createHash('sha256').update(cert.raw).digest('hex')!==env.DASHBOARD_TLS_CERT_SHA256
        || cert.ca || !cert.checkIP('127.0.0.1') || !cert.checkHost('localhost')
        || now<Date.parse(cert.validFrom) || now>=Date.parse(cert.validTo)
        || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) fail('LOCAL_TLS_CERTIFICATE_REJECTED');
    return assertLocalPfxIdentity(Buffer.from(value.pfx,'base64'),value.passphrase,cert);
  } catch { fail('LOCAL_TLS_CONFIGURATION_REJECTED'); }
  finally {if(plain)plain.fill(0);}
}

export function createDashboardServer(handler, env, config, options) {
  const tls=loadLocalTls(env,config,options);
  return tls ? https.createServer(tls,handler) : http.createServer(handler);
}
