/** Coordenada na ordem do KML e do GeoJSON: longitude primeiro, depois latitude, em graus. */
export type LngLat = readonly [lng: number, lat: number];

type XY = readonly [x: number, y: number];

// Elipsoide WGS84.
const SEMI_MAJOR_M = 6378137;
const ECC2 = 0.00669437999014;
const RAD = Math.PI / 180;

/**
 * Projeção plana local em metros, centrada em `origin`. Usa os raios de curvatura
 * do elipsoide na latitude da origem, então vale para o tamanho de uma fazenda
 * (alguns km). O simulador usava constantes fixas (111 320 e 110 540 m por grau),
 * que na Bahia dão área cerca de 0,1% menor.
 */
export function localProjector(origin: LngLat): (p: LngLat) => XY {
  const lat0 = origin[1] * RAD;
  const s = Math.sin(lat0);
  const w = 1 - ECC2 * s * s;
  const mPerRadEast = (SEMI_MAJOR_M / Math.sqrt(w)) * Math.cos(lat0);
  const mPerRadNorth = (SEMI_MAJOR_M * (1 - ECC2)) / (w * Math.sqrt(w));
  return ([lng, lat]) => [(lng - origin[0]) * RAD * mPerRadEast, (lat - origin[1]) * RAD * mPerRadNorth];
}

function meanPoint(points: readonly LngLat[]): LngLat {
  let lng = 0;
  let lat = 0;
  for (const p of points) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / points.length, lat / points.length];
}

/** Área com sinal (fórmula do cadarço). Positiva quando o anel gira no sentido anti-horário. */
function signedArea(ring: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Área de um anel em m². O anel não repete o primeiro vértice no fim. */
export function ringAreaM2(ring: readonly LngLat[]): number {
  if (ring.length < 3) return 0;
  const project = localProjector(meanPoint(ring));
  return Math.abs(signedArea(ring.map(project)));
}

/** Área de um polígono em hectares, descontando os buracos. */
export function polygonAreaHa(outer: readonly LngLat[], holes: readonly (readonly LngLat[])[] = []): number {
  let m2 = ringAreaM2(outer);
  for (const h of holes) m2 -= ringAreaM2(h);
  return Math.max(0, m2) / 10_000;
}

/** Verdadeiro quando o anel gira no sentido anti-horário visto de cima (norte para cima). */
export function isCounterClockwise(ring: readonly LngLat[]): boolean {
  return signedArea(ring) > 0;
}

/**
 * Centroide ponderado pela área de um conjunto de anéis. É o ponto por onde o clima
 * da fazenda é buscado. Devolve null se não houver área.
 */
export function areaWeightedCentroid(rings: readonly (readonly LngLat[])[]): { lat: number; lon: number } | null {
  const valid = rings.filter((r) => r.length >= 3);
  if (!valid.length) return null;
  const origin = meanPoint(valid.flat());
  const project = localProjector(origin);

  let total = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of valid) {
    const pts = ring.map(project);
    const a = signedArea(pts);
    if (Math.abs(a) < 1e-9) continue;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const c = x1 * y2 - x2 * y1;
      sx += (x1 + x2) * c;
      sy += (y1 + y2) * c;
    }
    const area = Math.abs(a);
    total += area;
    cx += (sx / (6 * a)) * area;
    cy += (sy / (6 * a)) * area;
  }
  if (!total) return null;

  // Desfaz a projeção: metros de volta para graus em torno da origem.
  const [ex, ny] = project([origin[0] + 1, origin[1] + 1]);
  return { lon: origin[0] + cx / total / ex, lat: origin[1] + cy / total / ny };
}
