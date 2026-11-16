import type { NewFarm } from '../data/types';
import { buildNewFarm, draftsFromImport } from '../lib/farm/newFarm';
import { exampleKml } from '../lib/kml/exampleKml.fixture';
import { parseKml } from '../lib/kml/parseKml';

/** A fazenda inventada do simulador (12 piquetes e uma reserva), pronta para gravar. */
export function exampleNewFarm(name = 'Fazenda Exemplo'): NewFarm {
  const imp = parseKml(exampleKml());
  const r = buildNewFarm({
    name,
    municipality: 'Itapetinga, BA',
    // Nomes curtos como no mapa do simulador: 'Pasto 01' vira 'P01'.
    drafts: draftsFromImport(imp).map((d) => ({ ...d, name: d.name.replace(/^Pasto /, 'P'), species: 'Marandu' })),
    waterPoints: imp.waterPoints,
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Relógio fixo dos testes: 15 nov 2026, meio-dia. */
export const NOW = () => new Date(2026, 10, 15, 12, 0, 0);
export const TODAY = '2026-11-15';
