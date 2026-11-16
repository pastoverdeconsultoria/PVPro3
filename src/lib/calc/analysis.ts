import type { FarmView } from '../farm/farmView';
import { addDays, diffDays, type IsoDate } from '../lots/dates';
import { clipToWindow } from './occupancy';

/** Lotação de um piquete num período. */
export interface PaddockPeriodStats {
  paddockId: string;
  areaHa: number;
  uaDays: number;
  uapDays: number;
  /** Lotação no período: UA-dia ÷ área ÷ dias do período. O descanso entra no denominador. */
  uaHa: number;
  uapHa: number;
  /** Dias com gado dentro, no período. */
  grazedDays: number;
  /** Quantos períodos de pastejo o piquete teve no período analisado. */
  periods: number;
  /** Ocorrida média: UA-dia ÷ área ÷ dias de pastejo. Null se não foi pastejado. */
  occurredUaHa: number | null;
  occurredUapHa: number | null;
}

export interface MonthPoint {
  /** 'AAAA-MM' */
  month: string;
  /** Dias do mês dentro do histórico (o mês corrente vai só até hoje). Zero: mês sem histórico. */
  days: number;
  uaHa: number | null;
  uapHa: number | null;
}

export interface FarmAnalysis {
  /** Não há nenhuma entrada em piquete registrada. */
  empty: boolean;
  from: IsoDate;
  to: IsoDate;
  days: number;
  /** O histórico cobre menos que a janela pedida (um ano). */
  partial: boolean;
  areaHa: number;
  uaDays: number;
  uapDays: number;
  /** Lotação global da fazenda no período: UA-dia nos piquetes de pastejo ÷ área útil ÷ dias. */
  uaHa: number | null;
  uapHa: number | null;
  months: MonthPoint[];
  /** Só piquetes de pastejo. */
  paddocks: PaddockPeriodStats[];
}

const monthKey = (d: IsoDate) => d.slice(0, 7);
const nextMonthStart = (month: string): IsoDate => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
const previousMonth = (month: string): string => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * Lotação anual (aba Análise). Período: os últimos `windowDays` dias até hoje,
 * mas nunca antes da primeira entrada de gado registrada. Dividir 30 dias de
 * histórico por 365 daria uma lotação falsa de tão baixa, então enquanto a
 * fazenda não tem um ano de registro o período é o que existe, e a tela avisa.
 */
export function analyzeFarm(view: FarmView, windowDays = 365): FarmAnalysis {
  const today = view.today;
  const endExclusive = addDays(today, 1);
  const grazing = view.paddocks.filter((p) => p.paddock.isGrazing);
  const areaHa = view.totals.grazingAreaHa;

  let first: IsoDate | null = null;
  for (const p of view.paddocks) {
    for (const s of p.segments) if (!first || s.start < first) first = s.start;
  }
  const windowStart = addDays(today, -(windowDays - 1));
  const from = first && first > windowStart ? first : windowStart;
  const days = diffDays(from, endExclusive);

  const paddocks: PaddockPeriodStats[] = grazing.map((p) => {
    const c = clipToWindow(p.segments, from, endExclusive);
    const area = p.paddock.areaHa;
    return {
      paddockId: p.paddock.id,
      areaHa: area,
      uaDays: c.uaDays,
      uapDays: c.uapDays,
      uaHa: c.uaDays / area / days,
      uapHa: c.uapDays / area / days,
      grazedDays: c.grazedDays,
      periods: c.periods,
      occurredUaHa: c.grazedDays ? c.uaDays / area / c.grazedDays : null,
      occurredUapHa: c.grazedDays ? c.uapDays / area / c.grazedDays : null,
    };
  });
  const uaDays = paddocks.reduce((s, p) => s + p.uaDays, 0);
  const uapDays = paddocks.reduce((s, p) => s + p.uapDays, 0);
  const has = !!first && areaHa > 0;

  // Doze meses terminando no mês corrente, do mais antigo para o mais recente.
  const months: MonthPoint[] = [];
  let month = monthKey(today);
  for (let i = 0; i < 12; i++) {
    const mStart = `${month}-01`;
    const mEnd = nextMonthStart(month);
    const start = mStart > from ? mStart : from;
    const end = mEnd < endExclusive ? mEnd : endExclusive;
    const mDays = first && end > start ? diffDays(start, end) : 0;
    if (!mDays || !areaHa) months.unshift({ month, days: 0, uaHa: null, uapHa: null });
    else {
      let u = 0;
      let up = 0;
      for (const p of grazing) {
        const c = clipToWindow(p.segments, start, end);
        u += c.uaDays;
        up += c.uapDays;
      }
      months.unshift({ month, days: mDays, uaHa: u / areaHa / mDays, uapHa: up / areaHa / mDays });
    }
    month = previousMonth(month);
  }

  return {
    empty: !first,
    from,
    to: today,
    days,
    partial: !first || first > windowStart,
    areaHa,
    uaDays,
    uapDays,
    uaHa: has ? uaDays / areaHa / days : null,
    uapHa: has ? uapDays / areaHa / days : null,
    months,
    paddocks,
  };
}
