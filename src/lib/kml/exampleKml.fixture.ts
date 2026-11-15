// Fazenda de exemplo do simulador (reference/simulador/app.html: EX, EX_WATER, exampleKML).
// Os polígonos estão em unidades de tela; cada unidade vale 4 m no terreno.

type P = [number, number];

export const EX: P[][] = [
  [[60, 60], [230, 30], [220, 170], [40, 190]],
  [[230, 30], [420, 50], [410, 200], [220, 170]],
  [[420, 50], [600, 25], [610, 175], [410, 200]],
  [[600, 25], [760, 70], [775, 210], [610, 175]],
  [[40, 190], [220, 170], [240, 330], [55, 340]],
  [[220, 170], [410, 200], [400, 350], [240, 330]],
  [[410, 200], [610, 175], [590, 335], [400, 350]],
  [[610, 175], [775, 210], [750, 360], [590, 335]],
  [[55, 340], [240, 330], [250, 495], [90, 480]],
  [[240, 330], [400, 350], [430, 470], [250, 495]],
  [[400, 350], [590, 335], [600, 500], [430, 470]],
  [[590, 335], [750, 360], [720, 470], [600, 500]],
];

export const EX_WATER: P[] = [[220, 170], [410, 200], [610, 175], [240, 330], [400, 350], [590, 335]];

export const RESERVA: P[] = [[760, 70], [870, 95], [880, 340], [750, 360], [775, 210]];

const LAT0 = -14.8612;
const LON0 = -40.839;
const M_PER_UNIT = 4;

/** Área que o simulador calcula para um polígono em unidades de tela, em hectares. */
export function simulatorAreaHa(pts: P[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return (Math.abs(a) / 2) * M_PER_UNIT * M_PER_UNIT / 1e4;
}

/** Mesmo arquivo que o botão "Usar KML de exemplo" do simulador gera. */
export function exampleKml(): string {
  const kx = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
  const ky = 1 / 110540;
  const ll = ([x, y]: P) => [
    (LON0 + (x - 400) * M_PER_UNIT * kx).toFixed(6),
    (LAT0 - (y - 260) * M_PER_UNIT * ky).toFixed(6),
  ];
  const ring = (pts: P[]) => [...pts, pts[0]].map((q) => `${ll(q).join(',')},0`).join(' ');
  const poly = (name: string, pts: P[]) =>
    `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(pts)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  let pm = EX.map((p, i) => poly(`Pasto ${String(i + 1).padStart(2, '0')}`, p)).join('');
  pm += poly('Reserva legal', RESERVA);
  pm += EX_WATER.map(
    (w, i) =>
      `<Placemark><name>Bebedouro ${i + 1}</name><Point><coordinates>${ll(w).join(',')},0</coordinates></Point></Placemark>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Fazenda Nova</name>${pm}</Document></kml>`;
}

/** Quadrado de `sizeDeg` graus de lado centrado em (lat, lon), fechado, no formato de <coordinates>. */
export function squareCoords(lat: number, lon: number, sizeDeg: number): string {
  const h = sizeDeg / 2;
  const pts = [
    [lon - h, lat - h],
    [lon + h, lat - h],
    [lon + h, lat + h],
    [lon - h, lat + h],
    [lon - h, lat - h],
  ];
  return pts.map((p) => `${p[0]},${p[1]},0`).join(' ');
}
