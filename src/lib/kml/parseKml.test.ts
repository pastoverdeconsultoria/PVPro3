import { describe, expect, it } from 'vitest';
import { KmlError, grazingCentroid, parseKml, suggestGrazing, toGeoJsonPolygon } from './parseKml';
import { EX, RESERVA, exampleKml, simulatorAreaHa, squareCoords } from './exampleKml.fixture';
import { isCounterClockwise } from '../geo';

const kml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

const polygon = (name: string, outer: string, inner = '') =>
  `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;

describe('KML de exemplo do simulador', () => {
  const r = parseKml(exampleKml());

  it('lê os 13 polígonos e os 6 bebedouros', () => {
    expect(r.paddocks).toHaveLength(13);
    expect(r.waterPoints).toHaveLength(6);
    expect(r.paddocks[0].name).toBe('Pasto 01');
    expect(r.waterPoints[0].name).toBe('Bebedouro 1');
    expect(r.ignored).toEqual({ lines: 0, invalidPolygons: 0 });
  });

  it('sugere a reserva legal como fora do pastejo e os pastos como pastejo', () => {
    const off = r.paddocks.filter((p) => !p.grazing).map((p) => p.name);
    expect(off).toEqual(['Reserva legal']);
  });

  it('as áreas batem com as do simulador (diferença abaixo de 0,3%)', () => {
    const expected = [...EX, RESERVA].map(simulatorAreaHa);
    r.paddocks.forEach((p, i) => {
      expect(Math.abs(p.areaHa - expected[i]) / expected[i]).toBeLessThan(0.003);
    });
    // Área útil da fazenda de exemplo no simulador: 494,8 ha (o painel mostra esse número).
    const util = r.paddocks.filter((p) => p.grazing).reduce((s, p) => s + p.areaHa, 0);
    expect(Math.abs(util - 494.8) / 494.8).toBeLessThan(0.003);
  });

  it('guarda lat/lon originais e tira o vértice de fechamento', () => {
    const p = r.paddocks[0];
    expect(p.outer).toHaveLength(4);
    for (const [lng, lat] of p.outer) {
      expect(lng).toBeGreaterThan(-41);
      expect(lng).toBeLessThan(-40.7);
      expect(lat).toBeGreaterThan(-14.9);
      expect(lat).toBeLessThan(-14.8);
    }
  });

  it('o centroide fica dentro da fazenda e ignora a reserva', () => {
    expect(r.centroid!.lat).toBeGreaterThan(-14.88);
    expect(r.centroid!.lat).toBeLessThan(-14.85);
    expect(r.centroid!.lon).toBeGreaterThan(-40.85);
    expect(r.centroid!.lon).toBeLessThan(-40.83);
    // Incluir a reserva (que fica a leste) puxa o centroide para leste.
    const withReserva = grazingCentroid(r.paddocks.map((p) => ({ ...p, grazing: true })))!;
    expect(withReserva.lon).toBeGreaterThan(r.centroid!.lon);
  });
});

describe('formatos que aparecem em arquivo real', () => {
  it('desconta o buraco do polígono (innerBoundaryIs)', () => {
    const full = parseKml(kml(polygon('A', squareCoords(-15, -40, 0.01)))).paddocks[0];
    const holed = parseKml(
      kml(
        polygon(
          'A',
          squareCoords(-15, -40, 0.01),
          `<innerBoundaryIs><LinearRing><coordinates>${squareCoords(-15, -40, 0.005)}</coordinates></LinearRing></innerBoundaryIs>`,
        ),
      ),
    ).paddocks[0];
    expect(holed.holes).toHaveLength(1);
    expect(holed.areaHa / full.areaHa).toBeCloseTo(0.75, 4);
    // Tabela geodésica: 0,01 grau na latitude 15 dá 1106,49 m por 1075,50 m, ou 119,0 ha.
    expect(full.areaHa).toBeCloseTo(119.0, 1);
  });

  it('exportação do Google Earth: pastas, estilos, quebras de linha e altitude', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Fazenda.kml</name>
  <Style id="poly"><LineStyle><color>ff00ff00</color></LineStyle></Style>
  <Folder>
    <name>Piquetes</name>
    <Folder>
      <name>Módulo 1</name>
      <Placemark>
        <name>Piquete 1</name>
        <styleUrl>#poly</styleUrl>
        <Polygon>
          <tessellate>1</tessellate>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>
                -40.005,-15.005,0 -39.995,-15.005,0
                -39.995,-14.995,0
\t\t\t\t-40.005,-14.995,0 -40.005,-15.005,0
              </coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    </Folder>
  </Folder>
  <Folder>
    <name>Benfeitorias</name>
    <Placemark><name>Sede</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${squareCoords(-15.02, -40, 0.002)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Cerca nova</name><LineString><coordinates>-40,-15,0 -40.01,-15,0</coordinates></LineString></Placemark>
    <Placemark><name>Cocho</name><Point><coordinates>-40.001,-15.001,0</coordinates></Point></Placemark>
  </Folder>
</Document>
</kml>`;
    const r = parseKml(text);
    expect(r.paddocks.map((p) => [p.name, p.folder, p.grazing])).toEqual([
      ['Piquete 1', 'Módulo 1', true],
      ['Sede', 'Benfeitorias', false],
    ]);
    expect(r.paddocks[0].outer).toHaveLength(4);
    expect(r.paddocks[0].areaHa).toBeCloseTo(119.0, 1);
    expect(r.waterPoints).toEqual([{ name: 'Cocho', position: [-40.001, -15.001] }]);
    expect(r.ignored.lines).toBe(1);
  });

  it('MultiGeometry vira um piquete por polígono, numerado', () => {
    const r = parseKml(
      kml(
        `<Placemark><name>Pasto</name><MultiGeometry>
          <Polygon><outerBoundaryIs><LinearRing><coordinates>${squareCoords(-15, -40, 0.01)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
          <Polygon><outerBoundaryIs><LinearRing><coordinates>${squareCoords(-15, -39.98, 0.01)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
        </MultiGeometry></Placemark>`,
      ),
    );
    expect(r.paddocks.map((p) => p.name)).toEqual(['Pasto (1)', 'Pasto (2)']);
  });

  it('aceita tags com prefixo de namespace', () => {
    const text = `<?xml version="1.0"?><kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document><kml:Placemark><kml:name>P1</kml:name><kml:Polygon><kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>${squareCoords(-15, -40, 0.01)}</kml:coordinates></kml:LinearRing></kml:outerBoundaryIs></kml:Polygon></kml:Placemark></kml:Document></kml:kml>`;
    expect(parseKml(text).paddocks[0].name).toBe('P1');
  });

  it('polígono sem nome ganha nome provisório; polígono degenerado é contado e ignorado', () => {
    const r = parseKml(
      kml(polygon('', squareCoords(-15, -40, 0.01)) + polygon('Torto', '-40,-15,0 -40.01,-15,0 -40,-15,0')),
    );
    expect(r.paddocks.map((p) => p.name)).toEqual(['Polígono 1']);
    expect(r.ignored.invalidPolygons).toBe(1);
  });
});

describe('erros', () => {
  const message = (text: string) => {
    try {
      parseKml(text);
    } catch (e) {
      expect(e).toBeInstanceOf(KmlError);
      return (e as Error).message;
    }
    throw new Error('devia ter falhado');
  };

  it('XML quebrado', () => {
    expect(message('<kml><Document>')).toBe('Arquivo KML inválido.');
  });

  it('XML que não é KML', () => {
    expect(message('<?xml version="1.0"?><gpx></gpx>')).toBe('Arquivo KML inválido.');
  });

  it('arquivo sem polígono', () => {
    expect(message(kml('<Placemark><name>X</name><Point><coordinates>-40,-15,0</coordinates></Point></Placemark>'))).toBe(
      'Nenhum polígono encontrado no arquivo.',
    );
  });

  it('arquivo só com caminhos explica o motivo', () => {
    expect(
      message(kml('<Placemark><name>P1</name><LineString><coordinates>-40,-15,0 -40.01,-15,0 -40.01,-15.01,0</coordinates></LineString></Placemark>')),
    ).toContain('precisam ser desenhados como polígono');
  });

  it('coordenada fora do intervalo (lat e lon trocadas)', () => {
    expect(message(kml(polygon('A', '-15,-140,0 -15.01,-140,0 -15.01,-140.01,0')))).toContain('Coordenada fora do intervalo');
  });
});

describe('apoio', () => {
  it('sugestão de pastejo pelo nome', () => {
    expect(suggestGrazing('Pasto 03')).toBe(true);
    expect(suggestGrazing('Reserva Legal')).toBe(false);
    expect(suggestGrazing('APP')).toBe(false);
    expect(suggestGrazing('Represa do fundo')).toBe(false);
    expect(suggestGrazing('Curral')).toBe(false);
  });

  it('GeoJSON sai fechado, contorno anti-horário e buraco horário', () => {
    // Contorno dado no sentido horário de propósito.
    const outer = squareCoords(-15, -40, 0.01).split(' ').reverse().join(' ');
    const p = parseKml(
      kml(
        polygon(
          'A',
          outer,
          `<innerBoundaryIs><LinearRing><coordinates>${squareCoords(-15, -40, 0.005)}</coordinates></LinearRing></innerBoundaryIs>`,
        ),
      ),
    ).paddocks[0];
    const g = toGeoJsonPolygon(p);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(2);
    for (const ring of g.coordinates) {
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[4]);
    }
    expect(isCounterClockwise(g.coordinates[0].slice(0, -1))).toBe(true);
    expect(isCounterClockwise(g.coordinates[1].slice(0, -1))).toBe(false);
  });
});
