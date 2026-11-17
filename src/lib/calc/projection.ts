import type { Fertilization } from '../../data/types';
import { monthOffset, type MonthClimate } from '../climate/water';
import type { FarmView, PaddockView } from '../farm/farmView';
import type { ModuleView } from '../farm/modules';
import { addDays, diffDays, type IsoDate } from '../lots/dates';
import { clipToWindow } from './occupancy';

// Projeção de capacidade de suporte. Portada do simulador (`projUnits`,
// `projModel`, `projScope`, `nPlan`). Modelo pedido pelo Lucas (Tonato, Barioni e
// Pedreira, Embrapa; N de Martha Jr.):
//
//   P   = M × PPR × FH + N × RN              (kg MS/ha/dia)
//   PPR = (T − Tb) / (Tótima − Tb), no máximo 1
//   FH  = 1 se ETR/ETM ≥ 0,5; senão 2 × ETR/ETM
//   capacidade (UA/ha) = P × eficiência ÷ 11,25
//
// NÃO VALIDADO com fazenda real: M, eficiência de 50%, CAD de 75 mm e consumo de
// 2,5% do PV para todas as categorias são hipóteses. A tela precisa dizer isso.

export const PROJECTION = {
  /** Temperatura ótima, °C. */
  tOpt: 30,
  /** Eficiência de pastejo. */
  efficiency: 0.5,
  /** Resposta ao nitrogênio, kg MS por kg de N. */
  rn: 26,
  /** kg de MS que uma UA consome por dia: 450 kg × 2,5%. */
  uaIntakeKg: 11.25,
  /** Dias em que a resposta a uma adubação se distribui. */
  nDays: 60,
  /** Teto físico de M, kg MS/ha/dia. Meta acima disso não é alcançável nem com adubo. */
  mCeiling: 250,
  /** Peso do mês corrente na memória do crescimento quando M não é calibrado. */
  defaultMemory: 0.4,
} as const;

/** Temperatura base do capim: 15,5 °C para decumbens e humidícola, 16,5 °C para os demais. */
export const tbOf = (species: string | null | undefined) => (/decumbens|humid/i.test(species ?? '') ? 15.5 : 16.5);

export const pprOf = (t: number, tb: number) => (t >= PROJECTION.tOpt ? 1 : Math.max(0, (t - tb) / (PROJECTION.tOpt - tb)));

/** kg MS/ha/dia para UA/ha. */
export const capacityOf = (p: number) => (p * PROJECTION.efficiency) / PROJECTION.uaIntakeKg;

type ByMonth = Map<number, number>;

export interface ProjUnit {
  /** Id do módulo, ou '_avulsos' para os piquetes de pastejo sem módulo. */
  id: string;
  name: string;
  color: string;
  paddocks: PaddockView[];
  areaHa: number;
  /** Temperatura base ponderada pela área dos capins. */
  tb: number;
  mRef: number;
  /** Lotação de pasto hoje, UA/ha. */
  current: number;
  /** Lotação de pasto ocorrida em cada mês passado (k de −11 a 0). */
  observed: ByMonth;
  /** M ajustado ao histórico, ou null sem seis meses de observação. */
  mCalibrated: number | null;
  calibrationUsed: boolean;
  /** Erro médio do modelo nos meses observados (fração), ou null. */
  error: number | null;
  observedMonths: number;
  /** M em uso. */
  m: number;
  /** Crescimento relativo (PPR × FH, com memória), produção e capacidade, por cenário e mês. */
  growth: ByMonth[];
  nitrogen: ByMonth[];
  production: ByMonth[];
  capacity: ByMonth[];
  ppr: ByMonth;
}

export interface ProjModel {
  today: IsoDate;
  units: ProjUnit[];
  /** Balanço hídrico por cenário (seco, normal, chuvoso). */
  climate: Map<number, MonthClimate>[];
  /** Faltou clima em algum mês usado. */
  incomplete: boolean;
}

const MEMORY_WEIGHTS = [1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.25, 0.2];

/** Média com memória: cada mês pesa `w` e o acumulado anterior pesa o resto. */
export function smoothGrowth(raw: ByMonth, w: number): ByMonth {
  const out: ByMonth = new Map();
  let g = raw.get(-24) ?? 0;
  for (let k = -24; k <= 12; k++) {
    g = w * (raw.get(k) ?? 0) + (1 - w) * g;
    out.set(k, g);
  }
  return out;
}

/**
 * M calibrado: o M que melhor explica a lotação de pasto ocorrida, por mínimos
 * quadrados, testando alguns pesos de memória e ficando com o de menor erro.
 * Só com seis meses ou mais de observação.
 *
 * Ressalva (revisão do simulador, 15 nov 2026): isto ajusta M ao que foi
 * PRATICADO, então mede o manejo, não a capacidade do pasto. Fazenda sublotada
 * sai com M baixo. Por isso a tela deixa alternar para o M de referência.
 */
export function calibrateM(rawGrowth: ByMonth, nitrogen: ByMonth, observed: ByMonth, months: number[]): { m: number; w: number; sse: number } | null {
  if (months.length < 6) return null;
  let best: { m: number; w: number; sse: number } | null = null;
  for (const w of MEMORY_WEIGHTS) {
    const g = smoothGrowth(rawGrowth, w);
    let sxy = 0;
    let sxx = 0;
    for (const k of months) {
      const x = capacityOf(g.get(k) ?? 0);
      const y = (observed.get(k) ?? 0) - capacityOf(nitrogen.get(k) ?? 0);
      sxy += x * y;
      sxx += x * x;
    }
    if (!sxx) continue;
    const m = sxy / sxx;
    if (!(m > 0)) continue;
    let sse = 0;
    for (const k of months) {
      const e = capacityOf(m * (g.get(k) ?? 0) + (nitrogen.get(k) ?? 0)) - (observed.get(k) ?? 0);
      sse += e * e;
    }
    if (!best || sse < best.sse - 1e-12) best = { m, w, sse };
  }
  return best;
}

export function projectFarm(input: {
  view: FarmView;
  modules: readonly ModuleView[];
  fertilizations: readonly Fertilization[];
  /** Balanço hídrico por cenário: [seco, normal, chuvoso]. */
  climate: Map<number, MonthClimate>[];
  useCalibrated: boolean;
}): ProjModel {
  const { view, climate } = input;
  const today = view.today;
  const endOfToday = addDays(today, 1);
  let incomplete = false;

  const base: Pick<ProjUnit, 'id' | 'name' | 'color' | 'paddocks' | 'mRef'>[] = input.modules.map((m) => ({
    id: m.module.id,
    name: m.module.name,
    color: m.module.color,
    paddocks: m.paddocks.filter((p) => p.paddock.isGrazing),
    mRef: m.module.mRef,
  }));
  const inModule = new Set(base.flatMap((u) => u.paddocks.map((p) => p.paddock.id)));
  const loose = view.paddocks.filter((p) => p.paddock.isGrazing && !inModule.has(p.paddock.id));
  if (loose.length) base.push({ id: '_avulsos', name: 'Avulsos', color: '#3A433E', paddocks: loose, mRef: 40 });

  const units: ProjUnit[] = base
    .map((u) => ({ ...u, areaHa: u.paddocks.reduce((s, p) => s + p.paddock.areaHa, 0) }))
    .filter((u) => u.areaHa > 0)
    .map((u) => {
      const tb = u.paddocks.reduce((s, p) => s + tbOf(p.paddock.species) * p.paddock.areaHa, 0) / u.areaHa;
      const current = u.paddocks.reduce((s, p) => s + p.uap, 0) / u.areaHa;

      const observed: ByMonth = new Map();
      const usable: number[] = [];
      for (let k = -11; k <= 0; k++) {
        const r = monthOffset(today, k);
        const b = r.b < endOfToday ? r.b : endOfToday;
        const days = diffDays(r.a, b);
        if (days < 1) continue;
        const uapDays = u.paddocks.reduce((s, p) => s + clipToWindow(p.segments, r.a, b).uapDays, 0);
        const v = uapDays / u.areaHa / days;
        observed.set(k, v);
        if (v > 0 && days >= 10) usable.push(k);
      }

      const raw: ByMonth[] = [];
      const nitrogen: ByMonth[] = [];
      for (let s = 0; s < 3; s++) {
        raw[s] = new Map();
        nitrogen[s] = new Map();
        for (let k = -24; k <= 12; k++) {
          const c = climate[s].get(k);
          if (!c || Number.isNaN(c.T)) {
            incomplete = true;
            raw[s].set(k, 0);
            nitrogen[s].set(k, 0);
            continue;
          }
          if (c.incomplete && k >= -11) incomplete = true;
          raw[s].set(k, pprOf(c.T, tb) * c.FH);
          // Cada adubação responde nos 60 dias seguintes, reduzida pelo fator hídrico do mês.
          let n = 0;
          for (const f of input.fertilizations) {
            const p = u.paddocks.find((x) => x.paddock.id === f.paddockId);
            if (!p) continue;
            const until = addDays(f.date, PROJECTION.nDays);
            const from = c.a > f.date ? c.a : f.date;
            const to = c.b < until ? c.b : until;
            const overlap = Math.max(0, diffDays(from, to));
            if (overlap > 0) n += (f.nKgHa * PROJECTION.rn * c.FH * (overlap / PROJECTION.nDays) * p.paddock.areaHa) / u.areaHa / c.days;
          }
          nitrogen[s].set(k, n);
        }
      }

      const best = calibrateM(raw[1], nitrogen[1], observed, usable);
      const calibrationUsed = !!best && input.useCalibrated;
      const m = calibrationUsed ? best!.m : u.mRef;
      const w = calibrationUsed ? best!.w : PROJECTION.defaultMemory;

      const growth: ByMonth[] = [];
      const production: ByMonth[] = [];
      const capacity: ByMonth[] = [];
      for (let s = 0; s < 3; s++) {
        const g = smoothGrowth(raw[s], w);
        growth[s] = new Map();
        production[s] = new Map();
        capacity[s] = new Map();
        for (let k = -11; k <= 12; k++) {
          const p = m * (g.get(k) ?? 0) + (nitrogen[s].get(k) ?? 0);
          growth[s].set(k, g.get(k) ?? 0);
          production[s].set(k, p);
          capacity[s].set(k, capacityOf(p));
        }
      }
      const ppr: ByMonth = new Map();
      for (let k = -11; k <= 12; k++) {
        const c = climate[1].get(k);
        ppr.set(k, c && !Number.isNaN(c.T) ? pprOf(c.T, tb) : 0);
      }

      let err = 0;
      for (const k of usable) err += Math.abs((capacity[1].get(k) ?? 0) - observed.get(k)!) / observed.get(k)!;

      return {
        ...u,
        tb,
        current,
        observed,
        mCalibrated: best?.m ?? null,
        calibrationUsed,
        error: usable.length ? err / usable.length : null,
        observedMonths: usable.length,
        m,
        growth,
        nitrogen,
        production,
        capacity,
        ppr,
      };
    });

  return { today, units, climate, incomplete };
}

export interface ProjScope {
  name: string;
  areaHa: number;
  units: ProjUnit[];
  current: number;
  observed: ByMonth;
  capacity: ByMonth[];
  ppr: ByMonth;
  /** Clima do cenário normal. */
  months: Map<number, MonthClimate>;
}

/** A fazenda inteira ('farm') ou uma unidade, com as médias ponderadas pela área. */
export function projectScope(model: ProjModel, scope: string): ProjScope | null {
  const units = scope === 'farm' ? model.units : model.units.filter((u) => u.id === scope);
  const areaHa = units.reduce((s, u) => s + u.areaHa, 0);
  if (!units.length || !areaHa) return null;
  const weighted = (fn: (u: ProjUnit) => number) => units.reduce((s, u) => s + fn(u) * u.areaHa, 0) / areaHa;
  const observed: ByMonth = new Map();
  const capacity: ByMonth[] = [new Map(), new Map(), new Map()];
  const ppr: ByMonth = new Map();
  for (let k = -11; k <= 12; k++) {
    if (k <= 0) observed.set(k, weighted((u) => u.observed.get(k) ?? 0));
    ppr.set(k, weighted((u) => u.ppr.get(k) ?? 0));
    for (let s = 0; s < 3; s++) capacity[s].set(k, weighted((u) => u.capacity[s].get(k) ?? 0));
  }
  return { name: scope === 'farm' ? 'Fazenda' : units[0].name, areaHa, units, current: weighted((u) => u.current), observed, capacity, ppr, months: model.climate[1] };
}

export interface NitrogenRow {
  k: number;
  month: MonthClimate;
  /** Capacidade do mês sem adubo novo, UA/ha. */
  capacity: number;
  /** kg de N no mês, somando as unidades. */
  kgN: number;
  /** kg de N por hectare do escopo. */
  kgNHa: number;
  /** FH < 0,5: sem água o adubo não responde, então não há dose. */
  blocked: boolean;
  /** UA que faltam e precisam sair por outra via (venda, suplemento, diferimento) quando o mês está bloqueado. */
  deficitUa: number;
  /** A meta passa do teto físico do pasto, mesmo com adubo. */
  ceiling: boolean;
}

/**
 * Conta inversa: dada a meta de lotação de pasto (UA/ha), quanto N por mês nos
 * próximos doze meses. need = meta × 11,25 ÷ eficiência; déficit = need − P;
 * kg N/ha = déficit × dias ÷ (RN × FH).
 */
export function nitrogenPlan(model: ProjModel, scope: string, target: number): NitrogenRow[] {
  const units = scope === 'farm' ? model.units : model.units.filter((u) => u.id === scope);
  const rows: NitrogenRow[] = [];
  for (let k = 0; k <= 11; k++) {
    const c = model.climate[1].get(k);
    if (!c) continue;
    let kgN = 0;
    let deficitUa = 0;
    let ceiling = false;
    let area = 0;
    let cap = 0;
    for (const u of units) {
      const need = (target * PROJECTION.uaIntakeKg) / PROJECTION.efficiency;
      const deficit = Math.max(0, need - (u.production[1].get(k) ?? 0));
      area += u.areaHa;
      cap += (u.capacity[1].get(k) ?? 0) * u.areaHa;
      if (deficit <= 0) continue;
      if (need > PROJECTION.mCeiling * (u.growth[1].get(k) ?? 0) + (u.nitrogen[1].get(k) ?? 0)) ceiling = true;
      if (c.FH < 0.5) {
        deficitUa += (target - (u.capacity[1].get(k) ?? 0)) * u.areaHa;
        continue;
      }
      kgN += ((deficit * c.days) / (PROJECTION.rn * c.FH)) * u.areaHa;
    }
    rows.push({ k, month: c, capacity: area ? cap / area : 0, kgN, kgNHa: area ? kgN / area : 0, blocked: c.FH < 0.5, deficitUa, ceiling });
  }
  return rows;
}
