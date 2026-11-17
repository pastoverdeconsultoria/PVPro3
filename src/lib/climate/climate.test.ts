import { describe, expect, it } from 'vitest';
import type { FarmData, Lot } from '../../data/types';
import { BASE_RAIN, syntheticClimate } from '../../test/climateFixture';
import { exampleNewFarm } from '../../test/fixtures';
import { calibrateM, capacityOf, nitrogenPlan, pprOf, projectFarm, projectScope, smoothGrowth, tbOf } from '../calc/projection';
import { deriveFarm } from '../farm/farmView';
import { moduleViews } from '../farm/modules';
import { addDays } from '../lots/dates';
import type { LotEvent } from '../lots/types';
import { dayAt, mergeDaily, roundCoord, type ClimateSeries } from './openMeteo';
import { buildScenarios, etoHargreaves, fhOf, kcOf, monthOffset, monthSeries, weatherOn, type MonthClimate } from './water';

const TODAY = '2026-11-15';

describe('evapotranspiração e Kc', () => {
  it('Hargreaves-Samani dá valores plausíveis e segue a estação', () => {
    const verao = etoHargreaves(-15, '2026-12-15', 20, 32);
    const inverno = etoHargreaves(-15, '2026-06-15', 15, 27);
    expect(verao).toBeGreaterThan(5);
    expect(verao).toBeLessThan(7);
    expect(inverno).toBeGreaterThan(2.5);
    expect(inverno).toBeLessThan(4.2);
    // Mesma temperatura: no hemisfério sul, dezembro tem mais radiação que junho.
    expect(etoHargreaves(-15, '2026-12-15', 18, 30)).toBeGreaterThan(etoHargreaves(-15, '2026-06-15', 18, 30));
    expect(etoHargreaves(15, '2026-06-15', 18, 30)).toBeGreaterThan(etoHargreaves(15, '2026-12-15', 18, 30));
    // Sem amplitude térmica não há evapotranspiração calculada.
    expect(etoHargreaves(-15, '2026-12-15', 25, 25)).toBe(0);
  });

  it('Kc: 0,6 de junho a agosto, 1,2 de dezembro a fevereiro, 0,9 no resto; no norte desloca seis meses', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => kcOf(m, -15))).toEqual([1.2, 1.2, 0.9, 0.9, 0.9, 0.6, 0.6, 0.6, 0.9, 0.9, 0.9, 1.2]);
    expect(kcOf(0, 15)).toBe(0.6);
    expect(kcOf(6, 15)).toBe(1.2);
  });
});

describe('série do Open-Meteo', () => {
  it('arredonda a coordenada e junta arquivo e previsão; dado ausente não apaga o que já havia', () => {
    expect(roundCoord(-12.556123)).toBe(-12.56);
    const arquivo = { time: ['2026-11-10', '2026-11-11', '2026-11-12'], temperature_2m_max: [30, 31, null], temperature_2m_min: [20, 21, null], precipitation_sum: [0, 5, null] };
    const recente = { time: ['2026-11-11', '2026-11-12', '2026-11-13'], temperature_2m_max: [31.5, 29, 28], temperature_2m_min: [21.5, 19, 18], precipitation_sum: [6, null, 12] };
    const s = mergeDaily(-14.86, -40.84, '2026-11-12', [arquivo, recente], 'agora');
    expect(s.start).toBe('2026-11-10');
    expect(s.forecastFrom).toBe('2026-11-13');
    expect(dayAt(s, '2026-11-10')).toEqual({ tmax: 30, tmin: 20, rain: 0 });
    expect(dayAt(s, '2026-11-11')).toEqual({ tmax: 31.5, tmin: 21.5, rain: 6 });
    expect(dayAt(s, '2026-11-12')).toEqual({ tmax: 29, tmin: 19, rain: 0 });
    expect(dayAt(s, '2026-11-13')).toEqual({ tmax: 28, tmin: 18, rain: 12 });
    expect(dayAt(s, '2026-11-09')).toBeNull();
    expect(dayAt(s, '2026-11-14')).toBeNull();
  });
});

describe('cenários de chuva do histórico', () => {
  const series = syntheticClimate(TODAY);
  const sc = buildScenarios(series, TODAY);

  it('para cada mês escolhe o ano seco, o mediano e o chuvoso', () => {
    // Janeiro: anos completos de 2017 a 2026. O fator de chuva do ano N é 0,6 + 0,1 × (N mod 9).
    expect(sc.years[0]).toBe(10);
    const factor = (y: number) => 0.6 + 0.1 * (y % 9);
    const [dry, normal, wet] = [sc.analog[0][0]!, sc.analog[1][0]!, sc.analog[2][0]!];
    expect(factor(dry)).toBeLessThan(factor(normal));
    expect(factor(normal)).toBeLessThan(factor(wet));
    // Novembro corrente ainda não fechou e não entra: são os nove novembros anteriores.
    expect(sc.years[10]).toBe(9);
    expect(sc.analog[1][10]).not.toBe(2026);
    // A "normal" de julho fica perto da chuva-base do mês.
    expect(sc.normalRain[6]!).toBeGreaterThan(BASE_RAIN[6] * 0.6);
    expect(sc.normalRain[6]!).toBeLessThan(BASE_RAIN[6] * 1.4);
  });

  it('o futuro repete os dias do ano escolhido; passado e previsão não dependem do cenário', () => {
    const passado = '2026-10-10';
    expect(weatherOn(series, sc, passado, 0)).toEqual(weatherOn(series, sc, passado, 2));
    const futuro = '2027-01-10';
    const seco = weatherOn(series, sc, futuro, 0)!;
    const chuvoso = weatherOn(series, sc, futuro, 2)!;
    expect(seco).toEqual(dayAt(series, `${sc.analog[0][0]}-01-10`));
    expect(chuvoso.rain).toBeGreaterThan(seco.rain);
    // 29 de fevereiro sem correspondente no ano análogo cai no dia 28.
    expect(weatherOn(series, sc, '2028-02-29', 1)).not.toBeNull();
  });

  it('com menos de três anos de histórico não inventa cenário', () => {
    const curta: ClimateSeries = { ...series, start: '2025-06-01', tmax: series.tmax.slice(-540), tmin: series.tmin.slice(-540), rain: series.rain.slice(-540) };
    const s = buildScenarios(curta, TODAY);
    expect(s.analog[1].every((y) => y === null)).toBe(true);
    expect(weatherOn(curta, s, '2027-03-10', 1)).toBeNull();
  });
});

describe('balanço hídrico por mês', () => {
  const series = syntheticClimate(TODAY);
  const sc = buildScenarios(series, TODAY);
  const normal = monthSeries(series, sc, new Map(), TODAY, 1);

  it('cobre de 24 meses atrás a 12 à frente, com os dias certos de cada mês', () => {
    expect([...normal.keys()]).toEqual(Array.from({ length: 37 }, (_, i) => i - 24));
    expect(monthOffset(TODAY, 0)).toEqual({ a: '2026-11-01', b: '2026-12-01', month: 10, year: 2026 });
    expect(monthOffset(TODAY, 2)).toEqual({ a: '2027-01-01', b: '2027-02-01', month: 0, year: 2027 });
    expect(monthOffset(TODAY, -11)).toMatchObject({ a: '2025-12-01', month: 11, year: 2025 });
    expect(normal.get(-9)).toMatchObject({ month: 1, year: 2026, days: 28, incomplete: false });
    expect(normal.get(3)!.days).toBe(28);
  });

  it('na estação chuvosa a água não limita; no auge da seca o fator hídrico cai', () => {
    const jan = normal.get(2)!;
    const ago = normal.get(-3)!;
    expect(jan.month).toBe(0);
    expect(jan.FH).toBe(1);
    expect(jan.ratio).toBeGreaterThan(0.5);
    expect(ago.month).toBe(7);
    expect(ago.ratio).toBeLessThan(0.5);
    expect(ago.FH).toBeCloseTo(2 * ago.ratio, 10);
    expect(ago.FH).toBeLessThan(1);
    expect(fhOf(0.5)).toBe(1);
    expect(fhOf(0.2)).toBeCloseTo(0.4, 10);
    expect(jan.T).toBeCloseTo(25.5, 6);
  });

  it('cenário seco chove menos que o chuvoso no futuro, e é igual no passado', () => {
    const seco = monthSeries(series, sc, new Map(), TODAY, 0);
    const chuvoso = monthSeries(series, sc, new Map(), TODAY, 2);
    expect(seco.get(-5)!.rain).toBe(chuvoso.get(-5)!.rain);
    expect(seco.get(3)!.rain).toBeLessThan(chuvoso.get(3)!.rain);
  });

  it('a chuva real registrada entra no lugar da estimada, dia a dia, só no passado', () => {
    const dia = '2026-08-10';
    const estimada = dayAt(series, dia)!.rain;
    const real = new Map([[dia, 80], [addDays(TODAY, 5), 500]]);
    const com = monthSeries(series, sc, real, TODAY, 1);
    expect(com.get(-3)!.rain).toBeCloseTo(normal.get(-3)!.rain - estimada + 80, 6);
    expect(com.get(-3)!.FH).toBeGreaterThan(normal.get(-3)!.FH);
    // Chuva "registrada" em data futura não é chuva real e é ignorada.
    expect(com.get(0)!.rain).toBeCloseTo(normal.get(0)!.rain, 6);
  });
});

describe('projeção de capacidade de suporte', () => {
  it('temperatura base por capim, PPR limitado em 1 e conversão para UA/ha', () => {
    expect(tbOf('Decumbens')).toBe(15.5);
    expect(tbOf('Humidícola')).toBe(15.5);
    expect(tbOf('Marandu')).toBe(16.5);
    expect(tbOf(null)).toBe(16.5);
    expect(pprOf(30, 16.5)).toBe(1);
    expect(pprOf(35, 16.5)).toBe(1);
    expect(pprOf(23.25, 16.5)).toBeCloseTo(0.5, 10);
    expect(pprOf(10, 16.5)).toBe(0);
    // M 40 sem limitação: 40 × 50% ÷ 11,25 = 1,78 UA/ha. Adubada (M 105): 4,67.
    expect(capacityOf(40)).toBeCloseTo(1.7778, 4);
    expect(capacityOf(105)).toBeCloseTo(4.6667, 4);
  });

  it('a memória do crescimento amortece a virada de estação', () => {
    const raw = new Map(Array.from({ length: 37 }, (_, i) => [i - 24, i - 24 < 0 ? 0 : 1] as [number, number]));
    const g = smoothGrowth(raw, 0.4);
    expect(g.get(-1)).toBe(0);
    expect(g.get(0)).toBeCloseTo(0.4, 10);
    expect(g.get(1)).toBeCloseTo(0.64, 10);
    expect(smoothGrowth(raw, 1).get(0)).toBe(1);
  });

  it('M calibrado recupera o M que gerou a lotação observada, e só com seis meses', () => {
    const raw = new Map(Array.from({ length: 37 }, (_, i) => [i - 24, 0.3 + 0.05 * ((i * 7) % 11)] as [number, number]));
    const zero = new Map<number, number>();
    const g = smoothGrowth(raw, 0.5);
    const months = [-7, -6, -5, -4, -3, -2, -1];
    const observed = new Map(months.map((k) => [k, capacityOf(72 * g.get(k)!)] as [number, number]));
    const best = calibrateM(raw, zero, observed, months)!;
    expect(best.m).toBeCloseTo(72, 6);
    expect(best.w).toBe(0.5);
    expect(calibrateM(raw, zero, observed, months.slice(0, 5))).toBeNull();
  });

  // Fazenda de exemplo com clima fabricado à mão, para as contas saírem exatas.
  function setup(over: Partial<MonthClimate> = {}) {
    const nf = exampleNewFarm();
    const data: FarmData = { farm: nf.farm, paddocks: nf.paddocks, waterPoints: [], lots: [], modules: [], compositions: [], events: [], reports: [], rain: [], fertilizations: [] };
    const month = (k: number): MonthClimate => ({ k, ...monthOffset(TODAY, k), days: 30, rain: 100, T: 30, ratio: 1, FH: 1, incomplete: false, ...over });
    const climate = [0, 1, 2].map(() => new Map(Array.from({ length: 37 }, (_, i) => [i - 24, month(i - 24)] as [number, MonthClimate])));
    const p = (name: string) => nf.paddocks.find((x) => x.name === name)!;
    return { data, climate, p };
  }
  const project = (data: FarmData, climate: Map<number, MonthClimate>[], useCalibrated = true) => {
    const view = deriveFarm(data, TODAY);
    return projectFarm({ view, modules: moduleViews(data.modules, data.compositions, view), fertilizations: data.fertilizations, climate, useCalibrated });
  };

  it('sem limitação de clima a capacidade é M × 50% ÷ 11,25, por módulo e ponderada na fazenda', () => {
    const { data, climate, p } = setup();
    data.modules = [{ id: 'm1', farmId: data.farm.id, name: 'Módulo A', color: '#fff', occupationDays: 5, plannedLotId: null, condition: 'adubada', mRef: 105 }];
    data.compositions = [{ id: 'c1', moduleId: 'm1', paddockId: p('P01').id, ord: 0, validFrom: '2026-01-01' }];
    const model = project(data, climate);
    expect(model.units.map((u) => u.name)).toEqual(['Módulo A', 'Avulsos']);
    const [a, loose] = model.units;
    expect(a.capacity[1].get(0)).toBeCloseTo(capacityOf(105), 8);
    expect(loose.capacity[1].get(6)).toBeCloseTo(capacityOf(40), 8);
    expect(a.calibrationUsed).toBe(false);
    expect(a.m).toBe(105);

    const farm = projectScope(model, 'farm')!;
    const expected = (capacityOf(105) * a.areaHa + capacityOf(40) * loose.areaHa) / (a.areaHa + loose.areaHa);
    expect(farm.capacity[1].get(0)).toBeCloseTo(expected, 8);
    expect(projectScope(model, 'm1')!.name).toBe('Módulo A');
    expect(projectScope(model, 'nao-existe')).toBeNull();
  });

  it('frio e seca reduzem a capacidade pelo PPR e pelo fator hídrico', () => {
    const { data, climate } = setup({ T: 23.25, ratio: 0.25, FH: 0.5 });
    const u = project(data, climate).units[0];
    // PPR 0,5 × FH 0,5 = 0,25 do potencial.
    expect(u.capacity[1].get(0)).toBeCloseTo(capacityOf(40 * 0.25), 8);
    expect(u.ppr.get(0)).toBeCloseTo(0.5, 10);
  });

  it('a adubação responde nos 60 dias seguintes, na proporção da área adubada', () => {
    const { data, climate, p } = setup();
    // 60 kg N/ha em todos os piquetes de pastejo, no primeiro dia de dezembro (k = 1).
    data.fertilizations = data.paddocks.filter((x) => x.isGrazing).map((x, i) => ({ id: `f${i}`, paddockId: x.id, date: '2026-12-01', nKgHa: 60, note: null }));
    const u = project(data, climate).units[0];
    // Dezembro tem 31 dias de calendário, todos dentro dos 60: 60 × 26 × (31/60) ÷ 30 dias do mês fabricado.
    const extra = (60 * 26 * (31 / 60)) / 30;
    expect(u.production[1].get(1)).toBeCloseTo(40 + extra, 6);
    expect(u.production[1].get(0)).toBeCloseTo(40, 8);
    expect(u.production[1].get(4)).toBeCloseTo(40, 8);

    // Só um piquete adubado: o efeito na unidade é proporcional à área dele.
    data.fertilizations = [{ id: 'f', paddockId: p('P01').id, date: '2026-12-01', nKgHa: 60, note: null }];
    const one = project(data, climate).units[0];
    expect(one.production[1].get(1)).toBeCloseTo(40 + (extra * p('P01').areaHa) / one.areaHa, 6);
  });

  it('a lotação de pasto ocorrida entra como observado, mês a mês', () => {
    const { data, climate, p } = setup();
    const lot: Lot = { id: 'l1', farmId: data.farm.id, name: 'L', deletedAt: null };
    data.lots = [lot];
    const events: LotEvent[] = [
      { id: 'e1', lotId: 'l1', date: '2026-01-01', seq: 1, type: 'inicio', heads: 100, weightKg: 450, category: 'Vacas' },
      { id: 'e2', lotId: 'l1', date: '2026-10-01', seq: 2, type: 'piquete_entrada', paddockId: p('P01').id },
    ];
    data.events = events;
    const u = project(data, climate).units[0];
    expect(u.observed.get(-1)).toBeCloseTo(100 / u.areaHa, 8);
    expect(u.observed.get(0)).toBeCloseTo(100 / u.areaHa, 8);
    expect(u.observed.get(-2)).toBe(0);
    expect(u.current).toBeCloseTo(100 / u.areaHa, 8);
    // Dois meses observados não bastam para calibrar: fica o M de referência.
    expect(u.mCalibrated).toBeNull();
    expect(u.observedMonths).toBe(2);
  });

  it('conta inversa de N: dose proporcional ao déficit; sem água não há dose; meta impossível é avisada', () => {
    const { data, climate } = setup();
    const model = project(data, climate);
    const cap = capacityOf(40);
    expect(nitrogenPlan(model, 'farm', cap - 0.1).every((r) => r.kgN === 0 && !r.blocked)).toBe(true);

    // Meta 1 UA/ha acima: faltam 22,5 kg MS/ha/dia; em 30 dias, 22,5 × 30 ÷ 26 = 25,96 kg N/ha.
    const [row] = nitrogenPlan(model, 'farm', cap + 1);
    expect(row.kgNHa).toBeCloseTo((22.5 * 30) / 26, 6);
    expect(row.kgN).toBeCloseTo(row.kgNHa * model.units[0].areaHa, 4);
    expect(row.ceiling).toBe(false);
    expect(row.capacity).toBeCloseTo(cap, 8);
    // Meta além do teto físico (M 250).
    expect(nitrogenPlan(model, 'farm', capacityOf(260))[0].ceiling).toBe(true);

    const seca = setup({ ratio: 0.2, FH: 0.4 });
    const dry = project(seca.data, seca.climate);
    const [blocked] = nitrogenPlan(dry, 'farm', 2);
    expect(blocked).toMatchObject({ blocked: true, kgN: 0 });
    expect(blocked.deficitUa).toBeCloseTo((2 - capacityOf(40 * 0.4)) * dry.units[0].areaHa, 6);
  });
});
