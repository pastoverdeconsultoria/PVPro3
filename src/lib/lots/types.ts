import type { IsoDate } from './dates';

interface EventBase {
  id: string;
  lotId: string;
  date: IsoDate;
  /**
   * Ordem de gravação, dada pelo servidor. Desempata registros do mesmo dia.
   * Registro ainda não sincronizado (fila offline) não tem `seq` e conta como o
   * mais recente do dia, na ordem em que aparece na lista.
   */
  seq?: number;
  /** Apagar é suave: registro com `deletedAt` fica no banco e sai de todo cálculo. */
  deletedAt?: string | null;
  /** Registros que nasceram juntos (saída e entrada de uma mudança) e são apagados juntos. */
  link?: string | null;
  note?: string;
}

/**
 * Registro do histórico de um lote. Os nomes separam animais entrando e saindo
 * do lote (compra, venda, morte) do lote entrando e saindo de um piquete.
 */
export type LotEvent =
  | (EventBase & { type: 'inicio'; heads: number; weightKg: number; category: string })
  | (EventBase & { type: 'animais_entrada' | 'transf_in'; heads: number; weightKg?: number; reason?: string })
  | (EventBase & { type: 'animais_saida' | 'transf_out'; heads: number; reason?: string })
  | (EventBase & { type: 'pesagem'; weightKg: number; headsWeighed?: number })
  | (EventBase & { type: 'categoria'; category: string })
  | (EventBase & { type: 'suplemento'; pctPv: number })
  | (EventBase & { type: 'piquete_entrada'; paddockId: string })
  | (EventBase & { type: 'piquete_saida'; paddockId: string });

/** Estado do lote ao fim de um dia. */
export interface LotState {
  date: IsoDate;
  heads: number;
  weightKg: number;
  category: string;
  /** Suplemento em % do peso vivo por dia. */
  supplPct: number;
}

/** Período contínuo de um lote num piquete. `end` nulo: o lote ainda está lá. */
export interface Stay {
  lotId: string;
  paddockId: string;
  start: IsoDate;
  end: IsoDate | null;
}

/**
 * Onde o lote está, sempre deduzido do histórico. São situações diferentes e a
 * tela precisa dizer qual é (CLAUDE.md, invariante 9).
 */
export type LotLocation =
  | { kind: 'sem_movimentacao' }
  | { kind: 'no_piquete'; paddockId: string; since: IsoDate }
  | { kind: 'fora'; since: IsoDate; lastPaddockId: string }
  | { kind: 'sem_animais'; since: IsoDate };

/** Inconsistência no histórico. Qualquer uma bloqueia a gravação de uma mudança. */
export type Problem =
  | { kind: 'sem_formacao' }
  | { kind: 'formacao_duplicada'; date: IsoDate }
  | { kind: 'antes_da_formacao'; formationDate: IsoDate }
  | { kind: 'cabecas_negativas'; date: IsoDate }
  | { kind: 'saida_sem_entrada'; date: IsoDate }
  | { kind: 'entrada_sem_saida'; date: IsoDate }
  | { kind: 'saida_de_outro_piquete'; date: IsoDate };

export interface LotDerived {
  lotId: string;
  formationDate: IsoDate | null;
  /** Um estado por dia com registro, em ordem. */
  timeline: LotState[];
  /** Estado mais recente; nulo se o lote não tem registro válido. */
  current: LotState | null;
  stays: Stay[];
  location: LotLocation;
  problems: Problem[];
}
