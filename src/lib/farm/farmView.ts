import type { FarmData, Lot, Paddock } from '../../data/types';
import { lotSegments, paddockPeriods, type Period, type Segment } from '../calc/occupancy';
import { pastureFraction } from '../calc/supplement';
import { addDays, diffDays, type IsoDate } from '../lots/dates';
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
  /** UA de pasto: UA descontado o capim que o suplemento substitui. */
  uap: number;
  gmd: Gmd | null;
  lastWeigh: IsoDate | null;
  location: LotLocation;
  /** Inconsistência no histórico, em texto, ou null. */
  problem: string | null;
}

/** Período de pastejo do piquete com a lotação ocorrida já calculada. */
export interface PeriodView extends Period {
  /** Ocorrida: UA médias durante o período ÷ área. Fixa depois que o gado sai. */
  uaHa: number;
  uapHa: number;
}

export interface PaddockView {
  paddock: Paddock;
  /** Lotes com animais que estão no piquete agora. */
  occupants: LotView[];
  /** UA presentes agora. */
  ua: number;
  uap: number;
  /** Lotação instantânea: UA presentes ÷ área. Só existe com gado dentro. */
  instantUaHa: number | null;
  /** Início do período de pastejo em curso (do piquete, não de um lote). */
  since: IsoDate | null;
  /** Dia de uso: o dia da entrada conta como dia 1. */
  dayOfUse: number | null;
  /** Última saída de gado: do histórico ou, na falta dele, a informada na abertura. */
  lastExit: { date: IsoDate; source: 'historico' | 'abertura' } | null;
  /** Dias de descanso. Null se ocupado ou se nunca houve saída registrada ("sem dado"). */
  restDays: number | null;
  /** Trechos de estadia de todos os lotes neste piquete (base de todo cálculo de lotação). */
  segments: Segment[];
  /** Períodos de pastejo, do mais antigo para o mais recente. */
  periods: PeriodView[];
  /** Período em curso, se há gado dentro. */
  current: PeriodView | null;
  /** Último período encerrado. */
  lastPeriod: PeriodView | null;
  /**
   * Global do ciclo: UA-dia do último pastejo ÷ área ÷ (dias de pastejo + dias de
   * descanso até hoje). É aqui que o descanso entra. Só existe em descanso.
   */
  cycleUaHa: number | null;
  cycleUapHa: number | null;
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
    /** O mesmo, em UA de pasto (com o desconto do suplemento). */
    uapInPasture: number;
    /** UA dos lotes com animais que não estão em piquete de pastejo. */
    uaOutside: number;
    /** Lotação global da fazenda: UA em pastejo ÷ área útil. Null sem lote ou sem área. */
    globalUaHa: number | null;
    globalUapHa: number | null;
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

  const segmentsByPaddock = new Map<string, Segment[]>();

  // Lote apagado some de tudo: piquete não fica ocupado por lote que não existe mais.
  const lots: LotView[] = data.lots
    .filter((l) => !l.deletedAt)
    .map((lot) => {
      const events = byLot.get(lot.id) ?? [];
      const derived = deriveLot(lot.id, events);
      for (const s of lotSegments(lot.id, derived, today)) {
        const list = segmentsByPaddock.get(s.paddockId);
        if (list) list.push(s);
        else segmentsByPaddock.set(s.paddockId, [s]);
      }
      const cur = derived.current;
      const heads = cur?.heads ?? 0;
      const weightKg = cur?.weightKg ?? 0;
      const supplPct = cur?.supplPct ?? 0;
      const total = ua(heads, weightKg);
      return {
        lot,
        events,
        derived,
        heads,
        weightKg,
        category: cur?.category ?? '',
        supplPct,
        ua: total,
        uap: total * pastureFraction(supplPct),
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
      const sumUap = occupants.reduce((s, l) => s + l.uap, 0);
      const occupied = occupants.length > 0;

      const segments = segmentsByPaddock.get(paddock.id) ?? [];
      const periods: PeriodView[] = paddockPeriods(segments).map((p) => ({
        ...p,
        uaHa: p.days ? p.uaDays / paddock.areaHa / p.days : 0,
        uapHa: p.days ? p.uapDays / paddock.areaHa / p.days : 0,
      }));
      const last = periods[periods.length - 1];
      const current = occupied && last?.open ? last : null;
      const closed = periods.filter((p) => !p.open);
      const lastPeriod = closed[closed.length - 1] ?? null;

      let lastExit: PaddockView['lastExit'] = lastPeriod ? { date: lastPeriod.end, source: 'historico' } : null;
      if (paddock.initialLastExit && (!lastExit || paddock.initialLastExit > lastExit.date)) {
        lastExit = { date: paddock.initialLastExit, source: 'abertura' };
      }

      // Dias do ciclo: do início do último pastejo até hoje, inclusive.
      const cycleDays = !occupied && lastPeriod ? diffDays(lastPeriod.start, addDays(today, 1)) : 0;

      return {
        paddock,
        occupants,
        ua: sumUa,
        uap: sumUap,
        instantUaHa: occupied ? sumUa / paddock.areaHa : null,
        since: current?.start ?? null,
        dayOfUse: current ? diffDays(current.start, today) + 1 : null,
        lastExit,
        restDays: occupied || !lastExit ? null : Math.max(0, diffDays(lastExit.date, today)),
        segments,
        periods,
        current,
        lastPeriod,
        cycleUaHa: cycleDays > 0 && lastPeriod ? lastPeriod.uaDays / paddock.areaHa / cycleDays : null,
        cycleUapHa: cycleDays > 0 && lastPeriod ? lastPeriod.uapDays / paddock.areaHa / cycleDays : null,
      };
    });

  const paddockById = new Map(paddocks.map((p) => [p.paddock.id, p]));
  const grazing = paddocks.filter((p) => p.paddock.isGrazing);
  const grazingAreaHa = grazing.reduce((s, p) => s + p.paddock.areaHa, 0);
  const withAnimals = lots.filter((l) => l.heads > 0);
  const uaTotal = withAnimals.reduce((s, l) => s + l.ua, 0);
  const uaInPasture = grazing.reduce((s, p) => s + p.ua, 0);
  const uapInPasture = grazing.reduce((s, p) => s + p.uap, 0);
  const hasGlobal = grazingAreaHa > 0 && withAnimals.length > 0;

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
      uapInPasture,
      uaOutside: uaTotal - uaInPasture,
      globalUaHa: hasGlobal ? uaInPasture / grazingAreaHa : null,
      globalUapHa: hasGlobal ? uapInPasture / grazingAreaHa : null,
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

/** Mostra a versão "de pasto" só quando o suplemento faz diferença visível. */
export function differs(total: number, pasture: number): boolean {
  return total > 0 && (total - pasture) / total > 0.005;
}
