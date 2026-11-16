import { diffDays, type IsoDate } from './dates';
import { orderEvents } from './deriveLot';
import type { LotEvent } from './types';

export interface Gmd {
  /** Ganho médio diário em kg por cabeça. */
  kgDay: number;
  from: IsoDate;
  to: IsoDate;
  days: number;
}

/**
 * GMD do lote. É a única conta de GMD do app; toda tela lê daqui (CLAUDE.md,
 * invariante 5). Compara os dois últimos DIAS com pesagem, valendo a pesagem
 * mais recente de cada dia. Com menos de dois dias pesados devolve null, então
 * duas pesagens no mesmo dia nunca viram divisão por zero. O peso do cadastro
 * do lote não é pesagem e não entra.
 */
export function lotGmd(events: readonly LotEvent[]): Gmd | null {
  const byDay = new Map<IsoDate, number>();
  for (const e of orderEvents(events)) {
    if (e.type === 'pesagem') byDay.set(e.date, e.weightKg); // a última do dia sobrescreve
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return null;
  const from = days[days.length - 2];
  const to = days[days.length - 1];
  const span = diffDays(from, to);
  return { kgDay: (byDay.get(to)! - byDay.get(from)!) / span, from, to, days: span };
}

/** Data da pesagem mais recente, ou null se o lote nunca foi pesado. */
export function lastWeighDate(events: readonly LotEvent[]): IsoDate | null {
  let last: IsoDate | null = null;
  for (const e of events) {
    if (!e.deletedAt && e.type === 'pesagem' && (!last || e.date > last)) last = e.date;
  }
  return last;
}
