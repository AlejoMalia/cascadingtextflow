/**
 * engine.ts — reads a text and lays it out as nodes over layers. No model, no network.
 *
 *   letters → words → nodes → solar systems → traces
 *
 *  • A LAYER is a real page (when the text carries page breaks) or a block of `layerSize` words.
 *  • A WORD is a run of letters. Every word is indexed: where it stands, what comes before and
 *    after it, which words orbit it.
 *  • A NODE is a chain of letters that recurs: a word, or a chain of two or three words, that
 *    shows up at least `minMentions` times. A word that lives almost only inside a longer
 *    recurring chain is part of that chain, not a node of its own.
 *  • A node's SOLAR SYSTEM is the bag of words around all of its mentions, each weighed by how
 *    rare it is across the layers.
 *  • Its TRACE is the number of mentions in every layer.
 *  • Two nodes are LINKED, with a strength, when they show up in the same stretches of text.
 */
import { LEXICONS, detectLang, type Lang } from './lexicon';

export type { Lang };

export interface ReadOptions {
  language?: Lang;
  /** words per layer when the text carries no page breaks (default 250) */
  layerSize?: number;
  /** words on each side that count as "around" a node or a word (default 8) */
  window?: number;
  /** a chain must recur at least this many times to be a node (default 3) */
  minMentions?: number;
  /** keep at most this many nodes, the heaviest first (default 200) */
  maxNodes?: number;
}

export interface TextNode {
  /** the chain, in lower case */
  chain:    string;
  /** how many words long the chain is (1–3) */
  length:   number;
  mentions: number;
  /** layers in which it appears */
  layers:   number;
  first:    number;
  last:     number;
  /** the shortest stretch of layers holding 80% of its mentions */
  core:     [number, number];
  /** mentions × rarity across layers: what ranks the nodes */
  weight:   number;
  /** mentions in every layer: trace[ℓ − 1] */
  trace:    number[];
  /** its solar system: the heaviest words around it */
  orbit:    string[];
}

export interface Link {
  a: string;
  b: string;
  /** 0–1: cosine of the two nodes' presence over 50-word blocks */
  strength: number;
  /** 50-word blocks in which both appear */
  sharedBlocks: number;
  sharedLayers: number;
}

export interface WordEntry {
  n:        number;
  /** a function word (article, preposition…) */
  function: boolean;
  layers:   number;
  first:    number;
  last:     number;
  /** mentions per slice of the text (up to 40 slices) */
  density:  number[];
  before:   [string, number][];
  after:    [string, number][];
  /** the content words that stand around it, the rarer ones weighing more */
  orbit:    string[];
}

export interface TextFlow {
  language:    Lang;
  words:       number;
  layers:      number;
  layerSource: 'page-breaks' | 'fixed-size';
  elapsedMs:   number;
  nodes:       TextNode[];
  links:       Link[];
  wordIndex:   Record<string, WordEntry>;
}

interface Tok { lw: string; layer: number; start: boolean }

const TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\d+(?:[.,]\d+)*/gu;
const POSSESSIVE = /['’]s$/i;
const BLOCK = 50;
const BINS = 40;
const MAX_CHAIN = 3;

function tokenise(text: string, layerSize: number): { toks: Tok[]; layers: number; source: TextFlow['layerSource'] } {
  const pages = text.split('\f');
  const real = pages.filter(p => p.trim()).length >= 2;
  const toks: Tok[] = [];
  let layer = 0;
  for (const page of real ? pages : [text]) {
    let prevEnd = -1, any = false;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(page); m; m = TOKEN.exec(page)) {
      if (!any) { any = true; if (real) layer++; }
      const gap = prevEnd < 0 ? '' : page.slice(prevEnd, m.index);
      const start = prevEnd < 0 || /[.!?…;:]/.test(gap) || /\n\s*\n/.test(gap);        // a chain never crosses a sentence break
      toks.push({ lw: m[0].replace(POSSESSIVE, '').toLowerCase(), layer, start });
      prevEnd = m.index + m[0].length;
    }
  }
  if (!real) { toks.forEach((t, i) => { t.layer = Math.floor(i / layerSize) + 1; }); layer = toks.length ? Math.floor((toks.length - 1) / layerSize) + 1 : 0; }
  return { toks, layers: layer, source: real ? 'page-breaks' : 'fixed-size' };
}

const contains = (chain: string, part: string) => (' ' + chain + ' ').includes(' ' + part + ' ');
const topEntries = (m: Map<number, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

export function read(text: string, opts: ReadOptions = {}): TextFlow {
  const t0 = Date.now();
  const lang: Lang = opts.language ?? detectLang(text);
  const W = opts.window ?? 8;
  const min = opts.minMentions ?? 3;
  const { toks, layers: NL, source } = tokenise(text, opts.layerSize ?? 250);
  const N = toks.length;

  // ── words: an id for every distinct word, with its counts per layer ──
  const ids = new Map<string, number>(), list: string[] = [];
  const id = new Int32Array(N);
  toks.forEach((t, i) => { let x = ids.get(t.lw); if (x === undefined) { x = list.length; ids.set(t.lw, x); list.push(t.lw); } id[i] = x; });
  const V = list.length;
  const count = new Int32Array(V), layerCount = new Int32Array(V), lastSeen = new Int32Array(V);
  const first = new Int32Array(V), last = new Int32Array(V);
  for (let i = 0; i < N; i++) {
    const w = id[i], l = toks[i].layer;
    count[w]++; if (lastSeen[w] !== l) { layerCount[w]++; lastSeen[w] = l; if (!first[w]) first[w] = l; }
    last[w] = l;
  }

  // ── function words: the language's list, or (unknown language) the words frequent in most layers ──
  let stop = LEXICONS[lang].stop;
  if (lang === 'auto') {
    stop = new Set<string>();
    for (let w = 0; w < V; w++) if (count[w] >= Math.max(3, N * 0.003) && (NL < 4 || layerCount[w] >= NL * 0.5)) stop.add(list[w]);
  }
  const isFn = list.map(w => stop.has(w) || /\d/.test(w));
  const isContent = list.map((w, k) => !isFn[k] && [...w].length >= 3);
  const idf = (w: number) => NL < 8 ? Math.log((N + 1) / (1 + count[w])) : Math.log((NL + 1) / (1 + layerCount[w]));

  // ── nodes: chains of letters that recur, longest first ──
  // a chain starts and ends on a content word; inside a sentence, function words may sit in the middle
  const chainsOf = (n: number) => {
    const m = new Map<string, number[]>();
    for (let i = 0; i + n <= N; i++) {
      if (!isContent[id[i]] || !isContent[id[i + n - 1]]) continue;
      let ok = true; for (let k = 1; k < n; k++) if (toks[i + k].start) { ok = false; break; }
      if (!ok) continue;
      let key = String(id[i]); for (let k = 1; k < n; k++) key += ' ' + id[i + k];
      (m.get(key) ?? m.set(key, []).get(key)!).push(i);
    }
    return m;
  };
  const covered = new Uint8Array(N);
  const picked: { words: number[]; at: number[] }[] = [];
  for (let n = MAX_CHAIN; n >= 1; n--) {
    const round: typeof picked = [];
    for (const [key, at] of chainsOf(n)) {
      if (at.length < min) continue;
      let inside = 0; for (const i of at) { let all = true; for (let k = 0; k < n; k++) if (!covered[i + k]) { all = false; break; } if (all) inside++; }
      if (inside / at.length >= 0.8) continue;            // it lives inside a longer recurring chain: it is part of it
      round.push({ words: key.split(' ').map(Number), at });
    }
    for (const c of round) for (const i of c.at) for (let k = 0; k < c.words.length; k++) covered[i + k] = 1;
    picked.push(...round);
  }
  const ranked = picked.map(c => {
    const lay = new Set(c.at.map(i => toks[i].layer)).size;
    return { ...c, weight: c.at.length * Math.log(1 + NL / lay) };
  }).sort((a, b) => b.weight - a.weight).slice(0, opts.maxNodes ?? 200);

  // ── solar systems and traces ──
  const bags: Map<number, number>[] = [], nodes: TextNode[] = [];
  for (const c of ranked) {
    const own = new Set(c.words), len = c.words.length;
    const bag = new Map<number, number>(), seen = new Map<number, number>(), trace = new Array<number>(NL).fill(0), lay: number[] = [];
    for (const a of c.at) {
      trace[toks[a].layer - 1]++; lay.push(toks[a].layer);
      for (let d = 1; d <= W; d++) for (const k of [a - d, a + len - 1 + d]) {
        if (k < 0 || k >= N) continue;
        const w = id[k]; if (!isContent[w] || own.has(w)) continue;
        bag.set(w, (bag.get(w) ?? 0) + 1 / d); seen.set(w, (seen.get(w) ?? 0) + 1);
      }
    }
    for (const [w, x] of bag) bag.set(w, x * idf(w) * ((seen.get(w) ?? 0) < 2 ? 0.3 : 1));   // a word met once beside the node weighs less than one met again and again
    bags.push(bag);
    lay.sort((x, y) => x - y);
    const m = Math.max(1, Math.ceil(lay.length * 0.8)); let core: [number, number] = [lay[0], lay[lay.length - 1]];
    for (let i = 0; i + m - 1 < lay.length; i++) if (lay[i + m - 1] - lay[i] < core[1] - core[0]) core = [lay[i], lay[i + m - 1]];
    nodes.push({
      chain: c.words.map(w => list[w]).join(' '), length: len, mentions: c.at.length, layers: trace.filter(x => x > 0).length,
      first: lay[0], last: lay[lay.length - 1], core, weight: +c.weight.toFixed(3), trace, orbit: topEntries(bag, 8).map(([w]) => list[w]),
    });
  }

  // ── links: nodes that show up in the same 50-word blocks ──
  const presence = ranked.map(c => { const m = new Map<number, number>(); for (const a of c.at) { const b = Math.floor(a / BLOCK); m.set(b, (m.get(b) ?? 0) + 1); } return m; });
  const norm = presence.map(m => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0)));
  const links: Link[] = [];
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const [S, T] = presence[a].size <= presence[b].size ? [presence[a], presence[b]] : [presence[b], presence[a]];
    let dot = 0, together = 0; for (const [k, v] of S) { const o = T.get(k); if (o) { dot += v * o; together++; } }
    if (together < 2 || contains(nodes[a].chain, nodes[b].chain) || contains(nodes[b].chain, nodes[a].chain)) continue;   // a chain and the words inside it are not two things
    let shared = 0; for (let l = 0; l < NL; l++) if (nodes[a].trace[l] > 0 && nodes[b].trace[l] > 0) shared++;
    links.push({ a: nodes[a].chain, b: nodes[b].chain, strength: +(dot / (norm[a] * norm[b])).toFixed(3), sharedBlocks: together, sharedLayers: shared });
  }
  links.sort((x, y) => y.strength - x.strength); links.length = Math.min(links.length, 200);

  // ── the index of every word ──
  const bins = Math.max(1, Math.min(NL, BINS));
  const density = Array.from({ length: V }, () => new Uint16Array(bins));
  const before = new Map<number, number>(), after = new Map<number, number>(), orbit = new Map<number, number>();
  const WIN = 6;
  for (let i = 0; i < N; i++) {
    const w = id[i];
    density[w][Math.min(bins - 1, Math.floor((toks[i].layer - 1) / NL * bins))]++;
    if (i > 0) { const p = id[i - 1]; after.set(p * V + w, (after.get(p * V + w) ?? 0) + 1); before.set(w * V + p, (before.get(w * V + p) ?? 0) + 1); }
    for (let d = 1; d <= WIN && i + d < N; d++) {
      const o = id[i + d]; if (o === w) continue;
      if (isContent[o]) orbit.set(w * V + o, (orbit.get(w * V + o) ?? 0) + 1 / d);
      if (isContent[w]) orbit.set(o * V + w, (orbit.get(o * V + w) ?? 0) + 1 / d);
    }
  }
  const group = (src: Map<number, number>) => { const g = new Map<number, Map<number, number>>(); for (const [k, c] of src) { const a = Math.floor(k / V), b = k % V; (g.get(a) ?? g.set(a, new Map()).get(a)!).set(b, c); } return g; };
  const gBefore = group(before), gAfter = group(after), gOrbit = group(orbit);
  const wordIndex: Record<string, WordEntry> = {};
  for (let w = 0; w < V; w++) {
    const ob = gOrbit.get(w);
    wordIndex[list[w]] = {
      n: count[w], function: isFn[w], layers: layerCount[w], first: first[w], last: last[w], density: [...density[w]],
      before: topEntries(gBefore.get(w) ?? new Map(), 5).map(([o, c]) => [list[o], c] as [string, number]),
      after: topEntries(gAfter.get(w) ?? new Map(), 5).map(([o, c]) => [list[o], c] as [string, number]),
      orbit: ob ? topEntries(new Map([...ob].map(([o, c]) => [o, c * Math.max(0.2, idf(o))] as [number, number])), 8).map(([o]) => list[o]) : [],
    };
  }

  return { language: lang, words: N, layers: NL, layerSource: source, elapsedMs: Date.now() - t0, nodes, links, wordIndex };
}
