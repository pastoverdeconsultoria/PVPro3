import { formatBr, type IsoDate } from './dates';
import type { LotDerived, LotEvent, LotLocation, LotState, Problem, Stay } from './types';

/** Registros válidos em ordem de acontecimento: data, depois `seq`, depois posição na lista. */
export function orderEvents(events: readonly LotEvent[]): LotEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.deletedAt)
    .sort((a, b) => {
      if (a.e.date !== b.e.date) return a.e.date < b.e.date ? -1 : 1;
      const sa = a.e.seq ?? Number.POSITIVE_INFINITY;
      const sb = b.e.seq ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}

/**
 * Recalcula tudo de um lote a partir do histórico: cabeças, peso, categoria,
 * suplemento, estadias e onde ele está. Nada disso é lido de campo gravado.
 * Portado do `derive` e do `closeZero` do simulador; a estadia, que lá era
 * gravada, aqui sai dos registros de entrada e saída de piquete.
 */
export function deriveLot(lotId: string, allEvents: readonly LotEvent[]): LotDerived {
  const events = orderEvents(allEvents.filter((e) => e.lotId === lotId));

  let heads = 0;
  let weightKg = 0;
  let category = '';
  let supplPct = 0;
  let formationDate: IsoDate | null = null;
  let zeroSince: IsoDate | null = null;
  let stay: { paddockId: string; start: IsoDate } | null = null;
  let lastExit: { date: IsoDate; paddockId: string } | null = null;

  const timeline: LotState[] = [];
  const stays: Stay[] = [];
  const problems: Problem[] = [];

  const closeStay = (date: IsoDate) => {
    if (!stay) return;
    // Entrou e saiu no mesmo dia: não ocupou o piquete, a estadia some.
    if (date !== stay.start) stays.push({ lotId, paddockId: stay.paddockId, start: stay.start, end: date });
    lastExit = { date, paddockId: stay.paddockId };
    stay = null;
  };

  for (const e of events) {
    switch (e.type) {
      case 'inicio':
        if (formationDate) problems.push({ kind: 'formacao_duplicada', date: e.date });
        formationDate ??= e.date;
        heads = e.heads;
        weightKg = e.weightKg;
        category = e.category;
        break;
      case 'animais_entrada':
      case 'transf_in': {
        // Quem entra sem peso informado entra com o peso médio do lote.
        const kg = e.weightKg ?? weightKg;
        weightKg = heads + e.heads > 0 ? (heads * weightKg + e.heads * kg) / (heads + e.heads) : kg;
        heads += e.heads;
        break;
      }
      case 'animais_saida':
      case 'transf_out':
        heads -= e.heads;
        break;
      case 'pesagem':
        weightKg = e.weightKg;
        break;
      case 'categoria':
        category = e.category;
        break;
      case 'suplemento':
        supplPct = e.pctPv;
        break;
      case 'piquete_entrada':
        if (stay && stay.paddockId === e.paddockId) break; // reafirmação: não parte a estadia
        if (stay) {
          problems.push({ kind: 'entrada_sem_saida', date: e.date });
          closeStay(e.date);
        }
        stay = { paddockId: e.paddockId, start: e.date };
        break;
      case 'piquete_saida':
        if (!stay) {
          problems.push({ kind: 'saida_sem_entrada', date: e.date });
        } else {
          if (stay.paddockId !== e.paddockId) problems.push({ kind: 'saida_de_outro_piquete', date: e.date });
          closeStay(e.date);
        }
        break;
    }

    if (heads < 0 && !problems.some((p) => p.kind === 'cabecas_negativas')) {
      problems.push({ kind: 'cabecas_negativas', date: e.date });
    }
    if (heads <= 0) {
      zeroSince ??= e.date;
      // Lote que zerou não ocupa piquete: a estadia fecha no dia em que zerou.
      closeStay(e.date);
    } else {
      zeroSince = null;
    }

    const state: LotState = { date: e.date, heads: Math.max(0, heads), weightKg, category, supplPct };
    if (timeline.length && timeline[timeline.length - 1].date === e.date) timeline[timeline.length - 1] = state;
    else timeline.push(state);
  }

  if (!formationDate) {
    problems.push({ kind: 'sem_formacao' });
  } else if (events.some((e) => e.date < formationDate!)) {
    problems.push({ kind: 'antes_da_formacao', formationDate });
  }

  const open = stay as { paddockId: string; start: IsoDate } | null;
  const exit = lastExit as { date: IsoDate; paddockId: string } | null;
  if (open) stays.push({ lotId, paddockId: open.paddockId, start: open.start, end: null });

  let location: LotLocation;
  if (zeroSince && formationDate) location = { kind: 'sem_animais', since: zeroSince };
  else if (open) location = { kind: 'no_piquete', paddockId: open.paddockId, since: open.start };
  else if (exit) location = { kind: 'fora', since: exit.date, lastPaddockId: exit.paddockId };
  else location = { kind: 'sem_movimentacao' };

  return {
    lotId,
    formationDate,
    timeline,
    current: timeline.length ? timeline[timeline.length - 1] : null,
    stays,
    location,
    problems,
  };
}

/** Estado do lote ao fim de um dia (o último registro até essa data). */
export function stateAt(derived: Pick<LotDerived, 'timeline'>, date: IsoDate): LotState | null {
  let found: LotState | null = null;
  for (const s of derived.timeline) {
    if (s.date <= date) found = s;
    else break;
  }
  return found;
}

/** Mensagem para a tela, ou null se o histórico está consistente. */
export function problemMessage(p: Problem, lotName = 'O lote'): string {
  switch (p.kind) {
    case 'sem_formacao':
      return `${lotName} não tem registro de formação.`;
    case 'formacao_duplicada':
      return `${lotName} tem mais de um registro de formação (${formatBr(p.date)}).`;
    case 'antes_da_formacao':
      return `Há registro de ${lotName} antes da formação do lote (${formatBr(p.formationDate)}).`;
    case 'cabecas_negativas':
      return `${lotName} ficaria com menos de zero cabeças em ${formatBr(p.date)}.`;
    case 'saida_sem_entrada':
      return `${lotName} tem saída de piquete em ${formatBr(p.date)} sem entrada antes.`;
    case 'entrada_sem_saida':
      return `${lotName} tem entrada em piquete em ${formatBr(p.date)} sem ter saído do anterior.`;
    case 'saida_de_outro_piquete':
      return `${lotName} tem saída em ${formatBr(p.date)} de um piquete onde não estava.`;
  }
}

/** Primeiro problema do histórico em texto, ou null. Usado para aceitar ou recusar uma alteração. */
export function validateLot(lotId: string, events: readonly LotEvent[], lotName?: string): string | null {
  const [first] = deriveLot(lotId, events).problems;
  return first ? problemMessage(first, lotName) : null;
}

/**
 * Quais lotes ocupam cada piquete agora. Só entra lote com animais e com estadia
 * aberta, então piquete nunca fica ocupado por lote que não existe mais.
 */
export function paddockOccupancy(events: readonly LotEvent[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const lotId of new Set(events.map((e) => e.lotId))) {
    const { location } = deriveLot(lotId, events);
    if (location.kind !== 'no_piquete') continue;
    out.set(location.paddockId, [...(out.get(location.paddockId) ?? []), lotId]);
  }
  return out;
}
