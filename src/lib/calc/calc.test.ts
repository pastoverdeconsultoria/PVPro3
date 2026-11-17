import { describe, expect, it } from 'vitest';
import type { FarmData, Lot } from '../../data/types';
import { exampleNewFarm } from '../../test/fixtures';
import { deriveFarm } from '../farm/farmView';
import type { LotEvent } from '../lots/types';
import { analyzeFarm } from './analysis';
import { cutFraction, pastureFraction, SUPPLEMENT_RULE } from './supplement';

let n = 0;
const id = () => `id-${++n}`;
let seq = 0;

function farm(): FarmData & { p: (name: string) => string; area: (name: string) => number; lot: (name: string, date: string, heads: number, kg: number) => Lot } {
  const nf = exampleNewFarm();
  const f: FarmData = { farm: nf.farm, paddocks: nf.paddocks, waterPoints: nf.waterPoints, lots: [], modules: [], compositions: [], events: [], reports: [], rain: [], fertilizations: [] };
  return Object.assign(f, {
    p: (name: string) => nf.paddocks.find((x) => x.name === name)!.id,
    area: (name: string) => nf.paddocks.find((x) => x.name === name)!.areaHa,
    /** Cria o lote já com o registro de formação. 450 kg dá 1 UA por cabeça. */
    lot: (name: string, date: string, heads: number, kg: number) => {
      const l: Lot = { id: id(), farmId: nf.farm.id, name, deletedAt: null };
      f.lots.push(l);
      f.events.push({ id: id(), lotId: l.id, date, seq: ++seq, type: 'inicio', heads, weightKg: kg, category: 'Recria' });
      return l;
    },
  });
}
const entra = (l: Lot, date: string, paddockId: string): LotEvent => ({ id: id(), lotId: l.id, date, seq: ++seq, type: 'piquete_entrada', paddockId });
const sai = (l: Lot, date: string, paddockId: string): LotEvent => ({ id: id(), lotId: l.id, date, seq: ++seq, type: 'piquete_saida', paddockId });

describe('regra do suplemento', () => {
  it('só o que passa de 0,3% do PV substitui capim, até o consumo total de 2,5%', () => {
    expect(SUPPLEMENT_RULE).toEqual({ intakePct: 2.5, thresholdPct: 0.3 });
    expect(cutFraction(0)).toBe(0);
    expect(cutFraction(0.3)).toBe(0);
    expect(cutFraction(1)).toBeCloseTo(0.28, 10);
    expect(pastureFraction(1)).toBeCloseTo(0.72, 10);
    expect(cutFraction(2.5)).toBeCloseTo(0.88, 10);
    expect(cutFraction(9)).toBeCloseTo(0.88, 10);
  });
});

describe('lotação ocorrida', () => {
  it('é a UA média ponderada pelos dias, e muda quando o lote é pesado no meio da estadia', () => {
    const f = farm();
    const l = f.lot('L', '2026-10-01', 100, 450);
    f.events.push(
      entra(l, '2026-11-01', f.p('P01')),
      { id: id(), lotId: l.id, date: '2026-11-05', seq: ++seq, type: 'pesagem', weightKg: 495 },
      sai(l, '2026-11-11', f.p('P01')),
    );
    const p = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    expect(p.segments.map((s) => [s.start, s.end, s.days, Math.round(s.ua)])).toEqual([
      ['2026-11-01', '2026-11-05', 4, 100],
      ['2026-11-05', '2026-11-11', 6, 110],
    ]);
    expect(p.lastPeriod).toMatchObject({ start: '2026-11-01', end: '2026-11-11', days: 10, open: false });
    expect(p.lastPeriod!.uaDays).toBeCloseTo(100 * 4 + 110 * 6, 8);
    expect(p.lastPeriod!.uaHa).toBeCloseTo(1060 / f.area('P01') / 10, 10);
  });

  it('fica fixa depois que o gado sai; o descanso só entra na global do ciclo', () => {
    const f = farm();
    const l = f.lot('L', '2026-10-01', 100, 450);
    f.events.push(entra(l, '2026-11-01', f.p('P01')), sai(l, '2026-11-11', f.p('P01')));
    const d15 = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    const d30 = deriveFarm(f, '2026-11-30').paddockById.get(f.p('P01'))!;
    const area = f.area('P01');

    expect(d15.lastPeriod!.uaHa).toBeCloseTo(100 / area, 10);
    expect(d30.lastPeriod!.uaHa).toBe(d15.lastPeriod!.uaHa);
    // Ciclo em 15/11: 1.000 UA-dia sobre 15 dias (1 a 15). Em 30/11: sobre 30 dias.
    expect(d15.cycleUaHa).toBeCloseTo(1000 / area / 15, 10);
    expect(d30.cycleUaHa).toBeCloseTo(1000 / area / 30, 10);
    expect(d30.cycleUaHa!).toBeLessThan(d15.cycleUaHa!);
  });

  it('com gado dentro, hoje conta, e a ocorrida até agora acompanha a instantânea se nada mudou', () => {
    const f = farm();
    const l = f.lot('L', '2026-10-01', 90, 450);
    f.events.push(entra(l, '2026-11-13', f.p('P02')));
    const p = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P02'))!;
    expect(p.current).toMatchObject({ start: '2026-11-13', days: 3, open: true });
    expect(p.dayOfUse).toBe(3);
    expect(p.current!.uaHa).toBeCloseTo(p.instantUaHa!, 10);
    expect(p.lastPeriod).toBeNull();
    expect(p.cycleUaHa).toBeNull();
  });

  it('desconta do pasto o que o suplemento substitui, a partir do dia em que ele começa', () => {
    const f = farm();
    const l = f.lot('L', '2026-10-01', 100, 450);
    f.events.push(
      entra(l, '2026-11-01', f.p('P01')),
      { id: id(), lotId: l.id, date: '2026-11-06', seq: ++seq, type: 'suplemento', pctPv: 1 },
      sai(l, '2026-11-11', f.p('P01')),
    );
    const v = deriveFarm(f, '2026-11-15');
    const p = v.paddockById.get(f.p('P01'))!;
    expect(p.lastPeriod!.uaDays).toBeCloseTo(1000, 8);
    expect(p.lastPeriod!.uapDays).toBeCloseTo(100 * 5 + 72 * 5, 8);
    expect(p.lastPeriod!.uapHa).toBeLessThan(p.lastPeriod!.uaHa);
    expect(v.lots[0].uap).toBeCloseTo(72, 10);
    expect(v.lots[0].ua).toBe(100);
  });
});

describe('período de pastejo é do piquete', () => {
  it('um lote sai e outro entra no mesmo dia: é um período só', () => {
    const f = farm();
    const a = f.lot('A', '2026-10-01', 100, 450);
    const b = f.lot('B', '2026-10-01', 50, 450);
    f.events.push(entra(a, '2026-11-01', f.p('P01')), sai(a, '2026-11-06', f.p('P01')), entra(b, '2026-11-06', f.p('P01')), sai(b, '2026-11-10', f.p('P01')));
    const p = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    expect(p.periods).toHaveLength(1);
    expect(p.lastPeriod).toMatchObject({ start: '2026-11-01', end: '2026-11-10', days: 9, lotIds: [a.id, b.id] });
    expect(p.lastPeriod!.uaDays).toBeCloseTo(100 * 5 + 50 * 4, 8);
    expect(p.lastPeriod!.uaHa).toBeCloseTo(700 / f.area('P01') / 9, 10);
    expect(p.restDays).toBe(5);
  });

  it('dois lotes juntos somam as UA, e os dias contam uma vez só', () => {
    const f = farm();
    const a = f.lot('A', '2026-10-01', 100, 450);
    const b = f.lot('B', '2026-10-01', 50, 450);
    f.events.push(entra(a, '2026-11-01', f.p('P01')), entra(b, '2026-11-04', f.p('P01')), sai(b, '2026-11-08', f.p('P01')), sai(a, '2026-11-11', f.p('P01')));
    // Situação em 6/11, quando as saídas ainda não tinham acontecido.
    const v = deriveFarm({ ...f, events: f.events.filter((e) => e.date <= '2026-11-06') }, '2026-11-06');
    const during = v.paddockById.get(f.p('P01'))!;
    expect(during.occupants).toHaveLength(2);
    expect(during.instantUaHa).toBeCloseTo(150 / f.area('P01'), 10);
    // O dia de uso é do piquete: começou em 1/11, mesmo para o lote que entrou depois.
    expect(during.dayOfUse).toBe(6);

    const after = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    expect(after.periods).toHaveLength(1);
    expect(after.lastPeriod!.days).toBe(10);
    expect(after.lastPeriod!.uaDays).toBeCloseTo(100 * 10 + 50 * 4, 8);
    expect(after.lastPeriod!.uaHa).toBeCloseTo(1200 / f.area('P01') / 10, 10);
  });

  it('um dia inteiro vazio encerra o período e começa outro', () => {
    const f = farm();
    const a = f.lot('A', '2026-10-01', 100, 450);
    const b = f.lot('B', '2026-10-01', 50, 450);
    f.events.push(entra(a, '2026-11-01', f.p('P01')), sai(a, '2026-11-05', f.p('P01')), entra(b, '2026-11-06', f.p('P01')), sai(b, '2026-11-10', f.p('P01')));
    const p = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    expect(p.periods.map((x) => [x.start, x.end, x.days])).toEqual([
      ['2026-11-01', '2026-11-05', 4],
      ['2026-11-06', '2026-11-10', 4],
    ]);
    expect(p.lastPeriod!.lotIds).toEqual([b.id]);
    expect(p.lastPeriod!.uaHa).toBeCloseTo(50 / f.area('P01'), 10);
  });

  it('apagar a saída reabre o período: tudo é recalculado do histórico', () => {
    const f = farm();
    const a = f.lot('A', '2026-10-01', 100, 450);
    const saida = sai(a, '2026-11-05', f.p('P01'));
    f.events.push(entra(a, '2026-11-01', f.p('P01')), saida);
    expect(deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!.lastPeriod!.days).toBe(4);
    f.events = f.events.map((e) => (e.id === saida.id ? { ...e, deletedAt: '2026-11-15T10:00:00Z' } : e));
    const p = deriveFarm(f, '2026-11-15').paddockById.get(f.p('P01'))!;
    expect(p.lastPeriod).toBeNull();
    expect(p.current).toMatchObject({ start: '2026-11-01', days: 15, open: true });
  });
});

describe('lotação no período (Análise)', () => {
  it('sem movimentação não há análise, e nenhum número é inventado', () => {
    const f = farm();
    f.lot('A', '2026-10-01', 100, 450);
    const a = analyzeFarm(deriveFarm(f, '2026-11-15'));
    expect(a.empty).toBe(true);
    expect(a.uaHa).toBeNull();
    expect(a.months).toHaveLength(12);
    expect(a.months.every((m) => m.uaHa === null)).toBe(true);
  });

  it('com menos de um ano de registro, o período começa na primeira entrada de gado', () => {
    const f = farm();
    const l = f.lot('A', '2026-10-01', 100, 450);
    f.events.push(entra(l, '2026-11-01', f.p('P01')), sai(l, '2026-11-11', f.p('P01')), entra(l, '2026-11-11', f.p('P02')));
    const v = deriveFarm(f, '2026-11-15');
    const a = analyzeFarm(v);
    expect(a).toMatchObject({ empty: false, from: '2026-11-01', to: '2026-11-15', days: 15, partial: true });
    // 100 UA nos 15 dias, sempre em piquete de pastejo.
    expect(a.uaDays).toBeCloseTo(1500, 8);
    expect(a.uaHa).toBeCloseTo(100 / v.totals.grazingAreaHa, 10);

    const p01 = a.paddocks.find((p) => p.paddockId === f.p('P01'))!;
    expect(p01).toMatchObject({ grazedDays: 10, periods: 1 });
    expect(p01.uaHa).toBeCloseTo(1000 / f.area('P01') / 15, 10);
    expect(p01.occurredUaHa).toBeCloseTo(100 / f.area('P01'), 10);
    const p03 = a.paddocks.find((p) => p.paddockId === f.p('P03'))!;
    expect(p03).toMatchObject({ grazedDays: 0, periods: 0, uaHa: 0, occurredUaHa: null });

    const nov = a.months[11];
    expect(nov).toMatchObject({ month: '2026-11', days: 15 });
    expect(nov.uaHa).toBeCloseTo(a.uaHa!, 10);
    expect(a.months.slice(0, 11).every((m) => m.uaHa === null && m.days === 0)).toBe(true);
  });

  it('com mais de um ano de registro, usa os últimos 365 dias', () => {
    const f = farm();
    const l = f.lot('A', '2024-01-01', 100, 450);
    f.events.push(entra(l, '2025-01-01', f.p('P01')));
    const v = deriveFarm(f, '2026-11-15');
    const a = analyzeFarm(v);
    expect(a).toMatchObject({ from: '2025-11-16', to: '2026-11-15', days: 365, partial: false });
    expect(a.uaHa).toBeCloseTo(100 / v.totals.grazingAreaHa, 10);
    expect(a.months.map((m) => m.month)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(a.months[0]).toMatchObject({ days: 31 });
    expect(a.months[2]).toMatchObject({ month: '2026-02', days: 28 });
    expect(a.months[11]).toMatchObject({ days: 15 });
    expect(a.months.every((m) => Math.abs(m.uaHa! - a.uaHa!) < 1e-9)).toBe(true);
  });

  it('reparte a estadia entre os meses e não conta piquete fora do pastejo', () => {
    const f = farm();
    const l = f.lot('A', '2026-10-01', 100, 450);
    f.events.push(
      entra(l, '2026-10-25', f.p('P01')),
      sai(l, '2026-11-05', f.p('P01')),
      entra(l, '2026-11-05', f.p('Reserva legal')),
    );
    const v = deriveFarm(f, '2026-11-15');
    const a = analyzeFarm(v);
    const area = v.totals.grazingAreaHa;
    expect(a.days).toBe(22);
    // Só os 11 dias em P01 contam; os 11 na reserva não são pastejo.
    expect(a.uaDays).toBeCloseTo(1100, 8);
    expect(a.months[10]).toMatchObject({ month: '2026-10', days: 7 });
    expect(a.months[10].uaHa).toBeCloseTo((100 * 7) / area / 7, 10);
    expect(a.months[11].uaHa).toBeCloseTo((100 * 4) / area / 15, 10);
    expect(a.paddocks.some((p) => p.paddockId === f.p('Reserva legal'))).toBe(false);
  });

  it('conta os períodos de cada piquete e a ocorrida média só nos dias com gado', () => {
    const f = farm();
    const l = f.lot('A', '2026-09-01', 100, 450);
    f.events.push(
      entra(l, '2026-10-01', f.p('P01')), sai(l, '2026-10-06', f.p('P01')),
      entra(l, '2026-10-06', f.p('P02')), sai(l, '2026-10-21', f.p('P02')),
      entra(l, '2026-10-21', f.p('P01')), sai(l, '2026-10-31', f.p('P01')),
    );
    const a = analyzeFarm(deriveFarm(f, '2026-11-15'));
    const p01 = a.paddocks.find((p) => p.paddockId === f.p('P01'))!;
    expect(p01).toMatchObject({ periods: 2, grazedDays: 15 });
    expect(p01.occurredUaHa).toBeCloseTo(100 / f.area('P01'), 10);
    expect(p01.uaHa).toBeCloseTo((100 * 15) / f.area('P01') / a.days, 10);
  });
});
