import type { NewFarm } from '../../data/types';
import {
  grazingCentroid,
  toGeoJsonPolygon,
  type ImportedPaddock,
  type ImportedWaterPoint,
  type KmlImport,
} from '../kml/parseKml';
import type { Result } from '../lots/changes';

/** Capins oferecidos na abertura. O Tb do modelo de projeção depende do capim (decumbens e humidícola: 15,5 °C). */
export const SPECIES = ['Marandu', 'Mombaça', 'Tanzânia', 'Decumbens', 'Humidícola', 'Piatã', 'Tamani', 'Zuri', 'Outro'] as const;

/** Um polígono do arquivo, com o que o usuário pode ajustar antes de abrir a fazenda. */
export interface PaddockDraft {
  source: ImportedPaddock;
  name: string;
  grazing: boolean;
  species: string | null;
}

export function draftsFromImport(imp: KmlImport): PaddockDraft[] {
  return imp.paddocks.map((p) => ({ source: p, name: p.name, grazing: p.grazing, species: null }));
}

export function draftTotals(drafts: readonly PaddockDraft[]) {
  const grazing = drafts.filter((d) => d.grazing);
  return {
    count: drafts.length,
    grazingCount: grazing.length,
    totalHa: drafts.reduce((s, d) => s + d.source.areaHa, 0),
    grazingHa: grazing.reduce((s, d) => s + d.source.areaHa, 0),
  };
}

/** Monta a fazenda para gravar, com os ids gerados no aparelho. Devolve o erro em texto se faltar algo. */
export function buildNewFarm(
  input: { name: string; municipality: string; drafts: readonly PaddockDraft[]; waterPoints: readonly ImportedWaterPoint[] },
  newId: () => string = () => crypto.randomUUID(),
): Result<NewFarm> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Dê um nome à fazenda.' };
  if (!input.drafts.length) return { ok: false, error: 'Escolha o arquivo KML ou KMZ da fazenda.' };
  if (!input.drafts.some((d) => d.grazing)) return { ok: false, error: 'Marque pelo menos um piquete como pastejo.' };

  const seen = new Set<string>();
  for (const d of input.drafts) {
    const n = d.name.trim();
    if (!n) return { ok: false, error: 'Há piquete sem nome.' };
    if (seen.has(n.toLowerCase())) return { ok: false, error: `Dois piquetes com o nome "${n}". Dê nomes diferentes.` };
    seen.add(n.toLowerCase());
  }

  const farmId = newId();
  return {
    ok: true,
    value: {
      farm: {
        id: farmId,
        name,
        municipality: input.municipality.trim() || null,
        // O clima é buscado pelo centroide da área de pastejo.
        centroid: grazingCentroid(input.drafts.map((d) => ({ outer: d.source.outer, grazing: d.grazing }))),
      },
      paddocks: input.drafts.map((d, i) => ({
        id: newId(),
        farmId,
        name: d.name.trim(),
        folder: d.source.folder,
        geom: toGeoJsonPolygon(d.source),
        areaHa: Number(d.source.areaHa.toFixed(4)),
        species: d.species,
        isGrazing: d.grazing,
        initialLastExit: null,
        sort: i,
      })),
      waterPoints: input.waterPoints.map((w) => ({
        id: newId(),
        farmId,
        name: w.name || null,
        lat: w.position[1],
        lon: w.position[0],
      })),
    },
  };
}
