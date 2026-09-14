import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw new Error('OPERATIONS_' + code); }
export function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function noLinks(target) {
  let cursor = path.resolve(target);
  while (true) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('OPERATIONS_OUTPUT_LINK_REJECTED');
    } else {
      // existsSync is false for a dangling symlink.
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('OPERATIONS_OUTPUT_LINK_REJECTED'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
export function assertOperationsOutputRoot(dataRoot, outputRoot, inputPaths = []) {
  const base = path.resolve(dataRoot, 'quality', 'daily-data-operations');
  const target = path.resolve(outputRoot);
  if (!contained(base, target)) throw new Error('OPERATIONS_OUTPUT_ROOT_NOT_GOVERNED');
  noLinks(target);
  // Outputs may never contain their own inputs, including through physical aliases.
  const physicalTarget = fs.existsSync(target) ? fs.realpathSync(target) : target;
  for (const input of inputPaths) {
    const resolved = fs.existsSync(input) ? fs.realpathSync(input) : path.resolve(input);
    if (contained(physicalTarget, resolved)) throw new Error('OPERATIONS_OUTPUT_INPUT_COLLISION');
  }
  return target;
}
export function readBoundedFile(file, maxBytes = 8 * 1024 * 1024) {
  let cursor = path.resolve(file);
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) fail('INPUT_LINK_REJECTED');
    const parent = path.dirname(cursor);
    if (cursor === parent) break;
    cursor = parent;
  }
  const fd = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) fail('INPUT_SIZE_INVALID');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) fail('INPUT_CHANGED');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('INPUT_CHANGED');
    return bytes;
  } finally { fs.closeSync(fd); }
}
