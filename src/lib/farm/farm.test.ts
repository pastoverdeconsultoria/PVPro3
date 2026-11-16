// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CompositionRow, FarmData, Lot, Module } from '../../data/types';
import { exampleNewFarm, TODAY } from '../../test/fixtures';
import { formatBr } from '../lots/dates';
import { lotGmd } from '../lots/gmd';
import type { LotEvent } from '../lots/types';
import { deriveFarm, locationText } from './farmView';
import { checkComposition, compositionAt, compositionVersions, moduleViews, paddockModules } from './modules';
import { buildNewFarm, draftsFromImport } from './newFarm';
import { parseKml } from '../kml/parseKml';
import { exampleKml } from '../kml/exampleKml.fixture';

let n = 0;
const id = () => `id-${++n}`;
const lot = (name: string, farmId: string): Lot => ({ id: id(), farmId, name, deletedAt: null });

function farm(): FarmData & { p: (name: string) => string } {
  const nf = exampleNewFarm();
  return {
    farm: nf.farm,
    paddocks: nf.paddocks,
    waterPoints: nf.waterPoints,
    lots: [],
    modules: [],
    compositions: [],
    events: [],
    reports: [],
    rain: [],
    p: (name) => nf.paddocks.find((x) => x.name === name)!.id,
  };
}

const inicio = (l: Lot, date: string, heads: number, weightKg: number, seq: number): LotEvent => ({
  id: id(), lotId: l.id, date, seq, type: 'inicio', heads, weightKg, category: 'Recria',
});
const entra = (l: Lot, date: string, paddockId: string, seq: number): LotEvent => ({
  id: id(), lotId: l.id, date, seq, type: 'piquete_entrada', paddockId,
});
const sai = (l: Lot, date: string, paddockId: string, seq: number): LotEvent => ({
  id: id(), lotId: l.id, date, seq, type: 'piquete_saida', paddockId,
});
const pesa = (l: Lot, date: string, weightKg: number, seq: number): LotEvent => ({
  id: id(), lotId: l.id, date, seq, type: 'pesagem', weightKg,
});

describe('GMD do lote', () => {
  const l = lot('L', 'f');

  it('compara os dois últimos dias com pesagem', () => {
    const g = lotGmd([inicio(l, '2026-09-01', 100, 300, 1), pesa(l, '2026-09-10', 300, 2), pesa(l, '2026-10-10', 318, 3)]);
    expect(g).toEqual({ kgDay: 0.6, from: '2026-09-10', to: '2026-10-10', days: 30 });
  });

  it('o peso do cadastro não conta como pesagem', () => {
    expect(lotGmd([inicio(l, '2026-09-01', 100, 300, 1), pesa(l, '2026-10-01', 330, 2)])).toBeNull();
  });

  it('duas pesagens no mesmo dia dão GMD nulo, sem divisão por zero', () => {
    expect(lotGmd([inicio(l, '2026-09-01', 100, 300, 1), pesa(l, '2026-10-01', 320, 2), pesa(l, '2026-10-01', 330, 3)])).toBeNull();
  });

  it('no mesmo dia vale a pesagem mais recente', () => {
    const g = lotGmd([pesa(l, '2026-10-01', 300, 1), pesa(l, '2026-10-11', 999, 2), pesa(l, '2026-10-11', 305, 3)]);
    expect(g?.kgDay).toBe(0.5);
  });

  it('apagar a última pesagem volta a comparar as duas anteriores', () => {
    const last = { ...pesa(l, '2026-11-01', 400, 3), deletedAt: 'x' };
    const g = lotGmd([pesa(l, '2026-09-01', 300, 1), pesa(l, '2026-10-01', 315, 2), last]);
    expect(g).toMatchObject({ from: '2026-09-01', to: '2026-10-01', kgDay: 0.5 });
  });
});

describe('situação de hoje da fazenda', () => {
  it('piquete ocupado mostra lotação instantânea e dia de uso; vazio mostra descanso', () => {
    const f = farm();
    const l1 = lot('Lote 1', f.farm.id);
    f.lots = [l1];
    f.events = [
      inicio(l1, '2026-10-01', 90, 450, 1),
      entra(l1, '2026-11-01', f.p('P01'), 2),
      sai(l1, '2026-11-13', f.p('P01'), 3),
      entra(l1, '2026-11-13', f.p('P02'), 4),
    ];
    const v = deriveFarm(f, TODAY);
    const p01 = v.paddockById.get(f.p('P01'))!;
    const p02 = v.paddockById.get(f.p('P02'))!;

    expect(p02.occupants.map((o) => o.lot.name)).toEqual(['Lote 1']);
    expect(p02.ua).toBe(90);
    expect(p02.instantUaHa).toBeCloseTo(90 / p02.paddock.areaHa, 10);
    expect(p02.since).toBe('2026-11-13');
    expect(p02.dayOfUse).toBe(3);
    expect(p02.restDays).toBeNull();

    expect(p01.occupants).toEqual([]);
    expect(p01.instantUaHa).toBeNull();
    expect(p01.lastExit).toEqual({ date: '2026-11-13', source: 'historico' });
    expect(p01.restDays).toBe(2);
    expect(p01.lastStay).toEqual({ lotId: l1.id, start: '2026-11-01', end: '2026-11-13', days: 12 });
  });

  it('sem histórico, o descanso usa a saída informada na abertura; sem nada, fica sem dado', () => {
    const f = farm();
    f.paddocks = f.paddocks.map((p) => (p.name === 'P03' ? { ...p, initialLastExit: '2026-11-05' } : p));
    const v = deriveFarm(f, TODAY);
    expect(v.paddockById.get(f.p('P03'))!.restDays).toBe(10);
    expect(v.paddockById.get(f.p('P03'))!.lastExit?.source).toBe('abertura');
    expect(v.paddockById.get(f.p('P04'))!.restDays).toBeNull();
    expect(v.paddockById.get(f.p('P04'))!.lastExit).toBeNull();
  });

  it('lotação global conta só o gado em piquete de pastejo, sobre a área útil', () => {
    const f = farm();
    const [a, b, c] = [lot('A', f.farm.id), lot('B', f.farm.id), lot('C', f.farm.id)];
    f.lots = [a, b, c];
    f.events = [
      inicio(a, '2026-10-01', 100, 450, 1),
      entra(a, '2026-11-01', f.p('P01'), 2),
      inicio(b, '2026-10-01', 50, 450, 3),
      entra(b, '2026-11-01', f.p('Reserva legal'), 4),
      inicio(c, '2026-10-01', 20, 225, 5),
    ];
    const v = deriveFarm(f, TODAY);
    const util = f.paddocks.filter((p) => p.isGrazing).reduce((s, p) => s + p.areaHa, 0);
    expect(v.totals.grazingAreaHa).toBeCloseTo(util, 10);
    expect(v.totals.grazingAreaHa).toBeLessThan(v.totals.totalAreaHa);
    expect(v.totals.uaInPasture).toBe(100);
    expect(v.totals.uaOutside).toBe(60);
    expect(v.totals.uaTotal).toBe(160);
    expect(v.totals.heads).toBe(170);
    expect(v.totals.globalUaHa).toBeCloseTo(100 / util, 10);
    expect(v.totals.occupied).toBe(1);
    expect(v.totals.resting).toBe(11);
  });

  it('sem lote, a lotação global não existe (não vira zero)', () => {
    expect(deriveFarm(farm(), TODAY).totals.globalUaHa).toBeNull();
  });

  it('lote apagado some: o piquete não fica ocupado por lote que não existe mais', () => {
    const f = farm();
    const l1 = lot('Lote 1', f.farm.id);
    f.lots = [{ ...l1, deletedAt: '2026-11-14T10:00:00Z' }];
    f.events = [inicio(l1, '2026-10-01', 90, 450, 1), entra(l1, '2026-11-01', f.p('P01'), 2)];
    const v = deriveFarm(f, TODAY);
    expect(v.lots).toEqual([]);
    expect(v.paddockById.get(f.p('P01'))!.occupants).toEqual([]);
    expect(v.totals.uaTotal).toBe(0);
  });

  it('lote que zerou de cabeças libera o piquete no dia em que zerou', () => {
    const f = farm();
    const l1 = lot('Lote 1', f.farm.id);
    f.lots = [l1];
    f.events = [
      inicio(l1, '2026-10-01', 90, 450, 1),
      entra(l1, '2026-11-01', f.p('P01'), 2),
      { id: id(), lotId: l1.id, date: '2026-11-10', seq: 3, type: 'animais_saida', heads: 90, reason: 'venda' },
    ];
    const v = deriveFarm(f, TODAY);
    expect(v.paddockById.get(f.p('P01'))!.occupants).toEqual([]);
    expect(v.paddockById.get(f.p('P01'))!.restDays).toBe(5);
    expect(v.lots[0].location).toEqual({ kind: 'sem_animais', since: '2026-11-10' });
  });

  it('GMD do rebanho é ponderado por cabeças e ignora lote sem GMD', () => {
    const f = farm();
    const [a, b, c] = [lot('A', f.farm.id), lot('B', f.farm.id), lot('C', f.farm.id)];
    f.lots = [a, b, c];
    f.events = [
      inicio(a, '2026-09-01', 100, 300, 1), pesa(a, '2026-10-01', 300, 2), pesa(a, '2026-10-11', 310, 3),
      inicio(b, '2026-09-01', 300, 300, 4), pesa(b, '2026-10-01', 300, 5), pesa(b, '2026-10-11', 302, 6),
      inicio(c, '2026-09-01', 500, 300, 7),
    ];
    const v = deriveFarm(f, TODAY);
    expect(v.totals.gmdKgDay).toBeCloseTo((1 * 100 + 0.2 * 300) / 400, 10);
    expect(v.lotById.get(c.id)!.gmd).toBeNull();
  });

  it('diz em texto as quatro situações de onde o lote está', () => {
    const f = farm();
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((x) => lot(x, f.farm.id));
    f.lots = [a, b, c, d];
    f.events = [
      inicio(a, '2026-10-01', 10, 300, 1),
      inicio(b, '2026-10-01', 10, 300, 2), entra(b, '2026-11-02', f.p('P05'), 3),
      inicio(c, '2026-10-01', 10, 300, 4), entra(c, '2026-11-02', f.p('P06'), 5), sai(c, '2026-11-09', f.p('P06'), 6),
      inicio(d, '2026-10-01', 10, 300, 7),
      { id: id(), lotId: d.id, date: '2026-11-03', seq: 8, type: 'animais_saida', heads: 10, reason: 'venda' },
    ];
    const v = deriveFarm(f, TODAY);
    const name = (pid: string) => v.paddockById.get(pid)!.paddock.name;
    const text = (l: Lot) => locationText(v.lotById.get(l.id)!, name, formatBr);
    expect(text(a)).toBe('Sem movimentação: ainda não entrou em piquete');
    expect(text(b)).toBe('Em P05 desde 02/11/2026');
    expect(text(c)).toBe('Fora de piquete: saiu de P06 em 09/11/2026');
    expect(text(d)).toBe('Sem animais desde 03/11/2026');
  });

  it('histórico inconsistente vira aviso no lote', () => {
    const f = farm();
    const a = lot('A', f.farm.id);
    f.lots = [a];
    f.events = [inicio(a, '2026-10-01', 10, 300, 1), sai(a, '2026-11-01', f.p('P01'), 2)];
    expect(deriveFarm(f, TODAY).lots[0].problem).toBe('A tem saída de piquete em 01/11/2026 sem entrada antes.');
  });
});

describe('módulos', () => {
  const mod = (name: string): Module => ({
    id: id(), farmId: 'f', name, color: '#5B8DEF', occupationDays: 5, plannedLotId: null, condition: 'extensiva', mRef: 40,
  });
  const rows = (m: Module, validFrom: string, paddockIds: string[]): CompositionRow[] =>
    paddockIds.map((paddockId, ord) => ({ id: id(), moduleId: m.id, paddockId, ord, validFrom }));

  it('a composição de um dia é a versão mais recente até aquele dia, na ordem gravada', () => {
    const m = mod('A');
    const all = [...rows(m, '2026-10-01', ['p2', 'p1']), ...rows(m, '2026-11-01', ['p1', 'p3', 'p2'])];
    expect(compositionAt(all, m.id, '2026-09-30')).toEqual([]);
    expect(compositionAt(all, m.id, '2026-10-15')).toEqual(['p2', 'p1']);
    expect(compositionAt(all, m.id, '2026-11-01')).toEqual(['p1', 'p3', 'p2']);
    expect(compositionVersions(all, m.id)).toEqual(['2026-11-01', '2026-10-01']);
  });

  it('um piquete só pode estar em um módulo por vez', () => {
    const [a, b] = [mod('Módulo A'), mod('Módulo B')];
    const all = rows(a, '2026-10-01', ['p1', 'p2']);
    const name = (pid: string) => pid.toUpperCase();
    expect(checkComposition(b, ['p3', 'p2'], '2026-11-01', [a, b], all, name)).toBe('P2 já está no Módulo A. Tire de lá primeiro.');
    expect(checkComposition(b, ['p3'], '2026-11-01', [a, b], all, name)).toBeNull();
    expect(checkComposition(b, [], '2026-11-01', [a, b], all, name)).toMatch(/pelo menos um piquete/);
    expect(checkComposition(a, ['p1', 'p2'], '2026-11-01', [a, b], all, name)).toBeNull();
    expect(paddockModules([a, b], all, '2026-11-01').get('p1')).toBe(a);
  });

  it('mostra o piquete ocupado, o próximo da ordem e a lotação do módulo', () => {
    const f = farm();
    const l1 = lot('Lote 1', f.farm.id);
    const m = { ...mod('Módulo A'), farmId: f.farm.id };
    f.lots = [l1];
    f.modules = [m];
    f.compositions = rows(m, '2026-10-01', [f.p('P01'), f.p('P02'), f.p('P03')]);
    f.events = [inicio(l1, '2026-10-01', 90, 450, 1), entra(l1, '2026-11-13', f.p('P03'), 2)];
    const view = deriveFarm(f, TODAY);
    const [mv] = moduleViews(f.modules, f.compositions, view);
    expect(mv.paddocks.map((p) => p.paddock.name)).toEqual(['P01', 'P02', 'P03']);
    expect(mv.current?.paddock.name).toBe('P03');
    expect(mv.next?.paddock.name).toBe('P01');
    expect(mv.ua).toBe(90);
    expect(mv.uaHa).toBeCloseTo(90 / mv.areaHa, 10);
  });
});

describe('abertura de fazenda a partir do arquivo', () => {
  const imp = parseKml(exampleKml());

  it('monta fazenda, piquetes e bebedouros com ids novos e geometria em lat/lon', () => {
    const nf = exampleNewFarm('Minha');
    expect(nf.farm.name).toBe('Minha');
    expect(nf.paddocks).toHaveLength(13);
    expect(nf.paddocks.every((p) => p.farmId === nf.farm.id)).toBe(true);
    expect(new Set(nf.paddocks.map((p) => p.id)).size).toBe(13);
    expect(nf.paddocks.find((p) => p.name === 'Reserva legal')!.isGrazing).toBe(false);
    expect(nf.paddocks[0].geom.type).toBe('Polygon');
    const ring = nf.paddocks[0].geom.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(nf.waterPoints).toHaveLength(6);
    expect(nf.farm.centroid!.lat).toBeCloseTo(-14.86, 1);
    expect(nf.farm.centroid!.lon).toBeCloseTo(-40.83, 1);
  });

  it('recusa sem nome, sem piquete de pastejo e com nome repetido', () => {
    const drafts = draftsFromImport(imp);
    const base = { municipality: '', waterPoints: [] };
    expect(buildNewFarm({ ...base, name: ' ', drafts })).toEqual({ ok: false, error: 'Dê um nome à fazenda.' });
    expect(buildNewFarm({ ...base, name: 'X', drafts: drafts.map((d) => ({ ...d, grazing: false })) })).toEqual({
      ok: false,
      error: 'Marque pelo menos um piquete como pastejo.',
    });
    const dup = drafts.map((d, i) => (i === 1 ? { ...d, name: 'pasto 01' } : d));
    expect(buildNewFarm({ ...base, name: 'X', drafts: dup })).toEqual({
      ok: false,
      error: 'Dois piquetes com o nome "pasto 01". Dê nomes diferentes.',
    });
  });
});
