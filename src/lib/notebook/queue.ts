import { RepoError, type NotebookApi, type NotebookContext, type NotebookReport } from '../../data/types';

// Fila do caderno no aparelho do vaqueiro. O relato é guardado antes de qualquer
// tentativa de envio: sem sinal ele espera aqui e vai sozinho quando o sinal
// volta. O servidor ignora reenvio do mesmo id, então tentar de novo não duplica.

export interface QueuedReport {
  report: NotebookReport;
  /** `recusado`: o servidor respondeu que não aceita (data errada, lote que não existe mais). Não tenta de novo. */
  state: 'pendente' | 'recusado';
  error?: string;
}

export interface NotebookState {
  /** Última lista de piquetes e lotes recebida, para o formulário abrir sem sinal. */
  context: NotebookContext | null;
  queue: QueuedReport[];
  /** Últimos relatos entregues, para quem relatou conferir. */
  sent: NotebookReport[];
  /** Nome de quem relata, lembrado entre um relato e outro. */
  reporter: string;
}

export const SENT_KEPT = 12;

export function emptyNotebookState(): NotebookState {
  return { context: null, queue: [], sent: [], reporter: '' };
}

export interface NotebookStorage {
  load(token: string): NotebookState;
  save(token: string, state: NotebookState): void;
}

const key = (token: string) => `pvpro3:caderno:${token}`;

/** Guarda a fila no aparelho. Se o aparelho não deixar gravar, o relato ainda vai enquanto a tela estiver aberta. */
export const localNotebookStorage: NotebookStorage = {
  load(token) {
    try {
      const raw = localStorage.getItem(key(token));
      return raw ? { ...emptyNotebookState(), ...(JSON.parse(raw) as Partial<NotebookState>) } : emptyNotebookState();
    } catch {
      return emptyNotebookState();
    }
  },
  save(token, state) {
    try {
      localStorage.setItem(key(token), JSON.stringify(state));
    } catch {
      /* sem espaço: segue só em memória */
    }
  },
};

export function enqueue(state: NotebookState, report: NotebookReport): NotebookState {
  return {
    ...state,
    reporter: report.reporter ?? state.reporter,
    queue: [...state.queue, { report, state: 'pendente' }],
  };
}

export function dropQueued(state: NotebookState, reportId: string): NotebookState {
  return { ...state, queue: state.queue.filter((q) => q.report.id !== reportId) };
}

export const pendingCount = (state: NotebookState) => state.queue.filter((q) => q.state === 'pendente').length;

/**
 * Envia os relatos pendentes na ordem em que foram feitos (duas mudanças do
 * mesmo lote precisam chegar na ordem). Falta de sinal para o envio ali mesmo e
 * deixa o resto na fila. Recusa do servidor marca só aquele relato e segue.
 */
export async function syncQueue(state: NotebookState, api: NotebookApi, token: string): Promise<NotebookState> {
  let queue = state.queue;
  let sent = state.sent;
  for (const item of state.queue) {
    if (item.state !== 'pendente') continue;
    try {
      await api.submit(token, item.report);
      queue = queue.filter((q) => q.report.id !== item.report.id);
      sent = [item.report, ...sent].slice(0, SENT_KEPT);
    } catch (e) {
      if (e instanceof RepoError && !e.offline) {
        queue = queue.map((q) => (q.report.id === item.report.id ? { ...q, state: 'recusado', error: e.message } : q));
        continue;
      }
      break;
    }
  }
  return { ...state, queue, sent };
}

/** Atualiza a lista de piquetes e lotes guardada. Devolve `invalid` quando o link não vale mais. */
export async function refreshContext(
  state: NotebookState,
  api: NotebookApi,
  token: string,
): Promise<{ state: NotebookState; invalid: boolean; offline: boolean; /** O banco ainda não tem o caderno (falta rodar a migração). */ notReady?: boolean }> {
  try {
    const context = await api.context(token);
    if (!context) return { state, invalid: true, offline: false };
    return { state: { ...state, context }, invalid: false, offline: false };
  } catch (e) {
    // Função ausente no banco não é falta de sinal: o caderno ainda não foi ligado.
    if (e instanceof RepoError && e.schemaMissing) return { state, invalid: false, offline: false, notReady: true };
    return { state, invalid: false, offline: true };
  }
}
