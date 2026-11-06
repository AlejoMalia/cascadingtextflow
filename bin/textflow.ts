import { readFileSync, writeFileSync } from 'node:fs';
import { read, type Lang } from '../src/index';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const jsonOut = flag('--json');
const lang = flag('--lang') as Lang | undefined;
const min = flag('--min');
const used = new Set<number>();
for (const n of ['--json', '--lang', '--min']) { const i = args.indexOf(n); if (i >= 0) { used.add(i); used.add(i + 1); } }
const file = args.find((a, i) => !a.startsWith('--') && !used.has(i));
if (!file) { console.error('usage: npm run read -- <text.txt> [--json out.json] [--lang es|en|auto] [--min 3]'); process.exit(1); }

const r = read(readFileSync(file, 'utf-8'), { ...(lang ? { language: lang } : {}), ...(min ? { minMentions: +min } : {}) });
console.log(`${r.language} · ${r.words} words · ${r.layers} layers (${r.layerSource}) · ${r.elapsedMs}ms`);

const spark = (t: number[]) => { const step = Math.ceil(t.length / 60), s = t.filter((_, i) => i % step === 0), mx = Math.max(...s, 1); return s.map(v => ' ▁▂▃▄▅▆▇█'[Math.round(v / mx * 8)]).join(''); };
console.log('\nNODES (chains that recur) and their solar systems');
for (const n of r.nodes.slice(0, 20)) console.log(`  ${n.chain.padEnd(24)} ×${String(n.mentions).padEnd(4)} layers ${n.first}-${n.last}  orbit: ${n.orbit.slice(0, 6).join(', ')}\n  ${' '.repeat(24)} ${spark(n.trace)}`);
console.log('\nLINKS');
for (const l of r.links.slice(0, 10)) console.log(`  ${l.a} ↔ ${l.b}  strength ${l.strength}  together in ${l.sharedBlocks} blocks`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(r, null, 1)); console.log(`\nfull result in ${jsonOut}`); }
