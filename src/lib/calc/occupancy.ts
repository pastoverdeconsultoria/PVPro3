import { addDays, diffDays, type IsoDate } from '../lots/dates';
import { stateAt } from '../lots/deriveLot';
import type { LotDerived } from '../lots/types';
import { ua } from '../lots/ua';
import { pastureFraction } from './supplement';

// Motor da lotação ocorrida. Tudo sai das estadias e do estado do lote, que por
// sua vez saem do histórico: nada aqui lê campo gravado.
//
// Convenção de dias: o dia pertence ao piquete onde o lote termina o dia. Entrou
// em 1/11 e saiu em 13/11 são 12 dias de pastejo (1 a 12); o dia 13 já é do
// piquete seguinte. Para quem ainda está no piquete, hoje conta.

/** Trecho de estadia de um lote num piquete em que cabeças, peso e suplemento não mudam. */
export interface Segment {
  lotId: string;
  paddockId: string;
  start: IsoDate;
  /** Primeiro dia fora do trecho. */
  end: IsoDate;
  days: number;
  ua: number;
  /** UA de pasto: UA descontado o capim que o suplemento substitui. */
  uap: number;
  /** O lote ainda está no piquete. */
  open: boolean;
}

/** Corta cada estadia do lote a cada mudança de estado (pesagem, entrada ou saída de animais, suplemento). */
export function lotSegments(lotId: string, derived: LotDerived, today: IsoDate): Segment[] {
  const endOfToday = addDays(today, 1);
  const out: Segment[] = [];
  for (const stay of derived.stays) {
    const end = stay.end ?? endOfToday;
    if (end <= stay.start) continue;
    const cuts = [stay.start, ...derived.timeline.map((s) => s.date).filter((d) => d > stay.start && d < end), end];
    for (let i = 0; i < cuts.length - 1; i++) {
      const state = stateAt(derived, cuts[i]);
      if (!state || state.heads <= 0) continue;
      const total = ua(state.heads, state.weightKg);
      out.push({
        lotId,
        paddockId: stay.paddockId,
        start: cuts[i],
        end: cuts[i + 1],
        days: diffDays(cuts[i], cuts[i + 1]),
        ua: total,
        uap: total * pastureFraction(state.supplPct),
        open: stay.end == null,
      });
    }
  }
  return out;
}

/**
 * Período de pastejo de um piquete: o tempo contínuo com gado dentro, seja de um
 * lote ou de vários. Se um lote sai e outro entra no mesmo dia, o período
 * continua; dois lotes juntos somam as UA. Só um dia inteiro vazio encerra o
 * período. (Decisão de 16 nov 2026, por delegação do Lucas: o período é do
 * piquete, não do lote como no simulador.)
 */
export interface Period {
  paddockId: string;
  start: IsoDate;
  /** Dia em que o piquete ficou vazio (primeiro dia fora do período). */
  end: IsoDate;
  /** Ainda há gado dentro. */
  open: boolean;
  days: number;
  uaDays: number;
  uapDays: number;
  lotIds: string[];
}

export function paddockPeriods(segments: readonly Segment[]): Period[] {
  const sorted = [...segments].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: Period[] = [];
  let cur: Period | null = null;
  for (const s of sorted) {
    if (cur && s.start <= cur.end) {
      if (s.end > cur.end) cur.end = s.end;
      cur.open = cur.open || s.open;
      if (!cur.lotIds.includes(s.lotId)) cur.lotIds.push(s.lotId);
    } else {
      if (cur) out.push(cur);
      cur = { paddockId: s.paddockId, start: s.start, end: s.end, open: s.open, days: 0, uaDays: 0, uapDays: 0, lotIds: [s.lotId] };
    }
    cur.uaDays += s.ua * s.days;
    cur.uapDays += s.uap * s.days;
  }
  if (cur) out.push(cur);
  for (const p of out) p.days = diffDays(p.start, p.end);
  return out;
}

/** UA-dia e dias com gado dentro de uma janela `[from, to)`. */
export function clipToWindow(
  segments: readonly Segment[],
  from: IsoDate,
  to: IsoDate,
): { uaDays: number; uapDays: number; grazedDays: number; periods: number } {
  let uaDays = 0;
  let uapDays = 0;
  const clipped: Segment[] = [];
  for (const s of segments) {
    const start = s.start > from ? s.start : from;
    const end = s.end < to ? s.end : to;
    if (end <= start) continue;
    const days = diffDays(start, end);
    uaDays += s.ua * days;
    uapDays += s.uap * days;
    clipped.push({ ...s, start, end, days });
  }
  // Dias com gado contam uma vez só, mesmo com dois lotes juntos.
  const periods = paddockPeriods(clipped);
  return { uaDays, uapDays, grazedDays: periods.reduce((n, p) => n + p.days, 0), periods: periods.length };
}
