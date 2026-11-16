import type { RainRecord } from '../../data/types';
import type { IsoDate } from '../lots/dates';

export interface RainDay {
  date: IsoDate;
  /** Soma das leituras do dia. */
  mm: number;
  records: RainRecord[];
}

/** Chuva registrada por dia, do mais recente para o mais antigo. Duas leituras no mesmo dia se somam. */
export function rainByDay(rain: readonly RainRecord[]): RainDay[] {
  const days = new Map<IsoDate, RainDay>();
  for (const r of rain) {
    const d = days.get(r.date);
    if (d) {
      d.mm += r.mm;
      d.records.push(r);
    } else {
      days.set(r.date, { date: r.date, mm: r.mm, records: [r] });
    }
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Total registrado num dia. Null quando não há leitura (dia sem leitura não é dia de 0 mm). */
export function rainOn(rain: readonly RainRecord[], date: IsoDate): number | null {
  let total: number | null = null;
  for (const r of rain) if (r.date === date) total = (total ?? 0) + r.mm;
  return total;
}

export interface RainMonth {
  /** 'AAAA-MM' */
  month: string;
  mm: number;
  /** Dias do mês com leitura registrada. */
  days: number;
}

/** Total registrado por mês, do mais recente para o mais antigo. */
export function rainByMonth(rain: readonly RainRecord[]): RainMonth[] {
  const months = new Map<string, RainMonth>();
  for (const d of rainByDay(rain)) {
    const key = d.date.slice(0, 7);
    const m = months.get(key);
    if (m) {
      m.mm += d.mm;
      m.days += 1;
    } else {
      months.set(key, { month: key, mm: d.mm, days: 1 });
    }
  }
  return [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'AAAA-MM' para 'nov 2026'. */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? '?'} ${month.slice(0, 4)}`;
}
