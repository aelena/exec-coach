// Lists translation keys referenced in src/: literal keys and the prefixes of templated ones.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function collectKeys(root = 'src') {
  const literal = new Set();
  const dynamic = new Set();
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) literal.add(m[1]);
    for (const m of text.matchAll(/\bt\(\s*[^)]*?\?\s*'([A-Za-z0-9_.]+)'\s*:\s*'([A-Za-z0-9_.]+)'/g)) { literal.add(m[1]); literal.add(m[2]); }
    for (const m of text.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\$\{/g)) dynamic.add(m[1]);
    for (const m of text.matchAll(/(?:key|claimKey|reasonKey)\w*:\s*'((?:signal|swot|recommend)\.[A-Za-z0-9_.]+)'/g)) literal.add(m[1]);
    for (const m of text.matchAll(/'((?:signal|swot|recommend)\.[A-Za-z]+)'/g)) literal.add(m[1]);
  }
  return { literal: [...literal].sort(), dynamic: [...dynamic].sort() };
}

if (process.argv[1]?.endsWith('i18n-keys.mjs')) {
  const { literal, dynamic } = collectKeys();
  console.log(literal.join('\n'));
  console.log('--- dynamic prefixes ---');
  console.log(dynamic.join('\n'));
}
