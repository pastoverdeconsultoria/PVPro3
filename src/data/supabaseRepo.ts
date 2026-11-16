import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LotEvent } from '../lib/lots/types';
import {
  COLS,
  eventToPayload,
  jsonToNotebookContext,
  lotToPayload,
  moduleToArgs,
  newFarmToArgs,
  notebookReportToPayload,
  paddockPatchToRow,
  rainToPayload,
  reportPatchToRow,
  rowToComposition,
  rowToEvent,
  rowToFarm,
  rowToLot,
  rowToModule,
  rowToPaddock,
  rowToRain,
  rowToReport,
  rowToWaterPoint,
} from './rows';
import { OFFLINE_MESSAGE, RepoError, type Auth, type FarmData, type NotebookApi, type Repo, type User } from './types';

/** Espera máxima pela resposta do servidor (CLAUDE.md: 8 s), para a cópia salva poder entrar. */
export const TIMEOUT_MS = 8000;
/** A abertura de fazenda envia o mapa inteiro; em sinal fraco o envio sozinho passa de 8 s. */
const UPLOAD_TIMEOUT_MS = 45_000;
/** O PostgREST corta a resposta em 1000 linhas sem avisar. */
const PAGE = 1000;



/**
 * `fetch` com limite de tempo até o servidor começar a responder. O relógio para
 * quando chega o cabeçalho; o corpo (mapa grande em sinal fraco) pode demorar mais.
 */
function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const limit = url.includes('/rpc/create_farm') ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS;
  const ctrl = new AbortController();
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), limit);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// biome-ignore lint: erros do Supabase chegam em formatos variados
function toRepoError(e: any, doing: string): RepoError {
  if (e instanceof RepoError) return e;
  const message = String(e?.message ?? e ?? '');
  const network =
    e?.name === 'AbortError' ||
    e?.name === 'TypeError' ||
    /abort|failed to fetch|networkerror|load failed|fetch failed/i.test(message);
  if (network) return new RepoError(OFFLINE_MESSAGE, true);
  if (e?.code === '42501' && /row-level security|permission denied/i.test(message)) {
    return new RepoError('Sua conta não tem acesso a essa fazenda.');
  }
  // Recusas escritas pelas funções do banco já vêm em português, prontas para a tela.
  if (message && ['22023', '42501', '53400'].includes(e?.code)) return new RepoError(message);
  if (e?.code === 'PGRST202' || e?.code === '42P01' || e?.code === 'PGRST205') {
    return new RepoError('O banco ainda não foi preparado: falta rodar o arquivo de criação das tabelas no Supabase.', false, true);
  }
  return new RepoError(message ? `Não deu para ${doing}: ${message}` : `Não deu para ${doing}.`);
}

function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme o e-mail pelo link que chegou na sua caixa de entrada e entre de novo.';
  if (/already registered|already been registered/i.test(message)) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (/password should be at least|weak password/i.test(message)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(message)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  if (/signups? not allowed|signup is disabled/i.test(message)) return 'A criação de contas está desligada neste projeto.';
  if (/unable to validate email|invalid email|invalid format/i.test(message)) return 'E-mail inválido.';
  return message;
}

export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: timedFetch },
  });
}

// biome-ignore lint: o cliente não tem tipos gerados do banco
type Query = any;

/** Lê todas as linhas em páginas de 1000, com ordenação estável dada por quem chama. */
async function fetchAll(make: () => Query, doing: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw toRepoError(error, doing);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export function createSupabaseRepo(client: SupabaseClient): Repo {
  const run = async <T>(doing: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw toRepoError(e, doing);
    }
  };
  const check = (error: unknown, doing: string) => {
    if (error) throw toRepoError(error, doing);
  };

  return {
    listFarms: () =>
      run('ler as fazendas', async () => {
        const rows = await fetchAll(
          () => client.from('farms').select(COLS.farms).is('deleted_at', null).order('name').order('id'),
          'ler as fazendas',
        );
        return rows.map(rowToFarm);
      }),

    loadFarm: (farmId) =>
      run('ler a fazenda', async (): Promise<FarmData> => {
        const doing = 'ler a fazenda';
        const live = (table: keyof typeof COLS) =>
          client.from(table).select(COLS[table]).eq('farm_id', farmId).is('deleted_at', null);
        // As tabelas do caderno chegam numa migração posterior. Enquanto ela não for
        // rodada, a fazenda abre normalmente, só sem caderno e sem chuva.
        let notebookReady = true;
        const optional = (rows: Promise<Record<string, unknown>[]>) =>
          rows.catch((e) => {
            if (!(e instanceof RepoError) || !e.schemaMissing) throw e;
            notebookReady = false;
            return [] as Record<string, unknown>[];
          });
        const [farm, paddocks, water, lots, modules, compositions, events, reports, rain] = await Promise.all([
          client.from('farms').select(COLS.farms).eq('id', farmId).maybeSingle(),
          fetchAll(() => live('paddocks').order('sort').order('id'), doing),
          fetchAll(() => live('water_points').order('id'), doing),
          // Lote apagado vem junto, para poder ser restaurado.
          fetchAll(() => client.from('lots').select(COLS.lots).eq('farm_id', farmId).order('id'), doing),
          fetchAll(() => live('modules').order('created_at').order('id'), doing),
          fetchAll(() => live('module_compositions').order('valid_from').order('id'), doing),
          // Registro apagado também vem, para poder ser desfeito. O cálculo ignora.
          fetchAll(
            () => client.from('lot_events').select(COLS.lot_events).eq('farm_id', farmId).order('event_date').order('id'),
            doing,
          ),
          optional(fetchAll(() => live('field_reports').order('created_at').order('id'), doing)),
          optional(fetchAll(() => live('rain_records').order('rain_date').order('id'), doing)),
        ]);
        check(farm.error, doing);
        if (!farm.data) throw new RepoError('Fazenda não encontrada ou sua conta não tem acesso a ela.');
        return {
          farm: rowToFarm(farm.data),
          paddocks: paddocks.map(rowToPaddock),
          waterPoints: water.map(rowToWaterPoint),
          lots: lots.map(rowToLot),
          modules: modules.map(rowToModule),
          compositions: compositions.map(rowToComposition),
          events: events.map(rowToEvent),
          reports: reports.map(rowToReport),
          rain: rain.map(rowToRain),
          notebookReady,
        };
      }),

    createFarm: (input) =>
      run('abrir a fazenda', async () => {
        const { error } = await client.rpc('create_farm', newFarmToArgs(input));
        check(error, 'abrir a fazenda');
      }),

    updatePaddock: (paddockId, patch) =>
      run('alterar o piquete', async () => {
        const { error } = await client.from('paddocks').update(paddockPatchToRow(patch)).eq('id', paddockId);
        check(error, 'alterar o piquete');
      }),

    saveModule: (module, composition) =>
      run('gravar o módulo', async () => {
        const { error } = await client.rpc('save_module', moduleToArgs(module, composition));
        check(error, 'gravar o módulo');
      }),

    setModuleDeleted: (moduleId, deletedAt) =>
      run('excluir o módulo', async () => {
        const { error } = await client.from('modules').update({ deleted_at: deletedAt }).eq('id', moduleId);
        check(error, 'excluir o módulo');
      }),

    createLot: (lot, events) =>
      run('criar o lote', async (): Promise<LotEvent[]> => {
        const { data, error } = await client.rpc('create_lot', {
          p_lot: lotToPayload(lot),
          p_events: events.map((e) => eventToPayload(lot.farmId, e)),
        });
        check(error, 'criar o lote');
        return ((data as Record<string, unknown>[] | null) ?? []).map(rowToEvent);
      }),

    recordEvents: (farmId, events) =>
      run('gravar o registro', async (): Promise<LotEvent[]> => {
        const { data, error } = await client.rpc('record_lot_events', {
          p_events: events.map((e) => eventToPayload(farmId, e)),
        });
        check(error, 'gravar o registro');
        return ((data as Record<string, unknown>[] | null) ?? []).map(rowToEvent);
      }),

    setEventsDeleted: (eventIds, deletedAt) =>
      run('alterar o registro', async () => {
        // Uma instrução só: saída e entrada ligadas mudam juntas ou não mudam.
        const { error } = await client.from('lot_events').update({ deleted_at: deletedAt }).in('id', eventIds);
        check(error, 'alterar o registro');
      }),

    setLotDeleted: (lotId, deletedAt) =>
      run('alterar o lote', async () => {
        const { error } = await client.from('lots').update({ deleted_at: deletedAt }).eq('id', lotId);
        check(error, 'alterar o lote');
      }),

    listReports: (farmId) =>
      run('ler o caderno', async () => {
        const rows = await fetchAll(
          () => client.from('field_reports').select(COLS.field_reports).eq('farm_id', farmId).is('deleted_at', null).order('created_at').order('id'),
          'ler o caderno',
        );
        return rows.map(rowToReport);
      }),

    updateReport: (reportId, patch) =>
      run('alterar o relato', async () => {
        const { error } = await client.from('field_reports').update(reportPatchToRow(patch)).eq('id', reportId);
        check(error, 'alterar o relato');
      }),

    setReportStatus: (reportId, status) =>
      run('alterar o relato', async () => {
        const { error } = await client.from('field_reports').update({ status }).eq('id', reportId);
        check(error, 'alterar o relato');
      }),

    launchMoveReport: (reportId, farmId, events) =>
      run('lançar a mudança', async (): Promise<LotEvent[]> => {
        const { data, error } = await client.rpc('launch_move_report', {
          p_report: reportId,
          p_events: events.map((e) => eventToPayload(farmId, e)),
        });
        check(error, 'lançar a mudança');
        return ((data as Record<string, unknown>[] | null) ?? []).map(rowToEvent);
      }),

    recordRain: (farmId, rain, options) =>
      run('registrar a chuva', async () => {
        const { data, error } = await client.rpc('record_rain', {
          p_rain: rainToPayload(farmId, rain),
          p_replace: options.replace,
          p_report: options.reportId ?? null,
        });
        check(error, 'registrar a chuva');
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new RepoError('Não deu para registrar a chuva.');
        return rowToRain(row);
      }),

    setRainDeleted: (rainId, deletedAt) =>
      run('alterar a chuva', async () => {
        const { error } = await client.from('rain_records').update({ deleted_at: deletedAt }).eq('id', rainId);
        check(error, 'alterar a chuva');
      }),

    rotateShareToken: (farmId) =>
      run('trocar o link', async () => {
        const { data, error } = await client.rpc('rotate_share_token', { p_farm: farmId });
        check(error, 'trocar o link');
        return String(data);
      }),
  };
}

/** Acesso do link público do caderno. Funciona sem login: as funções conferem o token. */
export function createSupabaseNotebook(client: SupabaseClient): NotebookApi {
  return {
    context: async (token) => {
      try {
        const { data, error } = await client.rpc('notebook_context', { p_token: token });
        if (error) throw error;
        return jsonToNotebookContext(data);
      } catch (e) {
        throw toRepoError(e, 'abrir o caderno');
      }
    },
    submit: async (token, report) => {
      try {
        const { error } = await client.rpc('submit_field_report', { p_token: token, p_report: notebookReportToPayload(report) });
        if (error) throw error;
      } catch (e) {
        throw toRepoError(e, 'enviar o relato');
      }
    },
  };
}

export function createSupabaseAuth(client: SupabaseClient): Auth {
  const toUser = (u: { id: string; email?: string | null } | null | undefined): User | null =>
    u ? { id: u.id, email: u.email ?? '' } : null;

  return {
    // `getSession` lê do aparelho, sem rede: quem já entrou continua dentro sem sinal.
    currentUser: async () => toUser((await client.auth.getSession()).data.session?.user),

    onChange: (listener) => {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },

    signIn: async (email, password) => {
      try {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } catch (e) {
        const err = toRepoError(e, 'entrar');
        throw err.offline ? err : new RepoError(authMessage(String((e as Error)?.message ?? '')));
      }
    },

    signUp: async (email, password) => {
      try {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      } catch (e) {
        const err = toRepoError(e, 'criar a conta');
        throw err.offline ? err : new RepoError(authMessage(String((e as Error)?.message ?? '')));
      }
    },

    signOut: async () => {
      // `local`: sai neste aparelho mesmo sem sinal.
      await client.auth.signOut({ scope: 'local' });
    },
  };
}
