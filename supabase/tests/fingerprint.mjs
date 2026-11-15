// Prints the local fingerprint of the migrations (see fingerprint.sql).
// Usage: node fingerprint.mjs [section-number]   e.g. `node fingerprint.mjs 2` lists every policy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(here, 'fingerprint.sql'), 'utf8');
const { q } = await createDb();

const detail = process.argv[2];
if (!detail) {
  for (const r of await q(sql)) console.log(`${r.section.padEnd(18)} ${String(r.items).padStart(4)}  ${r.hash}`);
} else {
  // Re-run one section without the final aggregation, to see exactly which item differs.
  const cte = { 1: 'fn', 2: 'pol', 3: 'col', 4: 'tg', 5: 'cg', 6: 'fg', 7: 'trg', 8: 'rls', 9: 'enum', a: 'allow' }[detail];
  const head = sql.slice(0, sql.indexOf('select section, count(*)'));
  for (const r of await q(`${head} select k, v from ${cte} order by k`)) console.log(`${r.k} = ${r.v}`);
}
