import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REGISTRY_RELATIVE_PATH,
  generatedArtifacts,
  loadRegistry,
  validateRegistry
} from '../src/data-requirements-v1.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const check = args.has('--check') || !write;
const registry = loadRegistry(root);
const validation = validateRegistry(registry, { root });

if (validation.errors.length > 0) {
  console.error(JSON.stringify(validation, null, 2));
  process.exitCode = 1;
} else {
  for (const [relativePath, content] of generatedArtifacts(registry)) {
    const filePath = path.join(root, relativePath);
    if (write) fs.writeFileSync(filePath, content, 'utf8');
    if (check && !write) {
      const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
      if (current !== content) validation.errors.push(`${relativePath}: generated content is stale or missing`);
    }
  }
  console.log(JSON.stringify({ ...validation, registry: REGISTRY_RELATIVE_PATH, mode: write ? 'write' : 'check' }, null, 2));
  if (validation.errors.length > 0) process.exitCode = 1;
}
