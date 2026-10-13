import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let api;
function native() {
  if (api) return api;
  const koffi = createRequire(import.meta.url)('koffi');
  const kernel = koffi.load('kernel32.dll');
  const call = (name, result, args) => kernel.func('__stdcall', name, result, args);
  api = {
    open: call('CreateFileW', 'intptr_t', ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'intptr_t']),
    rename: call('SetFileInformationByHandle', 'int', ['intptr_t', 'int', 'void *', 'uint32']),
    close: call('CloseHandle', 'int', ['intptr_t']),
    error: call('GetLastError', 'uint32', []),
  };
  return api;
}

function failure(win32Code, syscall, source, target) {
  const code = ({ 2: 'ENOENT', 3: 'ENOENT', 5: 'EACCES', 17: 'EXDEV', 32: 'EBUSY',
    33: 'EBUSY', 112: 'ENOSPC', 123: 'EINVAL', 206: 'ENAMETOOLONG' })[win32Code] || 'EIO';
  return Object.assign(new Error(`${code}: ${syscall} failed (${win32Code})`), {
    code, win32Code, syscall, path: source, dest: target,
  });
}

export function renameCru34SnapshotSync(source, target) {
  if (process.platform !== 'win32') return fs.renameSync(source, target);
  const from = path.resolve(source);
  const to = path.resolve(target);
  if (from.toLowerCase() === to.toLowerCase()
      || path.dirname(from).toLowerCase() !== path.dirname(to).toLowerCase()) {
    throw Object.assign(new Error('CRU34_SNAPSHOT_SAME_DIRECTORY_REQUIRED'), { code: 'EINVAL' });
  }
  const a = native();
  // DELETE access on our completed temporary file; share read/write/delete.
  const handle = a.open(from, 0x10000, 7, null, 3, 0, 0);
  if (handle === -1 || handle === -1n) throw failure(a.error(), 'CreateFileW', from, to);
  let errorCode = 0;
  try {
    const name = Buffer.from(`${to}\0`, 'utf16le');
    const nameOffset = process.arch === 'ia32' ? 12 : 20;
    const info = Buffer.alloc(nameOffset + name.length);
    // FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS:
    // existing share-delete readers keep the old file; new opens see the new
    // file. This does not ignore readonly attributes or bypass ACL/share checks.
    info.writeUInt32LE(3, 0);
    info.writeUInt32LE(name.length - 2, nameOffset - 4);
    name.copy(info, nameOffset);
    if (!a.rename(handle, 22 /* FileRenameInfoEx */, info, info.length)) errorCode = a.error();
  } finally { a.close(handle); }
  if (!errorCode) return;
  // Older Windows/filesystems may not implement this information class. Their
  // ordinary atomic rename is safe; a denied replacement still fails closed.
  if ([1, 50, 87].includes(errorCode)) return fs.renameSync(from, to);
  throw failure(errorCode, 'SetFileInformationByHandle', from, to);
}
