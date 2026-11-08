import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dailyBindingKey, readDailyBinding, assertDailyEnvironment } from '../src/daily-storage-binding.mjs';

export function runBoundDaily(argv, env = process.env, { preflight = readDailyBinding, spawn = spawnSync } = {}) {
  if (argv.length !== 3 || argv[0] !== '--binding' || !['--preflight', '--dry-run', '--execute'].includes(argv[2])) throw Error('DAILY_ENTRY_ARGUMENT_REJECTED');
  assertDailyEnvironment(env);
  if (Object.hasOwn(env, dailyBindingKey)) throw Error('DAILY_ENTRY_ENV_BINDING_REJECTED');
  const bindingPath = path.resolve(argv[1]);
  const roots = preflight(bindingPath, { env });
  const runner = path.join(roots.sourceRoot, 'v2/scripts/run-v3-daily-update.mjs');
  const result = { mode: argv[2].slice(2), ...roots, runner, ownerAcceptance: 'NOT_ASSESSED', marketQuality: 'NOT_ASSESSED' };
  if (argv[2] !== '--execute') return result; // no DB open, directory creation, network or child stage
  const child = spawn(process.execPath, [runner], { cwd: path.join(roots.sourceRoot, 'v2'),
    env: { ...env, [dailyBindingKey]: bindingPath }, stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  return { ...result, exitCode: child.status ?? 1 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runBoundDaily(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode ?? 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
