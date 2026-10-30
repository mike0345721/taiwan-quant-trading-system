// Offline byte packaging only. Never import, link or evaluate packaged modules.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

export const TARGET = Object.freeze({ head: '4ae16de9a5af0166744626d44a49cb5bcebed675',
  tree: 'ac2d522e6d42934dbb563599a04df61f56fc9145',
  receiptSHA256: '6fe75876d0aaeee2e58d887331e4834d5a8ad76a2b489d3c3eb94010659bd417',
  inventorySHA256: 'fbcd2a6bfc0534d6650e6b7f765b763a0c884b5b08d3169c1f8be6ae95385a90' });
const HASH = /^[a-f0-9]{64}$/, SHA1 = /^[a-f0-9]{40}$/;
const MAX_FILE = 4 * 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const gitBlob = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const demand = (condition, code) => { if (!condition) fail(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const ordered = names => [...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const inside = (root, target) => { const rel = path.relative(root, target); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

export function canonicalName(name) {
  demand(typeof name === 'string' && name.length > 0 && name.length <= 1024
    && /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('/') && !name.endsWith('/'), 'PATH_REJECTED');
  const pieces = name.split('/');
  demand(pieces.every(piece => piece && piece !== '.' && piece !== '..' && !piece.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece)), 'PATH_REJECTED');
  return name;
}
function sourceName(name) {
  canonicalName(name);
  demand(!name.split('/').some(piece => /^(?:data|\.git|node_modules|vault|credentials|live-events)$/i.test(piece))
    && !name.split('/').some(piece => /^\.env(?:\.|$)/i.test(piece)), 'NON_SOURCE_PATH_REJECTED');
  demand(['server.mjs', 'package.json', 'package-lock.json'].includes(name)
    || /^(?:src|v2)\/.+\.(?:mjs|js)$/.test(name)
    || /^config\/.+\.json$/.test(name)
    || /^public\/.+\.(?:js|mjs|css|html|json|jpg|jpeg|png|gif|svg|ico|woff|woff2|txt)$/.test(name), 'NON_SOURCE_PATH_REJECTED');
  return name;
}
function uniqueNames(names) {
  demand(Array.isArray(names) && names.length > 0 && names.length <= 1000, 'INVENTORY_SHAPE_REJECTED');
  const seen = new Set();
  for (const name of names) { sourceName(name); const key = name.toLowerCase(); demand(!seen.has(key), 'DUPLICATE_PATH_REJECTED'); seen.add(key); }
  return ordered(names);
}
function identity(value, expected) {
  demand(SHA1.test(expected.head) && SHA1.test(expected.tree) && value.head === expected.head && value.tree === expected.tree, 'VERSION_REJECTED');
}
export function loadTrust({ receiptBytes, inventoryBytes, expected = TARGET }) {
  demand(Buffer.isBuffer(receiptBytes) && Buffer.isBuffer(inventoryBytes)
    && HASH.test(expected.receiptSHA256) && HASH.test(expected.inventorySHA256)
    && sha256(receiptBytes) === expected.receiptSHA256 && sha256(inventoryBytes) === expected.inventorySHA256, 'INPUT_RECEIPT_HASH_REJECTED');
  const receipt = JSON.parse(receiptBytes.toString('utf8')), names = uniqueNames(JSON.parse(inventoryBytes.toString('utf8')));
  demand(receipt.schema === 'cru21-cloud-source-materialization-v1', 'RECEIPT_SCHEMA_REJECTED'); identity(receipt, expected);
  demand(typeof receipt.sourceRoot === 'string' && path.isAbsolute(receipt.sourceRoot)
    && receipt.normalInventoryFiles === names.length && receipt.files && typeof receipt.files === 'object', 'INVENTORY_RECEIPT_REJECTED');
  const records = names.map(name => {
    const file = receipt.files[name];
    demand(file && HASH.test(file.sha256) && SHA1.test(file.gitBlob) && Number.isSafeInteger(file.bytes)
      && file.bytes >= 0 && file.bytes <= MAX_FILE, 'INVENTORY_RECORD_REJECTED');
    return Object.freeze({ name, bytes: file.bytes, sha256: file.sha256, gitBlob: file.gitBlob });
  });
  return Object.freeze({ head: expected.head, tree: expected.tree, sourceRoot: path.resolve(receipt.sourceRoot),
    receiptSHA256: expected.receiptSHA256, inventorySHA256: expected.inventorySHA256, records: Object.freeze(records),
    externalTreeReconstructionClaim: receipt.fullGitTreeReconstructed === true });
}

// Linux held-directory traversal: every component is opened O_NOFOLLOW; source
// leafs are opened relative to their held parent, never via a second root path.
function openRoot(root) {
  demand(process.platform === 'linux' && fs.constants.O_NOFOLLOW && fs.constants.O_DIRECTORY, 'HELD_DIRECTORY_PLATFORM_UNSUPPORTED');
  demand(typeof root === 'string' && path.isAbsolute(root) && root === path.resolve(root), 'ROOT_REJECTED');
  let fd = fs.openSync('/', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    for (const piece of root.split('/').filter(Boolean)) {
      canonicalName(piece);
      const next = fs.openSync('/proc/self/fd/' + fd + '/' + piece, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(fd); fd = next;
    }
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}
function readRelative(rootFD, name) {
  canonicalName(name); const components = name.split('/'), held = []; let parent = rootFD, fileFD;
  try {
    for (const piece of components.slice(0, -1)) {
      const next = fs.openSync('/proc/self/fd/' + parent + '/' + piece, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      held.push(next); parent = next;
    }
    // Do not block before fstat if an inventory leaf was replaced with a FIFO.
    fileFD = fs.openSync('/proc/self/fd/' + parent + '/' + components.at(-1), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fileFD);
    demand(before.isFile() && before.nlink === 1 && before.size <= MAX_FILE, 'SOURCE_FILE_IDENTITY_REJECTED');
    const buffer = Buffer.alloc(before.size + 1); let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fileFD, buffer, length, buffer.length - length, null)) > 0) length += count;
    const bytes = buffer.subarray(0, length), after = fs.fstatSync(fileFD);
    demand(before.dev === after.dev && before.ino === after.ino && after.nlink === 1 && before.size === after.size && bytes.length === after.size
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'SOURCE_FILE_CHANGED');
    return bytes;
  } finally { if (fileFD !== undefined) fs.closeSync(fileFD); for (const fd of held.reverse()) fs.closeSync(fd); }
}
function expectedManifest(trust) {
  return { schema: 'cru21-offline-source-manifest-v1', head: trust.head, tree: trust.tree,
    receiptSHA256: trust.receiptSHA256, inventorySHA256: trust.inventorySHA256,
    files: trust.records.map(record => ({ ...record })),
    evidenceClass: 'SOURCE_BYTES_ONLY_NOT_RUNTIME_APPROVAL', gitTreeRebuiltByThisTool: false };
}
export function buildSourceBundle({ sourceRoot, trust }) {
  demand(path.resolve(sourceRoot) === trust.sourceRoot, 'SNAPSHOT_ROOT_REJECTED');
  const fd = openRoot(sourceRoot), files = []; let total = 0;
  try {
    for (const record of trust.records) {
      const bytes = readRelative(fd, record.name); total += bytes.length;
      demand(total <= MAX_TOTAL, 'TOTAL_SIZE_REJECTED');
      demand(bytes.length === record.bytes && sha256(bytes) === record.sha256 && gitBlob(bytes) === record.gitBlob, 'SOURCE_BYTES_REJECTED');
      files.push({ name: record.name, encoding: 'base64', contentBase64: bytes.toString('base64') });
    }
  } finally { fs.closeSync(fd); }
  const manifest = expectedManifest(trust);
  return { schema: 'cru21-offline-source-bundle-v1', manifest,
    manifestSHA256: sha256(Buffer.from(JSON.stringify(manifest))), files };
}
export function validateSourceBundle(bundle, trust) {
  demand(exact(bundle, ['schema', 'manifest', 'manifestSHA256', 'files'])
    && bundle.schema === 'cru21-offline-source-bundle-v1', 'BUNDLE_SCHEMA_REJECTED');
  identity(bundle.manifest, trust);
  demand(JSON.stringify(bundle.manifest) === JSON.stringify(expectedManifest(trust))
    && bundle.manifestSHA256 === sha256(Buffer.from(JSON.stringify(bundle.manifest))), 'MANIFEST_REJECTED');
  demand(Array.isArray(bundle.files) && bundle.files.length === trust.records.length, 'INVENTORY_INCOMPLETE');
  const names = uniqueNames(bundle.files.map(file => file.name));
  demand(JSON.stringify(names) === JSON.stringify(trust.records.map(file => file.name))
    && JSON.stringify(names) === JSON.stringify(bundle.files.map(file => file.name)), 'INVENTORY_OR_ORDER_REJECTED');
  const decoded = new Map(); let total = 0;
  for (let index = 0; index < bundle.files.length; index++) {
    const file = bundle.files[index], record = trust.records[index];
    demand(exact(file, ['name', 'encoding', 'contentBase64']) && file.encoding === 'base64' && typeof file.contentBase64 === 'string'
      && file.contentBase64.length <= Math.ceil(MAX_FILE / 3) * 4
      && file.contentBase64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64), 'BASE64_REJECTED');
    const bytes = Buffer.from(file.contentBase64, 'base64'); total += bytes.length;
    demand(total <= MAX_TOTAL && bytes.toString('base64') === file.contentBase64 && bytes.length === record.bytes
      && sha256(bytes) === record.sha256 && gitBlob(bytes) === record.gitBlob, 'BUNDLE_BYTES_REJECTED');
    decoded.set(file.name, bytes);
  }
  return decoded;
}

export function auditSourceGraph(bundle, trust, { entries = ['server.mjs'] } = {}) {
  demand(typeof vm.SourceTextModule === 'function', 'CONSTRUCT_ONLY_VM_PARSER_UNAVAILABLE');
  const files = validateSourceBundle(bundle, trust), builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
  const parsed = new Map(), edges = [], unresolved = [], queue = [...entries], reached = new Set();
  const context = vm.createContext(Object.freeze({}), { codeGeneration: { strings: false, wasm: false } });
  while (queue.length) {
    const name = queue.shift(); sourceName(name); if (reached.has(name)) continue; reached.add(name);
    demand(files.has(name), 'ENTRY_NOT_IN_INVENTORY');
    const bytes = files.get(name), source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let module;
    try { module = new vm.SourceTextModule(source, { context, identifier: name }); }
    catch { unresolved.push({ from: name, kind: 'PARSE_UNSUPPORTED' }); continue; }
    demand(module.status === 'unlinked', 'UNEXPECTED_MODULE_STATE');
    parsed.set(name, module.dependencySpecifiers);
    for (const specifier of module.dependencySpecifiers) {
      if (builtins.has(specifier)) { edges.push({ from: name, specifier, kind: 'BUILTIN' }); continue; }
      if (!specifier.startsWith('.')) {
        edges.push({ from: name, specifier, kind: 'EXTERNAL_PACKAGE_NOT_PACKAGED' });
        unresolved.push({ from: name, specifier, kind: 'EXTERNAL_PACKAGE_NOT_PACKAGED' }); continue;
      }
      let target;
      try {
        demand(!/[\\%?#:]/.test(specifier), 'UNSUPPORTED_SPECIFIER');
        target = canonicalName(path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)));
      } catch { unresolved.push({ from: name, specifier, kind: 'UNSUPPORTED_RELATIVE_SPECIFIER' }); continue; }
      if (!files.has(target)) { unresolved.push({ from: name, specifier, target, kind: 'MISSING_STATIC_SOURCE' }); continue; }
      edges.push({ from: name, specifier, target, kind: 'REPOSITORY_STATIC_SOURCE' });
      if (/\.(?:mjs|js)$/.test(target)) queue.push(target);
      else unresolved.push({ from: name, target, kind: 'NON_JS_IMPORT_NOT_ANALYZED' });
    }
    // Deliberately conservative hints, not a JS lexer: false positives remain
    // UNKNOWN. Computed loaders/runtime assets are never certified by this audit.
    if (/\bimport\s*(?:\/\*[\s\S]*?\*\/\s*)*\(/.test(source)) unresolved.push({ from: name, kind: 'DYNAMIC_IMPORT_NOT_ANALYZED' });
    if (/\b(?:require|createRequire|eval|Function)\s*\(/.test(source)) unresolved.push({ from: name, kind: 'COMPUTED_OR_COMMONJS_LOADER_NOT_ANALYZED' });
  }
  return { schema: 'cru21-offline-source-graph-v1', head: trust.head, tree: trust.tree,
    inventoryStatus: 'COMPLETE_VERIFIED', inventoryFiles: trust.records.length, entries: [...entries],
    parser: 'VM_SOURCE_TEXT_MODULE_CONSTRUCT_ONLY_NO_LINK_NO_EVALUATE', parsedModules: parsed.size,
    reachedModules: ordered(reached), edges, unresolved,
    staticRepositoryRequestsCovered: !unresolved.some(item => ['MISSING_STATIC_SOURCE', 'UNSUPPORTED_RELATIVE_SPECIFIER', 'PARSE_UNSUPPORTED', 'NON_JS_IMPORT_NOT_ANALYZED'].includes(item.kind)),
    dependencyClosureProven: false, qualification: 'NOT_PROVEN',
    limits: ['Constructing ESM syntax does not execute it. No product/vendor module was imported, linked or evaluated.',
      'Inventory coverage is not dependency closure. Dynamic/computed loaders and runtime assets are unsupported.',
      'External data, vendor bytes, native libraries, Windows behavior and runtime readiness are not qualified.',
      'Root Git-tree reconstruction is external evidence; this tool checks selected bytes and does not rebuild the entire Git tree.'] };
}
export function writeArtifacts({ outputRoot, sourceRoot, bundle, audit }) {
  demand(path.isAbsolute(outputRoot) && outputRoot === path.resolve(outputRoot)
    && !inside(sourceRoot, outputRoot) && !inside(outputRoot, sourceRoot), 'OUTPUT_OVERLAPS_SOURCE');
  const parentFD = openRoot(path.dirname(outputRoot)); let fd;
  try {
    const name = canonicalName(path.basename(outputRoot));
    fs.mkdirSync('/proc/self/fd/' + parentFD + '/' + name, { mode: 0o700 });
    fd = fs.openSync('/proc/self/fd/' + parentFD + '/' + name, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    for (const [name, value] of [['manifest.json', bundle.manifest], ['source-bundle.json', bundle], ['graph-audit.json', audit]]) {
      const file = fs.openSync('/proc/self/fd/' + fd + '/' + name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(file, JSON.stringify(value) + '\n'); fs.fsyncSync(file); } finally { fs.closeSync(file); }
    }
    fs.fsyncSync(fd);
  } finally { if (fd !== undefined) fs.closeSync(fd); fs.closeSync(parentFD); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  demand(process.argv.length === 7 && process.argv[2] === 'build', 'USAGE_BUILD_SOURCE_RECEIPT_INVENTORY_OUTPUT');
  const [, , , sourceRoot, receiptFile, inventoryFile, outputRoot] = process.argv;
  demand(path.basename(receiptFile) === 'source-materialization.json' && path.basename(inventoryFile) === 'baseline-normal-paths.json', 'FIXED_METADATA_NAMES_REQUIRED');
  const metadata = file => { const fd = openRoot(path.dirname(path.resolve(file))); try { return readRelative(fd, path.basename(file)); } finally { fs.closeSync(fd); } };
  const trust = loadTrust({ receiptBytes: metadata(receiptFile), inventoryBytes: metadata(inventoryFile) });
  const bundle = buildSourceBundle({ sourceRoot, trust }), audit = auditSourceGraph(bundle, trust);
  writeArtifacts({ outputRoot, sourceRoot, bundle, audit });
  process.stdout.write(JSON.stringify({ head: trust.head, tree: trust.tree, inventoryFiles: trust.records.length,
    bundleSHA256: sha256(Buffer.from(JSON.stringify(bundle) + '\n')), unresolved: audit.unresolved.length,
    dependencyClosureProven: false, runtimeStarted: false }) + '\n');
}
