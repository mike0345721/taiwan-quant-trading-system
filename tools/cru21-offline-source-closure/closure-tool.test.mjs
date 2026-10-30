import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { TARGET, sha256, gitBlob, loadTrust, buildSourceBundle, validateSourceBundle, auditSourceGraph, writeArtifacts } from './closure-tool.mjs';

function fixture(t, contents = { 'server.mjs': Buffer.from("import './src/a.mjs';\r\nthrow Error('MUST_NOT_EVALUATE');\r\n"),
  'src/a.mjs': Buffer.from("export const x=1;\r\n"), 'public/binary.jpg': Buffer.from([0, 255, 13, 10, 128, 0]) }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-closure-test-')), sourceRoot = path.join(base, 'source'); fs.mkdirSync(sourceRoot);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const records = {};
  for (const [name, bytes] of Object.entries(contents)) {
    const file = path.join(sourceRoot, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    records[name] = { bytes: bytes.length, sha256: sha256(bytes), gitBlob: gitBlob(bytes) };
  }
  const receipt = { schema: 'cru21-cloud-source-materialization-v1', head: TARGET.head, tree: TARGET.tree,
    sourceRoot, files: records, normalInventoryFiles: Object.keys(records).length, fullGitTreeReconstructed: false };
  const inputs = (value = receipt, names = Object.keys(records)) => {
    const receiptBytes = Buffer.from(JSON.stringify(value)), inventoryBytes = Buffer.from(JSON.stringify(names));
    return { receiptBytes, inventoryBytes, expected: { head: TARGET.head, tree: TARGET.tree,
      receiptSHA256: sha256(receiptBytes), inventorySHA256: sha256(inventoryBytes) } };
  };
  const trust = loadTrust(inputs());
  return { base, sourceRoot, contents, records, receipt, inputs, trust,
    build: () => buildSourceBundle({ sourceRoot, trust }) };
}
test('deterministic source package preserves raw binary and CRLF without evaluating code', t => {
  const f = fixture(t), first = f.build(), second = f.build();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const bytes = validateSourceBundle(first, f.trust);
  for (const [name, expected] of Object.entries(f.contents)) assert.deepEqual(bytes.get(name), expected);
  assert.equal(first.manifest.gitTreeRebuiltByThisTool, false);
});
test('independent metadata digests reject an altered receipt before trusting its inventory', t => {
  const f = fixture(t), inputs = f.inputs(); inputs.receiptBytes = Buffer.from('{}');
  assert.throws(() => loadTrust(inputs), /INPUT_RECEIPT_HASH_REJECTED/);
});
for (const field of ['head', 'tree']) test('wrong ' + field + ' cannot self-approve via receipt', t => {
  const f = fixture(t), receipt = structuredClone(f.receipt); receipt[field] = '0'.repeat(40);
  assert.throws(() => loadTrust(f.inputs(receipt)), /VERSION_REJECTED/);
});
for (const name of ['../server.mjs', '/server.mjs', 'src/../server.mjs', 'src\\a.mjs', 'C:/server.mjs',
  'src/CON.mjs', 'src/a.mjs.', '.env', 'data/secret.json', 'src/vault/a.mjs']) test('reject unsafe/non-source inventory path ' + name, t => {
  const f = fixture(t), receipt = structuredClone(f.receipt); receipt.normalInventoryFiles = 1;
  receipt.files[name] = f.records['server.mjs'];
  assert.throws(() => loadTrust(f.inputs(receipt, [name])), /PATH_REJECTED|NON_SOURCE_PATH_REJECTED/);
});
test('duplicate and case-colliding inventory names are rejected', t => {
  const f = fixture(t);
  for (const names of [['server.mjs', 'server.mjs'], ['src/a.mjs', 'src/A.mjs']])
    assert.throws(() => loadTrust(f.inputs(f.receipt, names)), /DUPLICATE_PATH_REJECTED/);
});
test('missing inventory file and changed bytes fail before producing a package', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.sourceRoot, 'src/a.mjs'));
  assert.throws(f.build, error => error.code === 'ENOENT');
  fs.writeFileSync(path.join(f.sourceRoot, 'src/a.mjs'), 'changed'); assert.throws(f.build, /SOURCE_BYTES_REJECTED/);
});
test('leaf symlink, directory symlink and hardlink are rejected without following aliases', t => {
  const f = fixture(t), file = path.join(f.sourceRoot, 'src/a.mjs'), foreign = path.join(f.base, 'foreign');
  fs.writeFileSync(foreign, f.contents['src/a.mjs']); fs.unlinkSync(file); fs.symlinkSync(foreign, file);
  assert.throws(f.build, error => ['ELOOP', 'ENOTDIR'].includes(error.code));
  fs.unlinkSync(file); fs.linkSync(foreign, file); assert.throws(f.build, /SOURCE_FILE_IDENTITY_REJECTED/);
  fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); fs.symlinkSync(f.base, path.dirname(file));
  assert.throws(f.build, error => ['ELOOP', 'ENOTDIR'].includes(error.code));
  assert.deepEqual(fs.readFileSync(foreign), f.contents['src/a.mjs']);
});
test('root symlink is not accepted as the source snapshot', t => {
  const f = fixture(t), alias = path.join(f.base, 'alias'); fs.symlinkSync(f.sourceRoot, alias);
  const trust = loadTrust(f.inputs({ ...f.receipt, sourceRoot: alias }));
  assert.throws(() => buildSourceBundle({ sourceRoot: alias, trust }), error => ['ELOOP', 'ENOTDIR'].includes(error.code));
});
test('FIFO inventory leaf is rejected before reading, with an independently bounded child', async t => {
  const f = fixture(t), file = path.join(f.sourceRoot, 'src/a.mjs'); fs.unlinkSync(file);
  const make = spawnSync('/usr/bin/mkfifo', [file], { timeout: 2000, encoding: 'utf8' });
  assert.equal(make.status, 0, 'synthetic FIFO creation must succeed');
  const inputs = f.inputs(), payload = { sourceRoot: f.sourceRoot, expected: inputs.expected,
    receiptBase64: inputs.receiptBytes.toString('base64'), inventoryBase64: inputs.inventoryBytes.toString('base64') };
  const code = "import fs from 'node:fs'; import {loadTrust,buildSourceBundle} from " + JSON.stringify(new URL('./closure-tool.mjs', import.meta.url).href)
    + "; const p=JSON.parse(fs.readFileSync(0,'utf8')); const trust=loadTrust({receiptBytes:Buffer.from(p.receiptBase64,'base64'),inventoryBytes:Buffer.from(p.inventoryBase64,'base64'),expected:p.expected});"
    + "try{buildSourceBundle({sourceRoot:p.sourceRoot,trust});process.exitCode=1}catch(e){if(e.code==='SOURCE_FILE_IDENTITY_REJECTED'){process.exitCode=0}else{throw e}}";
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
      stdio: ['pipe', 'ignore', 'ignore'], timeout: 2000 });
    child.once('error', reject); child.stdin.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
    child.stdin.end(JSON.stringify(payload));
  });
  assert.equal(result.signal, null, 'FIFO rejection must complete rather than time out');
  assert.equal(result.status, 0, 'child only exits 0 for SOURCE_FILE_IDENTITY_REJECTED');
});
for (const edit of [
  value => { value.files.pop(); },
  value => { value.files[0].contentBase64 = 'AA=='; },
  value => { value.files.push(value.files[0]); },
  value => { value.files[0].name = '../escape.mjs'; },
  value => { value.manifest.head = '0'.repeat(40); },
  value => { value.manifest.files[0].sha256 = '0'.repeat(64); },
  value => { value.files[0].contentBase64 += '\n'; },
]) test('validator rejects missing/forged/duplicate/path/version/base64 package data', t => {
  const f = fixture(t), bundle = f.build(); edit(bundle);
  assert.throws(() => validateSourceBundle(bundle, f.trust));
});
test('graph parses real static requests and export-from without linking/evaluating poison source', { skip: !vm.SourceTextModule }, t => {
  const f = fixture(t), result = auditSourceGraph(f.build(), f.trust);
  assert.equal(result.inventoryStatus, 'COMPLETE_VERIFIED'); assert.equal(result.parsedModules, 2);
  assert.equal(result.staticRepositoryRequestsCovered, true); assert.deepEqual(result.unresolved, []);
  assert.equal(result.dependencyClosureProven, false);
});
test('graph reports missing relative dependencies and never reads an unlisted file', { skip: !vm.SourceTextModule }, t => {
  const f = fixture(t, { 'server.mjs': Buffer.from("import './src/not-in-inventory.mjs';") });
  const result = auditSourceGraph(f.build(), f.trust);
  assert.equal(result.staticRepositoryRequestsCovered, false);
  assert.equal(result.unresolved[0].kind, 'MISSING_STATIC_SOURCE');
});
test('computed/dynamic imports and external packages stay explicitly unproven', { skip: !vm.SourceTextModule }, t => {
  const f = fixture(t, { 'server.mjs': Buffer.from("import x from 'outside-package'; const name='./unknown.mjs'; import /* comment */ (name);") });
  const result = auditSourceGraph(f.build(), f.trust);
  assert.ok(result.unresolved.some(item => item.kind === 'DYNAMIC_IMPORT_NOT_ANALYZED'));
  assert.ok(result.unresolved.some(item => item.kind === 'EXTERNAL_PACKAGE_NOT_PACKAGED'));
  assert.equal(result.dependencyClosureProven, false);
});
test('source output is CreateNew and overlap/symlink-parent cannot modify source', { skip: !vm.SourceTextModule }, t => {
  const f = fixture(t), bundle = f.build(), audit = auditSourceGraph(bundle, f.trust), outputRoot = path.join(f.base, 'out');
  writeArtifacts({ outputRoot, sourceRoot: f.sourceRoot, bundle, audit });
  const before = fs.readFileSync(path.join(outputRoot, 'source-bundle.json'));
  assert.throws(() => writeArtifacts({ outputRoot, sourceRoot: f.sourceRoot, bundle, audit }), error => error.code === 'EEXIST');
  assert.deepEqual(fs.readFileSync(path.join(outputRoot, 'source-bundle.json')), before);
  assert.throws(() => writeArtifacts({ outputRoot: path.join(f.sourceRoot, 'out'), sourceRoot: f.sourceRoot, bundle, audit }), /OUTPUT_OVERLAPS_SOURCE/);
  const alias = path.join(f.base, 'redirect'); fs.symlinkSync(f.sourceRoot, alias);
  assert.throws(() => writeArtifacts({ outputRoot: path.join(alias, 'out'), sourceRoot: f.sourceRoot, bundle, audit }), error => ['ELOOP', 'ENOTDIR'].includes(error.code));
  assert.equal(fs.existsSync(path.join(f.sourceRoot, 'out')), false);
});
