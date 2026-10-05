// Own SIWC credentials only. Never reads Codex, browsers, broker credentials or API keys.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PlanError } from './chatgpt-plan-auth.mjs';
function powershell(script, input = '') {
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 2_097_152 });
  if (child.error || child.status !== 0) throw new PlanError('LOCAL_CREDENTIAL_PROTECTION_FAILED');
  return child.stdout.replace(/^\uFEFF/, '').trim();
}
const prefix = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $value=[Console]::In.ReadToEnd(); ";
function protect(value) { return powershell(prefix + '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))', value); }
function unprotect(value) { return powershell(prefix + '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))', value); }
export function createWindowsPlanStore() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new PlanError('WINDOWS_PROTECTED_STORE_REQUIRED');
  const dir = path.join(process.env.LOCALAPPDATA, 'TaiwanQuantDashboard', 'ChatGPTPlan');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new PlanError('CREDENTIAL_PATH_REJECTED');
  const sid = powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  if (!/^S-1-5-[0-9-]+$/.test(sid)) throw new PlanError('LOCAL_IDENTITY_UNVERIFIED');
  const acl = spawnSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, timeout: 10_000, encoding: 'utf8' });
  if (acl.error || acl.status !== 0) throw new PlanError('CREDENTIAL_ACL_FAILED');
  const file = path.join(dir, 'siwc-v1.dpapi');
  let data = { schema: 'cru21-siwc-vault-v1', hostId: 'urn:uuid:' + randomUUID(), registrations: {} };
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 1_048_576) throw new PlanError('CREDENTIAL_FILE_REJECTED');
    try { data = JSON.parse(unprotect(fs.readFileSync(file, 'utf8'))); } catch { throw new PlanError('CREDENTIAL_STORE_UNREADABLE'); }
    if (data.schema !== 'cru21-siwc-vault-v1' || !/^urn:uuid:[a-f0-9-]{36}$/.test(data.hostId) || !data.registrations) throw new PlanError('CREDENTIAL_STORE_INVALID');
  }
  function persist(next) {
    const encrypted = protect(JSON.stringify(next));
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
      data = next;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  if (!fs.existsSync(file)) persist(data); // One stable host identity across restarts.
  return {
    hostId: data.hostId,
    list() { return Object.entries(data.registrations).map(([key, r]) => ({ key, label: `${r.email || '已驗證帳號'} · ${key.slice(0,8)}`, expiresAt: r.expiresAt })); },
    get(key) { return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && Object.hasOwn(data.registrations, key) ? data.registrations[key] : null; },
    save(record) {
      const key = createHash('sha256').update(JSON.stringify([record.issuer, record.client_id, record.subject])).digest('hex');
      persist({ ...data, registrations: { ...data.registrations, [key]: record } });
      return key;
    },
  };
}
