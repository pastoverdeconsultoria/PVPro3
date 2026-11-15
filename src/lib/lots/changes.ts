import { formatBr, isIsoDate, type IsoDate } from './dates';
import { deriveLot, orderEvents, problemMessage, stateAt } from './deriveLot';
import type { LotEvent } from './types';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): Result<never> => ({ ok: false, error });

/**
 * Confere uma alteração antes de gravar: recalcula o lote com a lista nova e só
 * aceita se o histórico continuar consistente. Quem chama grava `next` se vier
 * ok e não grava nada se vier erro, então não há o que desfazer.
 */
export function checkChange(lotId: string, next: readonly LotEvent[], lotName?: string): Result<LotEvent[]> {
  const [problem] = deriveLot(lotId, next).problems;
  return problem ? fail(problemMessage(problem, lotName)) : { ok: true, value: [...next] };
}

export interface MoveRequest {
  /** Histórico do lote (pode trazer registros de outros lotes; são ignorados). */
  events: readonly LotEvent[];
  lotId: string;
  lotName?: string;
  toPaddockId: string;
  date: IsoDate;
  today: IsoDate;
  /** Gerador de id. Por padrão UUID, para o registro poder nascer offline. */
  newId?: () => string;
}

/**
 * Monta os registros de uma mudança de piquete, sem gravar. Devolve só o que é
 * novo, na ordem em que deve ser gravado: saída do piquete atual e entrada no
 * destino, na mesma transação, com a saída antes (CLAUDE.md, invariante 2).
 * Regras portadas do `doMove` do simulador.
 */
export function planMove(req: MoveRequest): Result<LotEvent[]> {
  const { events, lotId, toPaddockId, date, today } = req;
  const name = req.lotName ?? 'O lote';
  const newId = req.newId ?? (() => crypto.randomUUID());

  if (!isIsoDate(date)) return fail('Informe a data.');
  if (date > today) return fail('A data não pode ser depois de hoje.');

  const lot = deriveLot(lotId, events);
  if (lot.problems.length) return fail(problemMessage(lot.problems[0], name));
  if (date < lot.formationDate!) return fail(`${name} foi formado em ${formatBr(lot.formationDate!)}.`);

  const state = stateAt(lot, date);
  if (!state || state.heads <= 0 || lot.location.kind === 'sem_animais') {
    return fail(`${name} não tem animais em ${formatBr(date)}.`);
  }

  const link = newId();
  const created: LotEvent[] = [];
  const loc = lot.location;

  if (loc.kind === 'no_piquete') {
    if (loc.paddockId === toPaddockId) return fail('O lote já está nesse piquete.');
    if (date < loc.since) {
      return fail(`A entrada atual foi em ${formatBr(loc.since)}; a saída não pode ser antes disso.`);
    }
    created.push({ id: newId(), lotId, date, type: 'piquete_saida', paddockId: loc.paddockId, link });
  } else if (loc.kind === 'fora' && date < loc.since) {
    // Entrada com data antiga não pode passar na frente de uma saída posterior (invariante 3).
    return fail(`A última saída foi em ${formatBr(loc.since)}; a entrada não pode ser antes disso.`);
  }
  created.push({ id: newId(), lotId, date, type: 'piquete_entrada', paddockId: toPaddockId, link });

  // Conferência final: o histórico com os registros novos tem de continuar consistente.
  const check = checkChange(lotId, [...events, ...created], name);
  return check.ok ? { ok: true, value: created } : check;
}

/**
 * Apaga um registro de forma suave e devolve a lista nova, já conferida. Registros
 * ligados (saída e entrada de uma mesma mudança) saem juntos. Tudo é recalculado:
 * se a exclusão deixar o histórico inconsistente, ela é recusada.
 */
export function planRemoval(
  lotId: string,
  events: readonly LotEvent[],
  eventId: string,
  deletedAt: string,
  lotName?: string,
): Result<LotEvent[]> {
  const target = events.find((e) => e.id === eventId && e.lotId === lotId && !e.deletedAt);
  if (!target) return fail('Registro não encontrado.');
  if (target.type === 'inicio') return fail('A formação do lote não pode ser excluída.');
  const next = events.map((e) =>
    !e.deletedAt && (e.id === eventId || (target.link != null && e.link === target.link)) ? { ...e, deletedAt } : e,
  );
  return checkChange(lotId, next, lotName);
}

/** Desfaz uma exclusão suave (e a dos registros ligados), com a mesma conferência. */
export function planRestore(
  lotId: string,
  events: readonly LotEvent[],
  eventId: string,
  lotName?: string,
): Result<LotEvent[]> {
  const target = events.find((e) => e.id === eventId && e.lotId === lotId && e.deletedAt);
  if (!target) return fail('Registro não encontrado.');
  const next = events.map((e) =>
    e.deletedAt && (e.id === eventId || (target.link != null && e.link === target.link)) ? { ...e, deletedAt: null } : e,
  );
  return checkChange(lotId, next, lotName);
}

/** Maior `seq` já usado, para simular em teste a numeração que o servidor faz. */
export function lastSeq(events: readonly LotEvent[]): number {
  return orderEvents(events).reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
}
