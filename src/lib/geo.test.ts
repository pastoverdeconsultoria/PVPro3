import { describe, expect, it } from 'vitest';
import { areaWeightedCentroid, isCounterClockwise, polygonAreaHa, ringAreaM2, type LngLat } from './geo';

function square(lat: number, lon: number, size: number): LngLat[] {
  const h = size / 2;
  return [
    [lon - h, lat - h],
    [lon + h, lat - h],
    [lon + h, lat + h],
    [lon - h, lat + h],
  ];
}

describe('área', () => {
  // Referência independente: comprimento de 1 grau de latitude e de longitude no
  // elipsoide WGS84 (tabela clássica de geodésia). Um quadrado de 0,01 grau tem
  // um centésimo desses lados.
  it.each([
    { lat: 0, kmLat: 110.574, kmLon: 111.32 },
    { lat: -15, kmLat: 110.649, kmLon: 107.55 },
    { lat: 45, kmLat: 111.132, kmLon: 78.847 },
  ])('quadrado de 0,01 grau na latitude $lat bate com a tabela geodésica', ({ lat, kmLat, kmLon }) => {
    const expectedM2 = kmLat * 10 * (kmLon * 10);
    const got = ringAreaM2(square(lat, -40, 0.01));
    expect(Math.abs(got - expectedM2) / expectedM2).toBeLessThan(0.0002);
  });

  it('não depende do sentido nem do vértice inicial', () => {
    const ring = square(-15, -40, 0.01);
    const a = ringAreaM2(ring);
    expect(ringAreaM2([...ring].reverse())).toBeCloseTo(a, 6);
    expect(ringAreaM2([...ring.slice(2), ...ring.slice(0, 2)])).toBeCloseTo(a, 6);
  });

  it('desconta os buracos', () => {
    const outer = square(-15, -40, 0.01);
    const hole = square(-15, -40, 0.005);
    const full = polygonAreaHa(outer);
    expect(polygonAreaHa(outer, [hole]) / full).toBeCloseTo(0.75, 4);
  });

  it('anel com menos de três vértices tem área zero', () => {
    expect(ringAreaM2([[-40, -15], [-40.01, -15]])).toBe(0);
  });
});

describe('sentido do anel', () => {
  it('reconhece anti-horário e horário', () => {
    const ccw = square(-15, -40, 0.01);
    expect(isCounterClockwise(ccw)).toBe(true);
    expect(isCounterClockwise([...ccw].reverse())).toBe(false);
  });
});

describe('centroide', () => {
  it('de um quadrado é o centro', () => {
    const c = areaWeightedCentroid([square(-15.25, -40.25, 0.02)])!;
    expect(c.lat).toBeCloseTo(-15.25, 6);
    expect(c.lon).toBeCloseTo(-40.25, 6);
  });

  it('pesa pela área: fica mais perto do polígono maior', () => {
    const big = square(-15, -40, 0.02); // quatro vezes a área do pequeno
    const small = square(-15, -39.9, 0.01);
    const c = areaWeightedCentroid([big, small])!;
    expect(c.lat).toBeCloseTo(-15, 5);
    // Média ponderada 4:1 entre -40 e -39,9.
    expect(c.lon).toBeCloseTo(-39.98, 4);
  });

  it('devolve null sem área', () => {
    expect(areaWeightedCentroid([])).toBeNull();
    expect(areaWeightedCentroid([[[-40, -15], [-40.01, -15]]])).toBeNull();
  });
});
