import type { Paddock } from '../../data/types';

/**
 * Tira a área que muita gente escreve junto do nome no Google Earth:
 * "A1 — 15.7 ha", "Bloco A – 24,69 ha", "P3 - 12 ha", "Pasto 4 (18,5 ha)".
 * A área de verdade é calculada do polígono; no nome ela só atrapalha a leitura.
 */
export function cleanPaddockName(name: string): string {
  const cleaned = name
    .replace(/\s*[(\[]\s*\d+(?:[.,]\d+)?\s*ha\s*[)\]]\s*$/i, '')
    .replace(/\s*[—–\-:,]\s*\d+(?:[.,]\d+)?\s*ha\s*$/i, '')
    .trim();
  return cleaned || name.trim();
}

/** Nomes que mudariam com a limpeza, sem criar dois piquetes com o mesmo nome. */
export function namesToClean(paddocks: readonly Pick<Paddock, 'id' | 'name'>[]): { id: string; from: string; to: string }[] {
  const final = new Map(paddocks.map((p) => [p.id, p.name.trim().toLowerCase()]));
  const out: { id: string; from: string; to: string }[] = [];
  for (const p of paddocks) {
    const to = cleanPaddockName(p.name);
    if (to === p.name) continue;
    // Se o nome limpo já é de outro piquete, este fica como está.
    const taken = [...final.entries()].some(([id, n]) => id !== p.id && n === to.toLowerCase());
    if (taken) continue;
    final.set(p.id, to.toLowerCase());
    out.push({ id: p.id, from: p.name, to });
  }
  return out;
}

/**
 * Grupo natural de um piquete, para montar módulo de uma vez: a pasta do Google
 * Earth, se houver; senão as letras do começo do nome ("A12" → "A", "Setor 3" →
 * "Setor").
 */
export function groupOf(p: Pick<Paddock, 'name' | 'folder'>): string {
  if (p.folder?.trim()) return cleanPaddockName(p.folder);
  const letters = cleanPaddockName(p.name).match(/^[A-Za-zÀ-ÿ]+/)?.[0];
  return letters ?? 'Outros';
}

/** Ordem de leitura humana: A2 antes de A10. */
export const byName = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
