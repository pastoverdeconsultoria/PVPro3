import { addDays, diffDays, type IsoDate } from '../lots/dates';
import { dayAt, seriesEnd, type ClimateSeries, type DayWeather } from './openMeteo';

// Evapotranspiração, cenários de chuva e balanço hídrico mensal. Portado do
// simulador (`eto`, `kcM`, `climSeries`), trocando o clima sintético por dado real.

/** Água disponível do solo, em mm. Não validado para os solos das fazendas. */
export const CAD_MM = 75;

/** Dia do ano, 1 a 366. */
function dayOfYear(date: IsoDate): number {
  return diffDays(`${date.slice(0, 4)}-01-01`, date) + 1;
}

/**
 * Evapotranspiração de referência por Hargreaves-Samani, em mm/dia. Só precisa
 * de latitude e das temperaturas máxima e mínima do dia.
 */
export function etoHargreaves(latDeg: number, date: IsoDate, tmin: number, tmax: number): number {
  const J = dayOfYear(date);
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365);
  const de = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(de))));
  // Radiação no topo da atmosfera, em MJ/m²/dia; × 0,408 vira mm/dia.
  const Ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(de) + Math.cos(phi) * Math.cos(de) * Math.sin(ws));
  return Math.max(0, 0.0023 * ((tmin + tmax) / 2 + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * Ra * 0.408);
}

/**
 * Kc do pasto por mês (0 = janeiro), como no simulador: 0,6 de junho a agosto,
 * 1,2 de dezembro a fevereiro, 0,9 nos demais. No hemisfério norte o calendário
 * é deslocado seis meses.
 */
export function kcOf(month: number, latDeg: number): number {
  const m = latDeg < 0 ? month : (month + 6) % 12;
  if (m >= 5 && m <= 7) return 0.6;
  if (m === 11 || m <= 1) return 1.2;
  return 0.9;
}

export type Scenario = 0 | 1 | 2;
export const SCENARIOS: { label: string; quantile: number }[] = [
  { label: 'Seco', quantile: 0.2 },
  { label: 'Normal', quantile: 0.5 },
  { label: 'Chuvoso', quantile: 0.8 },
];

/**
 * Cenários de chuva tirados do histórico real. Para cada mês do ano, os anos do
 * histórico são ordenados pela chuva daquele mês; o cenário seco usa o ano do
 * quantil 20%, o normal o da mediana e o chuvoso o do quantil 80%. O futuro é
 * projetado repetindo os dias reais desse ano, com a chuva em pancadas como ela
 * cai de verdade, e não espalhada por igual. Substitui os multiplicadores de
 * 75% e 125% do simulador.
 *
 * `analog[cenário][mês]` é o ano escolhido, ou null se não há histórico bastante.
 */
export interface Scenarios {
  analog: (number | null)[][];
  /** Chuva média de cada mês do ano no histórico ("normal"), em mm. */
  normalRain: (number | null)[];
  /** Quantos anos completos entraram em cada mês. */
  years: number[];
}

const monthStart = (y: number, m: number): IsoDate => `${y}-${String(m + 1).padStart(2, '0')}-01`;
const nextMonth = (y: number, m: number): IsoDate => (m === 11 ? monthStart(y + 1, 0) : monthStart(y, m + 1));

export function buildScenarios(series: ClimateSeries, today: IsoDate): Scenarios {
  const firstYear = Number(series.start.slice(0, 4));
  const lastYear = Number(today.slice(0, 4));
  const analog: (number | null)[][] = [[], [], []];
  const normalRain: (number | null)[] = [];
  const years: number[] = [];
  for (let m = 0; m < 12; m++) {
    const totals: { year: number; rain: number }[] = [];
    for (let y = firstYear; y <= lastYear; y++) {
      const a = monthStart(y, m);
      const b = nextMonth(y, m);
      // Só mês inteiro e já passado: nada de mês corrente nem de previsão.
      if (a < series.start || b > today) continue;
      let rain = 0;
      let complete = true;
      for (let d = a; d < b; d = addDays(d, 1)) {
        const w = dayAt(series, d);
        if (!w) {
          complete = false;
          break;
        }
        rain += w.rain;
      }
      if (complete) totals.push({ year: y, rain });
    }
    totals.sort((p, q) => p.rain - q.rain || p.year - q.year);
    years.push(totals.length);
    normalRain.push(totals.length ? totals.reduce((s, t) => s + t.rain, 0) / totals.length : null);
    for (let s = 0; s < 3; s++) {
      analog[s].push(totals.length >= 3 ? totals[Math.round(SCENARIOS[s].quantile * (totals.length - 1))].year : null);
    }
  }
  return { analog, normalRain, years };
}

/**
 * Tempo de um dia: o observado (ou a previsão dos próximos dias) quando existe;
 * depois disso, o mesmo dia do ano análogo do cenário.
 */
export function weatherOn(series: ClimateSeries, scenarios: Scenarios, date: IsoDate, scenario: Scenario): DayWeather | null {
  if (date <= seriesEnd(series)) {
    const w = dayAt(series, date);
    if (w) return w;
  }
  const year = scenarios.analog[scenario][Number(date.slice(5, 7)) - 1];
  if (year == null) return null;
  const md = date.slice(5);
  // 29 de fevereiro num ano análogo que não é bissexto: usa o dia 28.
  return dayAt(series, `${year}-${md}`) ?? (md === '02-29' ? dayAt(series, `${year}-02-28`) : null);
}

/** Um mês do balanço hídrico. `k` é a distância em meses do mês corrente (0 = este mês). */
export interface MonthClimate {
  k: number;
  /** Primeiro dia do mês e primeiro dia do mês seguinte. */
  a: IsoDate;
  b: IsoDate;
  /** Mês do ano, 0 = janeiro. */
  month: number;
  year: number;
  days: number;
  /** Chuva do mês em mm. No passado, a real registrada entra no lugar da estimada, dia a dia. */
  rain: number;
  /** Temperatura média do mês. */
  T: number;
  /** ETR/ETM do mês. */
  ratio: number;
  /** Fator hídrico: 1 se ETR/ETM ≥ 0,5; senão 2 × ETR/ETM. */
  FH: number;
  /** Faltou dado de clima em algum dia do mês. */
  incomplete: boolean;
}

export function monthOffset(today: IsoDate, k: number): { a: IsoDate; b: IsoDate; month: number; year: number } {
  const total = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) + k;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return { a: monthStart(year, month), b: nextMonth(year, month), month, year };
}

export const fhOf = (ratio: number) => (ratio >= 0.5 ? 1 : 2 * ratio);

/**
 * Balanço hídrico diário, resumido por mês, de 24 meses atrás a 12 à frente.
 * O solo começa com metade da CAD e os dois anos de passado servem para o
 * armazenamento chegar ao presente num valor coerente. `realRain` é a chuva
 * registrada no app, por dia; onde existe, substitui a estimada daquele dia.
 */
export function monthSeries(
  series: ClimateSeries,
  scenarios: Scenarios,
  realRain: ReadonlyMap<IsoDate, number>,
  today: IsoDate,
  scenario: Scenario,
  cad = CAD_MM,
): Map<number, MonthClimate> {
  const out = new Map<number, MonthClimate>();
  let soil = cad / 2;
  for (let k = -24; k <= 12; k++) {
    const r = monthOffset(today, k);
    let etr = 0;
    let etm = 0;
    let temp = 0;
    let rain = 0;
    let counted = 0;
    let incomplete = false;
    for (let d = r.a; d < r.b; d = addDays(d, 1)) {
      // Passado e previsão não dependem do cenário; só o que vem depois da previsão.
      const w = weatherOn(series, scenarios, d, scenario);
      if (!w) {
        incomplete = true;
        continue;
      }
      const real = d <= today ? realRain.get(d) : undefined;
      const mm = real ?? w.rain;
      const em = etoHargreaves(series.lat, d, w.tmin, w.tmax) * kcOf(r.month, series.lat);
      const available = soil + mm;
      const er = Math.min(available, em * Math.min(1, available / (0.5 * cad)));
      soil = Math.min(cad, available - er);
      etr += er;
      etm += em;
      temp += (w.tmin + w.tmax) / 2;
      rain += mm;
      counted += 1;
    }
    const ratio = etm ? etr / etm : 1;
    out.set(k, { k, ...r, days: diffDays(r.a, r.b), rain, T: counted ? temp / counted : Number.NaN, ratio, FH: fhOf(ratio), incomplete: incomplete || !counted });
  }
  return out;
}
