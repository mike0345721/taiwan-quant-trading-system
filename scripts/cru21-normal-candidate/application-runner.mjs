// Fixed stdin-fed native-host child. The native host replaces the sole helper
// import with verified bytes as a data URL; no Temp pathname is imported.
import { runIsolatedApplication, validateApplicationPacket } from './application-isolation.mjs';

if (process.platform !== 'win32') throw new Error('APPLICATION_WINDOWS_HOST_REQUIRED');
if (process.argv.length !== 5 || process.argv[1] !== '-') throw new Error('APPLICATION_FIXED_ARGUMENTS_REQUIRED');
for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS']) {
  if (process.env[name]) throw new Error('APPLICATION_PRELOAD_ENVIRONMENT_REJECTED');
}
if (typeof CRU21_INPUT_PACKET === 'undefined') throw new Error('APPLICATION_FIXED_INPUT_PACKET_REQUIRED');
const [, , root, windowId, nonce] = process.argv;
const input = validateApplicationPacket(CRU21_INPUT_PACKET, { root, windowId, nonce });
const result = await runIsolatedApplication({ root, windowId, nonce, bundle: input.bundle, intentHash: input.intentHash });
// Host owns the original anonymous stdout reader and writes the receipt itself.
process.stdout.write(JSON.stringify(result) + '\n');
setInterval(() => {}, 1000);
