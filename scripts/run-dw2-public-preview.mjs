import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicPreviewServer } from '../src/dashboard-public-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.env.PUBLIC_PREVIEW_MODE !== 'true') throw new Error('PUBLIC_PREVIEW_MODE_NOT_ENABLED');
const manifestPath = option('--manifest');
if (!manifestPath) throw new Error('PUBLIC_PREVIEW_MANIFEST_REQUIRED');

const { server, host, port, artifact } = createPublicPreviewServer({
  manifestPath: path.resolve(manifestPath),
  publicDir: path.join(root, 'public-preview'),
  lightweightChartsPath: path.join(root, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
  host: '127.0.0.1',
  port: 8798,
  publicPreviewMode: true,
});

server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    localOrigin: `http://${host}:${port}`,
    snapshotId: artifact.snapshot.snapshotId,
    PREVIEW_DATA_MODE: 'FROZEN_SNAPSHOT',
    executionAuthorized: false,
  })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
