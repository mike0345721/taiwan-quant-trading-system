import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'data']);
const ignoredFiles = new Set(['.env.example', 'scan-secrets.mjs']);
const patterns = [
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'generic secret assignment', regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\s]{16,}["']/i },
];

async function walk(dir) {
  const results = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await walk(absolute));
    else if (!ignoredFiles.has(entry.name)) results.push(absolute);
  }
  return results;
}

const findings = [];
for (const file of await walk(root)) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) findings.push(`${path.relative(root, file)}：${pattern.name}`);
  }
}
if (findings.length) {
  console.error('疑似秘密資訊：\n' + findings.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('未發現常見硬編碼秘密。');
