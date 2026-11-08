import fs from 'node:fs';
import path from 'node:path';

export function assertPlainLocalPath(target, directory = true) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || /^[\\/]{2}/.test(target) || /[\0\r\n]/.test(target))
    throw Error('OWNER_LOCAL_PATH_REQUIRED');
  for (let current = target;; current = path.dirname(current)) {
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || (current === target && !directory ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()))
      throw Error('OWNER_PATH_ALIAS_REJECTED');
    if (current === path.dirname(current)) break;
  }
  if (fs.realpathSync(target).toLowerCase() !== path.resolve(target).toLowerCase()) throw Error('OWNER_PATH_ALIAS_REJECTED');
}

// Binding-only Owner exception for standalone/data + standalone/v2. No discovery,
// arbitrary leaf override or fallback to another database. Checks are metadata
// preflight only, not native lifetime protection against subsequent replacement.
export function resolveOwnerResearchRoot(binding, inspect = assertPlainLocalPath) {
  if (binding.researchRoot === undefined) return path.join(binding.readDataRoot, 'v2');
  const target = binding.researchRoot;
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const inside = (left, right) => {
    const relative = path.relative(normalize(left), normalize(right));
    return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
  };
  if (typeof target !== 'string' || !path.isAbsolute(target) || /^[\\/]{2}/.test(target)
      || /[\0\r\n]/.test(target) || target.split(/[\\/]/).some(part => part === '.' || part === '..')
      || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(target))
      || path.basename(binding.readDataRoot).toLowerCase() !== 'data'
      || normalize(path.resolve(target)) !== normalize(path.join(path.dirname(binding.readDataRoot), 'v2'))
      || [binding.sourceRoot, binding.producerDataRoot].some(root => inside(root, target) || inside(target, root)))
    throw Error('OWNER_RESEARCH_ROOT_REJECTED');
  const root = path.resolve(target);
  try {
    inspect(root);
    inspect(path.join(root, 'data'));
    inspect(path.join(root, 'reports'));
    inspect(path.join(root, 'data/research-v2.sqlite'), false);
    // An absent report remains absent; a dangling link must not count as absent.
    const report = path.join(root, 'reports/latest-backtest.json');
    try { fs.lstatSync(report); } catch (error) { if (error.code === 'ENOENT') return root; throw error; }
    inspect(report, false);
  } catch (error) {
    if (/^OWNER_[A-Z0-9_]+$/.test(error.message)) throw error;
    throw Error('OWNER_RESEARCH_PATH_UNAVAILABLE');
  }
  return root;
}
