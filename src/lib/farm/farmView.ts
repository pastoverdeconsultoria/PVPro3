import type { FarmData, Lot, Paddock } from '../../data/types';
import { diffDays, type IsoDate } from '../lots/dates';
import { deriveLot, problemMessage } from '../lots/deriveLot';
import { lastWeighDate, lotGmd, type Gmd } from '../lots/gmd';
import type { LotDerived, LotEvent, LotLocation } from '../lots/types';
import { ua } from '../lots/ua';

export interface LotView {
  lot: Lot;
  /** Histórico do lote, inclusive os registros apagados (para poder desfazer). */
  events: LotEvent[];
  derived: LotDerived;
  heads: number;
  weightKg: number;
  category: string;
  supplPct: number;
  ua: number;
  gmd: Gmd | null;
  lastWeigh: IsoDate | null;
  location: LotLocation;
  /** Inconsistência no histórico, em texto, ou null. */
  problem: string | null;
}

export interface PaddockView {
  paddock: Paddock;
  /** Lotes com animais que estão no piquete agora. */
  occupants: LotView[];
  /** UA presentes agora. */
  ua: number;
  /** Lotação instantânea: UA presentes ÷ área. Só existe com gado dentro. */
  instantUaHa: number | null;
  /** Entrada mais antiga entre os lotes presentes. */
  since: IsoDate | null;
  /** Dia de uso: o dia da entrada conta como dia 1. */
  dayOfUse: number | null;
  /** Última saída de gado: do histórico ou, na falta dele, a informada na abertura. */
  lastExit: { date: IsoDate; source: 'historico' | 'abertura' } | null;
  /** Dias de descanso. Null se ocupado ou se nunca houve saída registrada ("sem dado"). */
  restDays: number | null;
  /** Último período de pastejo encerrado no piquete. */
  lastStay: { lotId: string; start: IsoDate; end: IsoDate; days: number } | null;
}

export interface FarmView {
  today: IsoDate;
  lots: LotView[];
  paddocks: PaddockView[];
  lotById: Map<string, LotView>;
  paddockById: Map<string, PaddockView>;
  totals: {
    /** Área útil: soma dos piquetes de pastejo. */
    grazingAreaHa: number;
    totalAreaHa: number;
    heads: number;
    uaTotal: number;
    /** UA dos lotes que estão dentro de piquete de pastejo. */
    uaInPasture: number;
    /** UA dos lotes com animais que não estão em piquete de pastejo. */
    uaOutside: number;
    /** Lotação global da fazenda: UA em pastejo ÷ área útil. Null sem lote ou sem área. */
    globalUaHa: number | null;
    occupied: number;
    resting: number;
    /** GMD do rebanho, ponderado por cabeças, entre os lotes que têm GMD. */
    gmdKgDay: number | null;
  };
}

/**
 * Situação de hoje da fazenda inteira, recalculada do histórico. Nenhum número
 * daqui vem de campo gravado: lote apagado, registro apagado ou data alterada
 * mudam tudo na leitura seguinte.
 */
export function deriveFarm(data: FarmData, today: IsoDate): FarmView {
  const byLot = new Map<string, LotEvent[]>();
  for (const e of data.events) {
    const list = byLot.get(e.lotId);
    if (list) list.push(e);
    else byLot.set(e.lotId, [e]);
  }

  // Lote apagado some de tudo: piquete não fica ocupado por lote que não existe mais.
  const lots: LotView[] = data.lots
    .filter((l) => !l.deletedAt)
    .map((lot) => {
      const events = byLot.get(lot.id) ?? [];
      const derived = deriveLot(lot.id, events);
      const cur = derived.current;
      const heads = cur?.heads ?? 0;
      const weightKg = cur?.weightKg ?? 0;
      return {
        lot,
        events,
        derived,
        heads,
        weightKg,
        category: cur?.category ?? '',
        supplPct: cur?.supplPct ?? 0,
        ua: ua(heads, weightKg),
        gmd: lotGmd(events),
        lastWeigh: lastWeighDate(events),
        location: derived.location,
        problem: derived.problems.length ? problemMessage(derived.problems[0], lot.name) : null,
      };
    })
    .sort((a, b) => a.lot.name.localeCompare(b.lot.name, 'pt-BR', { numeric: true }));

  const paddocks: PaddockView[] = [...data.paddocks]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
    .map((paddock) => {
      const occupants = lots.filter(
        (l) => l.heads > 0 && l.location.kind === 'no_piquete' && l.location.paddockId === paddock.id,
      );
      const sumUa = occupants.reduce((s, l) => s + l.ua, 0);
      const since = occupants.reduce<IsoDate | null>((min, l) => {
        const s = l.location.kind === 'no_piquete' ? l.location.since : null;
        return s && (!min || s < min) ? s : min;
      }, null);

      let lastStay: PaddockView['lastStay'] = null;
      for (const l of lots) {
        for (const s of l.derived.stays) {
          if (s.paddockId !== paddock.id || !s.end) continue;
          if (!lastStay || s.end > lastStay.end || (s.end === lastStay.end && s.start > lastStay.start)) {
            lastStay = { lotId: l.lot.id, start: s.start, end: s.end, days: diffDays(s.start, s.end) };
          }
        }
      }

      let lastExit: PaddockView['lastExit'] = lastStay ? { date: lastStay.end, source: 'historico' } : null;
      if (paddock.initialLastExit && (!lastExit || paddock.initialLastExit > lastExit.date)) {
        lastExit = { date: paddock.initialLastExit, source: 'abertura' };
      }

      const occupied = occupants.length > 0;
      return {
        paddock,
        occupants,
        ua: sumUa,
        instantUaHa: occupied ? sumUa / paddock.areaHa : null,
        since,
        dayOfUse: since ? diffDays(since, today) + 1 : null,
        lastExit,
        restDays: occupied || !lastExit ? null : Math.max(0, diffDays(lastExit.date, today)),
        lastStay,
      };
    });

  const paddockById = new Map(paddocks.map((p) => [p.paddock.id, p]));
  const grazing = paddocks.filter((p) => p.paddock.isGrazing);
  const grazingAreaHa = grazing.reduce((s, p) => s + p.paddock.areaHa, 0);
  const withAnimals = lots.filter((l) => l.heads > 0);
  const uaTotal = withAnimals.reduce((s, l) => s + l.ua, 0);
  const uaInPasture = grazing.reduce((s, p) => s + p.ua, 0);

  let gmdSum = 0;
  let gmdHeads = 0;
  for (const l of withAnimals) {
    if (l.gmd) {
      gmdSum += l.gmd.kgDay * l.heads;
      gmdHeads += l.heads;
    }
  }

  return {
    today,
    lots,
    paddocks,
    lotById: new Map(lots.map((l) => [l.lot.id, l])),
    paddockById,
    totals: {
      grazingAreaHa,
      totalAreaHa: paddocks.reduce((s, p) => s + p.paddock.areaHa, 0),
      heads: withAnimals.reduce((s, l) => s + l.heads, 0),
      uaTotal,
      uaInPasture,
      uaOutside: uaTotal - uaInPasture,
      globalUaHa: grazingAreaHa > 0 && withAnimals.length ? uaInPasture / grazingAreaHa : null,
      occupied: grazing.filter((p) => p.occupants.length).length,
      resting: grazing.filter((p) => !p.occupants.length).length,
      gmdKgDay: gmdHeads ? gmdSum / gmdHeads : null,
    },
  };
}

/**
 * Onde o lote está, em uma frase. As situações são diferentes e a tela diz qual
 * é (CLAUDE.md, invariante 9): sem movimentação, no piquete, fora de piquete
 * depois de uma saída, e sem animais.
 */
export function locationText(l: LotView, paddockName: (id: string) => string, fmt: (d: IsoDate) => string): string {
  const loc = l.location;
  switch (loc.kind) {
    case 'sem_movimentacao':
      return 'Sem movimentação: ainda não entrou em piquete';
    case 'no_piquete':
      return `Em ${paddockName(loc.paddockId)} desde ${fmt(loc.since)}`;
    case 'fora':
      return `Fora de piquete: saiu de ${paddockName(loc.lastPaddockId)} em ${fmt(loc.since)}`;
    case 'sem_animais':
      return `Sem animais desde ${fmt(loc.since)}`;
  }
}
