import { INGREDIENTS } from './config.js';

const KEY = 'philia.mix.v1';
const empty = () => ({ version: 1, sequence: [], parts: [], pigments: [] });
let store = empty();
let seq = 0;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage unavailable: keep in memory */ }
}

export function load() {
  const s = read();
  if (s && s.version === 1) { store = s; seq = s.sequence.length; }
  return store;
}
export function reset() {
  store = empty();
  seq = 0;
  save();
}
export function logAction(id) {
  store.sequence.push({ n: ++seq, id, at: Date.now() });
  save();
  return seq;
}
// position: slime-local metres. rotation: quaternion [x,y,z,w]. count > 1 only for glitter pinches.
export function addPart(rec) { store.parts.push(rec); save(); }
export function addPigment(rec) { store.pigments.push(rec); save(); }

export function summary() {
  const parts = {};
  const pigments = {};
  for (const p of store.parts) parts[p.type] = (parts[p.type] || 0) + (p.count || 1);
  for (const p of store.pigments) pigments[p.type] = (pigments[p.type] || 0) + 1;
  const used = INGREDIENTS.filter((i) => parts[i.id] || pigments[i.id]);
  return {
    parts,
    pigments,
    actions: store.sequence.length,
    ingredients: used.map((i) => ({ id: i.id, name: i.name, meaning: i.meaning, tags: i.tags })),
    tags: [...new Set(used.flatMap((i) => i.tags))],
  };
}
export function touch() { save(); }
export const snapshot = () => JSON.parse(JSON.stringify(store));
