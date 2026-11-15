import { areaWeightedCentroid, isCounterClockwise, polygonAreaHa, type LngLat } from '../geo';

/** Erro de importação com mensagem pronta para mostrar na tela. */
export class KmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmlError';
  }
}

export interface ImportedPaddock {
  name: string;
  /** Nome da pasta do Google Earth onde o polígono estava, se houver. */
  folder: string | null;
  /** Contorno em lat/lon originais, sem repetir o primeiro vértice no fim. */
  outer: LngLat[];
  /** Buracos (innerBoundaryIs), já descontados da área. */
  holes: LngLat[][];
  areaHa: number;
  /** Sugestão pelo nome (reserva, sede, represa...). O usuário confirma ou troca no mapa. */
  grazing: boolean;
}

export interface ImportedWaterPoint {
  name: string;
  position: LngLat;
}

export interface KmlImport {
  paddocks: ImportedPaddock[];
  waterPoints: ImportedWaterPoint[];
  /** Centroide ponderado pela área dos polígonos de pastejo. */
  centroid: { lat: number; lon: number } | null;
  /** O que o arquivo tinha e não virou piquete, para a tela poder avisar. */
  ignored: {
    /** Caminhos (LineString). No Google Earth é comum desenhar piquete como caminho por engano. */
    lines: number;
    /** Polígonos com menos de três vértices distintos ou área zero. */
    invalidPolygons: number;
  };
}

// Mesma lista do simulador (constante NONG).
const NON_GRAZING = /reserva|app\b|sede|aguada|represa|mata|lago|curral|estrada|benfeitoria/i;

export function suggestGrazing(name: string): boolean {
  return !NON_GRAZING.test(name);
}

// O KML pode vir com ou sem prefixo de namespace (kml:Placemark). O '*' aceita os dois.
function all(el: Element | Document, tag: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', tag));
}

function childText(el: Element, tag: string): string {
  for (const c of Array.from(el.children)) {
    if (c.localName === tag) return (c.textContent ?? '').trim();
  }
  return '';
}

function folderOf(el: Element): string | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName === 'Folder') return childText(p, 'name') || null;
  }
  return null;
}

function parseCoordinates(text: string): LngLat[] {
  const out: LngLat[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const parts = tuple.split(',');
    if (parts.length < 2 || parts[0] === '' || parts[1] === '') continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new KmlError(`Coordenada fora do intervalo no arquivo (${tuple}).`);
    }
    out.push([lng, lat]);
  }
  return out;
}

const same = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Tira vértices repetidos em sequência e o fechamento (último igual ao primeiro). */
function cleanRing(points: LngLat[]): LngLat[] {
  const ring: LngLat[] = [];
  for (const p of points) {
    if (!ring.length || !same(ring[ring.length - 1], p)) ring.push(p);
  }
  if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}

function ringOf(boundary: Element): LngLat[] {
  const coords = all(boundary, 'coordinates')[0];
  return coords ? cleanRing(parseCoordinates(coords.textContent ?? '')) : [];
}

/**
 * Lê o texto de um KML. Cada polígono vira um piquete com as coordenadas originais
 * em lat/lon; pontos viram bebedouros. Portado de `parseKML` do simulador, com três
 * diferenças: guarda lat/lon (o simulador convertia para metros e descartava),
 * desconta buracos do polígono e aceita tags com prefixo de namespace.
 */
export function parseKml(text: string): KmlImport {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    throw new KmlError('Arquivo KML inválido.');
  }
  if (all(doc, 'parsererror').length || !all(doc, 'kml').length) {
    throw new KmlError('Arquivo KML inválido.');
  }

  const paddocks: ImportedPaddock[] = [];
  const waterPoints: ImportedWaterPoint[] = [];
  const ignored = { lines: 0, invalidPolygons: 0 };

  for (const placemark of all(doc, 'Placemark')) {
    const name = childText(placemark, 'name');
    const polygons = all(placemark, 'Polygon');

    if (!polygons.length) {
      const point = all(placemark, 'Point')[0];
      if (point) {
        const [position] = ringOf(point);
        if (position) waterPoints.push({ name, position });
      } else if (all(placemark, 'LineString').length) {
        ignored.lines += 1;
      }
      continue;
    }

    polygons.forEach((polygon, k) => {
      const outerEl = all(polygon, 'outerBoundaryIs')[0];
      const outer = outerEl ? ringOf(outerEl) : [];
      const holes = all(polygon, 'innerBoundaryIs')
        // KML antigo permite vários anéis dentro de um único innerBoundaryIs.
        .flatMap((inner) => {
          const rings = all(inner, 'LinearRing');
          return rings.length ? rings.map(ringOf) : [ringOf(inner)];
        })
        .filter((h) => h.length >= 3);
      const areaHa = polygonAreaHa(outer, holes);
      if (outer.length < 3 || areaHa <= 0) {
        ignored.invalidPolygons += 1;
        return;
      }
      const base = name || `Polígono ${paddocks.length + 1}`;
      const fullName = polygons.length > 1 ? `${base} (${k + 1})` : base;
      paddocks.push({
        name: fullName,
        folder: folderOf(placemark),
        outer,
        holes,
        areaHa,
        grazing: suggestGrazing(fullName),
      });
    });
  }

  if (!paddocks.length) {
    throw new KmlError(
      ignored.lines
        ? 'Nenhum polígono encontrado no arquivo. Ele só tem caminhos; no Google Earth os piquetes precisam ser desenhados como polígono.'
        : 'Nenhum polígono encontrado no arquivo.',
    );
  }

  return {
    paddocks,
    waterPoints,
    centroid: grazingCentroid(paddocks),
    ignored,
  };
}

/** Centroide dos piquetes marcados como pastejo. Recalcular quando o usuário marcar ou desmarcar um. */
export function grazingCentroid(paddocks: readonly Pick<ImportedPaddock, 'outer' | 'grazing'>[]) {
  return areaWeightedCentroid(paddocks.filter((p) => p.grazing).map((p) => p.outer));
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

/**
 * Polígono no formato gravado no banco (coluna `paddocks.geom`). Anéis fechados,
 * contorno no sentido anti-horário e buracos no horário, como pede a RFC 7946.
 */
export function toGeoJsonPolygon(p: Pick<ImportedPaddock, 'outer' | 'holes'>): GeoJsonPolygon {
  const close = (ring: readonly LngLat[], ccw: boolean): [number, number][] => {
    const oriented = isCounterClockwise(ring) === ccw ? [...ring] : [...ring].reverse();
    const pts = oriented.map(([lng, lat]): [number, number] => [lng, lat]);
    pts.push([pts[0][0], pts[0][1]]);
    return pts;
  };
  return { type: 'Polygon', coordinates: [close(p.outer, true), ...p.holes.map((h) => close(h, false))] };
}
