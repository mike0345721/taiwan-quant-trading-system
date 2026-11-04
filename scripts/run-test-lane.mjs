import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testsRoot = path.join(root, 'tests');
const configPath = path.join(testsRoot, 'test-lanes.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const lane = process.argv[2] ?? 'ci';
const laneNames = Object.keys(config.lanes ?? {});
const allTests = fs.readdirSync(testsRoot)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

const assigned = new Map();
for (const laneName of laneNames) {
  const files = config.lanes[laneName]?.files ?? [];
  for (const file of files) {
    if (!allTests.includes(file)) {
      throw new Error(`TEST_LANE_FILE_NOT_FOUND:${laneName}:${file}`);
    }
    if (assigned.has(file)) {
      throw new Error(`TEST_LANE_DUPLICATE:${file}:${assigned.get(file)}:${laneName}`);
    }
    assigned.set(file, laneName);
  }
}

let selected;
if (lane === 'ci') {
  selected = allTests.filter((file) => !assigned.has(file));
} else if (laneNames.includes(lane)) {
  selected = [...config.lanes[lane].files].sort();
} else if (lane === 'list') {
  process.stdout.write(`CI hermetic/default: ${allTests.filter((file) => !assigned.has(file)).length} files\n`);
  for (const laneName of laneNames) {
    process.stdout.write(`${laneName}: ${config.lanes[laneName].files.length} files — ${config.lanes[laneName].description}\n`);
  }
  process.exit(0);
} else {
  throw new Error(`UNKNOWN_TEST_LANE:${lane}. Expected ci, ${laneNames.join(', ')}, or list.`);
}

if (selected.length === 0) {
  throw new Error(`TEST_LANE_EMPTY:${lane}`);
}

process.stdout.write(`Running test lane: ${lane}\n`);
process.stdout.write(`Selected files (${selected.length}): ${selected.join(', ')}\n`);

if (lane === 'ci' && assigned.size > 0) {
  process.stdout.write('Explicitly non-CI files remain visible below; they are not counted as CI PASS:\n');
  for (const laneName of laneNames) {
    const definition = config.lanes[laneName];
    process.stdout.write(`- ${laneName}: ${definition.description}\n`);
    for (const file of definition.files) process.stdout.write(`  - ${file}\n`);
  }
}

// Large Windows machines otherwise start one process per available CPU and
// starve real Git/PowerShell probes with bounded production identity deadlines.
// Keep those deadlines unchanged; bound only this test runner's fan-out.
const concurrency = process.platform === 'win32' ? ['--test-concurrency=4'] : [];
// Captured-handler tests use VM modules with synthetic IO, not a live server.
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...concurrency, ...selected.map((file) => path.join('tests', file))], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`Test lane terminated by signal ${result.signal}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
