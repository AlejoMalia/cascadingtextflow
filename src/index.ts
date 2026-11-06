/**
 * Cascading Textflow — one engine, any text.
 * read(text) turns letters into words, words into nodes (chains of letters that recur), gives each
 * node its solar system (the words that orbit it) and traces everything across the layers of the text.
 * No AI model, no network.
 */
export { read } from './core/engine';
export type { TextFlow, TextNode, Link, WordEntry, ReadOptions, Lang } from './core/engine';
