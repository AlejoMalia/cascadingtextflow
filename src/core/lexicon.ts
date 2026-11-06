/**
 * lexicon.ts — the only language data the engine uses: a list of function words per language.
 * For any other language the engine derives its function words from the text itself.
 */

export type Lang = 'es' | 'en' | 'auto';

export interface Lexicon {
  /** function words: they never start or end a node and carry no weight */
  stop: Set<string>;
}

const ES_STOP = 'el la los las un una unos unas de del al a en por con y o u e que se su sus lo le les me te mi tu nos os mis tus como más muy no sí si ni sino pero mas para entre hasta desde hacia sobre tras ante bajo este esta esto estos estas ese esa eso esos esas aquel aquella aquello cuando donde quien quienes cual cuales cuyo todo toda todos todas otro otra otros otras mismo misma ya ahora entonces después antes siempre nunca también así aquí allí allá era eran fue fueron ser es son está están estaba había han ha he hay habían tiene tenía hace hacía puede podía dijo digo dice ver vi vio yo él ella ellos ellas nosotros usted ustedes mí ti qué cómo cuándo dónde quién tan tanto pues aun aún solo sólo cada algo nada alguien nadie uno dos tres ahí tal vez aunque porque mientras durante según cuyas sin hacer hizo van vamos voy vas'.split(' ');
const EN_STOP = 'the a an and or but of to in on at for from with by as is was were be been he she it they we you i his her its their our my your him them me us this that these those not no so if then than when while which who whom what where how there here had has have do did does would could should will can may might also just very more most some any all each other into out up down over under after before about against between through during again once only own same too said say says'.split(' ');

export const LEXICONS: Record<Lang, Lexicon> = {
  es:   { stop: new Set(ES_STOP) },
  en:   { stop: new Set(EN_STOP) },
  auto: { stop: new Set() },
};

/** Pick the language by counting which function-word list the text hits more. */
export function detectLang(sample: string): Lang {
  const words = sample.slice(0, 40000).toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let es = 0, en = 0;
  for (const w of words) { if (LEXICONS.es.stop.has(w)) es++; if (LEXICONS.en.stop.has(w)) en++; }
  if (Math.max(es, en) < words.length * 0.08) return 'auto';
  return es > en ? 'es' : 'en';
}
