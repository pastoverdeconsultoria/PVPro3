import { createStore, type StoreApi } from 'zustand/vanilla';
import { cache } from '../data/cache';
import {
  RepoError,
  type Auth,
  type Farm,
  type FarmData,
  type FarmMember,
  type Lot,
  type Module,
  type NewFarm,
  type PaddockPatch,
  type PendingOp,
  type RainRecord,
  type Repo,
  type ReportPatch,
  type User,
} from '../data/types';
import { climateCache, type ClimateApi, type ClimateSeries } from '../lib/climate/openMeteo';
import { checkComposition } from '../lib/farm/modules';
import { namesToClean } from '../lib/farm/names';
import { checkChange, planMove, planRemoval, planRestore, type Result } from '../lib/lots/changes';
import { addDays, formatBr, isIsoDate, todayLocal, type IsoDate } from '../lib/lots/dates';
import { deriveLot, orderEvents, stateAt } from '../lib/lots/deriveLot';
import type { LotEvent } from '../lib/lots/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Registro novo como a tela informa; id, lote e `seq` são preenchidos na gravação. */
export type EventDraft = DistributiveOmit<LotEvent, 'id' | 'lotId' | 'seq' | 'deletedAt' | 'link'>;

export interface NewLotInput {
  name: string;
  date: IsoDate;
  heads: number;
  weightKg: number;
  category: string;
  /** O peso informado veio de balança: grava também uma pesagem na data da formação. */
  weighed: boolean;
}

export interface AppState {
  phase: 'starting' | 'signedOut' | 'signedIn';
  user: User | null;
  farms: Farm[];
  /** A lista de fazendas já foi lida (do servidor ou da cópia do aparelho). */
  farmsReady: boolean;
  farmId: string | null;
  data: FarmData | null;
  loading: boolean;
  loadError: string | null;
  /** Quando os dados na tela vêm da cópia do aparelho: data e hora em que foi salva. */
  staleSince: string | null;

  /** Clima do centroide da fazenda aberta (Open-Meteo). Null enquanto não foi buscado. */
  climate: ClimateSeries | null;
  climateState: 'idle' | 'loading' | 'ready' | 'error';
  climateError: string | null;
  /** O clima na tela é a cópia do aparelho, porque a busca falhou. */
  climateStale: boolean;
  /** Na projeção, usar o M calibrado (quando existe) em vez do de referência. */
  useCalibratedM: boolean;
  /** Quem tem acesso à fazenda aberta. Null enquanto não foi lido. */
  members: FarmMember[] | null;
  /** Registros feitos sem sinal, guardados no aparelho, esperando envio. */
  outbox: PendingOp[];
  /** Aviso quando um registro guardado sem sinal foi recusado pelo servidor. */
  outboxError: string | null;

  init(): Promise<void>;
  signIn(email: string, password: string): Promise<Result<void>>;
  signUp(email: string, password: string): Promise<Result<{ needsConfirmation: boolean }>>;
  signOut(): Promise<void>;
  loadFarms(): Promise<void>;
  openFarm(farmId: string): Promise<void>;
  closeFarm(): void;
  refresh(): Promise<void>;

  createFarm(input: NewFarm): Promise<Result<void>>;
  updatePaddock(paddockId: string, patch: PaddockPatch): Promise<Result<void>>;
  /** Tira a área grudada no nome dos piquetes ("A1 — 15.7 ha" vira "A1"). Devolve quantos mudaram. */
  cleanPaddockNames(): Promise<Result<number>>;
  saveModule(module: Module, composition?: { validFrom: IsoDate; paddockIds: string[] }): Promise<Result<void>>;
  deleteModule(moduleId: string): Promise<Result<void>>;
  createLot(input: NewLotInput): Promise<Result<void>>;
  moveLot(lotId: string, toPaddockId: string, date: IsoDate): Promise<Result<void>>;
  addEvent(lotId: string, draft: EventDraft): Promise<Result<void>>;
  /** Tira animais de um lote e põe em outro, num registro só (saída e entrada ligadas). */
  transferAnimals(fromLotId: string, toLotId: string, heads: number, date: IsoDate): Promise<Result<void>>;
  /**
   * Corrige a data de um registro. O registro antigo é apagado (de forma suave) e
   * um novo entra com a data certa; numa mudança de piquete ou transferência, as
   * duas pontas mudam juntas. Tudo é recalculado e conferido antes de gravar.
   */
  changeEventDate(lotId: string, eventId: string, date: IsoDate): Promise<Result<void>>;
  removeEvent(lotId: string, eventId: string): Promise<Result<void>>;
  restoreEvent(lotId: string, eventId: string): Promise<Result<void>>;
  deleteLot(lotId: string): Promise<Result<void>>;
  restoreLot(lotId: string): Promise<Result<void>>;

  /** Confere se chegou relato novo no caderno, sem reler a fazenda inteira. Falha em silêncio. */
  refreshReports(): Promise<void>;
  updateReport(reportId: string, patch: ReportPatch): Promise<Result<void>>;
  discardReport(reportId: string): Promise<Result<void>>;
  reopenReport(reportId: string): Promise<Result<void>>;
  /** Lança um relato de mudança de gado como registro oficial do lote. */
  launchMoveReport(reportId: string): Promise<Result<void>>;
  /** Lança um relato de chuva. `substituir` troca o que já havia no dia; `somar` acrescenta. */
  launchRainReport(reportId: string, mode: RainMode): Promise<Result<void>>;
  /** Registro de chuva feito pelo próprio consultor. */
  addRain(input: { date: IsoDate; mm: number; note?: string }, mode: RainMode): Promise<Result<void>>;
  removeRain(rainId: string): Promise<Result<void>>;
  rotateShareToken(): Promise<Result<void>>;

  /** Busca o clima do centroide. Usa a cópia do aparelho se ela é de hoje e tem menos de 6 h. */
  loadClimate(force?: boolean): Promise<void>;
  setUseCalibratedM(value: boolean): void;
  addFertilization(input: { paddockId: string; date: IsoDate; nKgHa: number; note?: string }): Promise<Result<void>>;
  removeFertilization(fertilizationId: string): Promise<Result<void>>;
  renameFarm(input: { name: string; municipality: string }): Promise<Result<void>>;
  loadMembers(): Promise<Result<void>>;
  addMember(email: string): Promise<Result<void>>;
  removeMember(userId: string): Promise<Result<void>>;
  /** Envia o que ficou guardado sem sinal. Chamado ao abrir, quando o sinal volta e de tempos em tempos. */
  flushOutbox(): Promise<void>;
  dismissOutboxError(): void;
}

export type RainMode = 'somar' | 'substituir';

export interface StoreDeps {
  repo: Repo;
  auth: Auth;
  /** Fonte de clima. Sem ela, as telas de clima e projeção avisam que não há dado. */
  climate?: ClimateApi;
  /** Relógio, trocável nos testes. */
  now?: () => Date;
}

const OK: Result<void> = { ok: true, value: undefined };
const fail = (error: string): Result<never> => ({ ok: false, error });
const message = (e: unknown, fallback: string) => (e instanceof RepoError ? e.message : fallback);

export type AppStore = StoreApi<AppState>;

/** A cópia do clima vale por 6 horas dentro do mesmo dia. */
const CLIMATE_MAX_AGE_MS = 6 * 3600_000;
const NO_CLIMATE = { climate: null, climateState: 'idle' as const, climateError: null, climateStale: false, members: null, outbox: [] as PendingOp[], outboxError: null };

/** Efeito de um registro guardado sem sinal sobre os dados da tela. Aplicar duas vezes não duplica. */
function applyOp(d: FarmData, op: PendingOp): FarmData {
  if (op.kind === 'rain') {
    const rain = d.rain.filter((r) => r.id !== op.rain.id && !(op.replace && r.date === op.rain.date));
    return { ...d, rain: [...rain, { ...op.rain, reportId: null }] };
  }
  const have = new Set(d.events.map((e) => e.id));
  const events = [...d.events, ...op.events.filter((e) => !have.has(e.id))];
  if (op.kind === 'events') return { ...d, events };
  return { ...d, events, lots: d.lots.some((l) => l.id === op.lot.id) ? d.lots : [...d.lots, op.lot] };
}

/** Desfaz o efeito de um registro que o servidor recusou. */
function undoOp(d: FarmData, op: PendingOp): FarmData {
  if (op.kind === 'rain') return { ...d, rain: d.rain.filter((r) => r.id !== op.rain.id) };
  const ids = new Set(op.events.map((e) => e.id));
  const events = d.events.filter((e) => !ids.has(e.id));
  return op.kind === 'events' ? { ...d, events } : { ...d, events, lots: d.lots.filter((l) => l.id !== op.lot.id) };
}

export function createAppStore({ repo, auth, climate: climateApi, now = () => new Date() }: StoreDeps): AppStore {
  const today = () => todayLocal(now());

  return createStore<AppState>()((set, get) => {
    /** Troca os dados da fazenda aberta e atualiza a cópia do aparelho. */
    const patchData = (fn: (d: FarmData) => FarmData) => {
      const { data, user } = get();
      if (!data) return;
      const next = fn(data);
      set({ data: next });
      if (user) cache.saveFarm(user.id, next);
    };

    /** Roda uma gravação e devolve o erro em texto, sem deixar exceção escapar para a tela. */
    const attempt = async (doing: string, fn: () => Promise<void>): Promise<Result<void>> => {
      try {
        await fn();
        return OK;
      } catch (e) {
        return fail(message(e, `Não deu para ${doing}.`));
      }
    };

    const lotContext = (lotId: string) => {
      const data = get().data;
      const lot = data?.lots.find((l) => l.id === lotId && !l.deletedAt);
      if (!data || !lot) return null;
      return { data, lot, events: data.events.filter((e) => e.lotId === lotId) };
    };

    /** Junta os registros gravados (já com `seq`) ao histórico em memória. */
    const mergeEvents = (saved: LotEvent[]) =>
      patchData((d) => {
        const ids = new Set(saved.map((e) => e.id));
        return { ...d, events: [...d.events.filter((e) => !ids.has(e.id)), ...saved] };
      });

    const setDeletedLocally = (ids: string[], deletedAt: string | null) =>
      patchData((d) => ({ ...d, events: d.events.map((e) => (ids.includes(e.id) ? { ...e, deletedAt } : e)) }));

    const checkRain = (date: IsoDate, mm: number): string | null => {
      if (!isIsoDate(date)) return 'Informe a data.';
      if (date > today()) return 'A data não pode ser depois de hoje.';
      if (!(mm >= 0) || mm > 500) return 'Chuva: informe os milímetros, de 0 a 500.';
      return null;
    };

    /** Põe a leitura nova na lista em memória, com a mesma regra do banco para substituir. */
    const mergeRain = (saved: RainRecord, mode: RainMode) =>
      patchData((d) => ({
        ...d,
        rain: [...d.rain.filter((r) => r.id !== saved.id && !(mode === 'substituir' && r.date === saved.date)), saved],
      }));

    const setReportStatusLocally = (reportId: string, status: 'novo' | 'lancado' | 'descartado') =>
      patchData((d) => ({ ...d, reports: d.reports.map((r) => (r.id === reportId ? { ...r, status } : r)) }));

    const newReport = (reportId: string) => {
      const data = get().data;
      const report = data?.reports.find((r) => r.id === reportId);
      if (!data || !report) return null;
      return { data, report };
    };

    /**
     * Registros de OUTROS lotes ligados a este (a outra ponta de uma transferência).
     * Eles mudam junto, e o histórico de cada lote afetado tem de continuar
     * consistente. Devolve os ids a alterar, ou o erro.
     */
    const linkedInOtherLots = (lotId: string, eventId: string, deletedAt: string | null): Result<string[]> => {
      const data = get().data;
      const target = data?.events.find((e) => e.id === eventId);
      if (!data || !target?.link) return { ok: true, value: [] };
      const partners = data.events.filter((e) => e.link === target.link && e.lotId !== lotId && (deletedAt ? !e.deletedAt : !!e.deletedAt));
      for (const otherLot of new Set(partners.map((e) => e.lotId))) {
        const ids = new Set(partners.filter((e) => e.lotId === otherLot).map((e) => e.id));
        const next = data.events.filter((e) => e.lotId === otherLot).map((e) => (ids.has(e.id) ? { ...e, deletedAt } : e));
        const name = data.lots.find((l) => l.id === otherLot)?.name;
        const check = checkChange(otherLot, next, name);
        if (!check.ok) return check;
      }
      return { ok: true, value: partners.map((e) => e.id) };
    };

    const persistOutbox = (outbox: PendingOp[]) => {
      const { user, farmId } = get();
      set({ outbox });
      if (user && farmId) cache.saveOutbox(user.id, farmId, outbox);
    };

    /** Manda um registro ao servidor e põe na tela o que ele devolveu (com `seq`). */
    const sendOp = async (farmId: string, op: PendingOp) => {
      if (op.kind === 'events') mergeEvents(await repo.recordEvents(farmId, op.events));
      else if (op.kind === 'createLot') {
        const saved = await repo.createLot(op.lot, op.events);
        patchData((d) => applyOp(d, { ...op, events: [] }));
        mergeEvents(saved.length ? saved : op.events);
      } else mergeRain(await repo.recordRain(farmId, op.rain, { replace: op.replace }), op.replace ? 'substituir' : 'somar');
    };

    let flushing: Promise<void> | null = null;

    /**
     * Ação de campo: tenta gravar; sem sinal, guarda no aparelho, mostra na tela
     * como se tivesse gravado e envia depois, na mesma ordem. Se já há registro
     * esperando, o novo entra atrás dele, para a ordem não se inverter.
     */
    const runOp = async (op: PendingOp, failText: string): Promise<Result<void>> => {
      const farmId = get().farmId;
      if (!farmId) return fail('Nenhuma fazenda aberta.');
      if (get().outbox.length) await get().flushOutbox();
      if (!get().outbox.length) {
        try {
          await sendOp(farmId, op);
          return OK;
        } catch (e) {
          if (!(e instanceof RepoError && e.offline)) return fail(message(e, failText));
        }
      }
      patchData((d) => applyOp(d, op));
      persistOutbox([...get().outbox, op]);
      return OK;
    };

    const applyUser = async (user: User | null) => {
      if (user?.id === get().user?.id && get().phase !== 'starting') return;
      if (!user) {
        set({ phase: 'signedOut', user: null, farms: [], farmsReady: false, farmId: null, data: null, loadError: null, staleSince: null, ...NO_CLIMATE });
        return;
      }
      set({ phase: 'signedIn', user, farms: [], farmsReady: false, farmId: null, data: null, loadError: null, staleSince: null, ...NO_CLIMATE });
      await get().loadFarms();
    };

    return {
      phase: 'starting',
      user: null,
      farms: [],
      farmsReady: false,
      farmId: null,
      data: null,
      loading: false,
      loadError: null,
      staleSince: null,
      ...NO_CLIMATE,
      useCalibratedM: true,

      async init() {
        auth.onChange((u) => void applyUser(u));
        await applyUser(await auth.currentUser());
      },

      async signIn(email, password) {
        try {
          await auth.signIn(email.trim(), password);
          await applyUser(await auth.currentUser());
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para entrar.'));
        }
      },

      async signUp(email, password) {
        try {
          const r = await auth.signUp(email.trim(), password);
          if (!r.needsConfirmation) await applyUser(await auth.currentUser());
          return { ok: true, value: r };
        } catch (e) {
          return fail(message(e, 'Não deu para criar a conta.'));
        }
      },

      async signOut() {
        const user = get().user;
        await auth.signOut();
        if (user) cache.clear(user.id);
        await applyUser(null);
      },

      async loadFarms() {
        const user = get().user;
        if (!user) return;
        set({ loading: true, loadError: null });
        let farms: Farm[];
        try {
          farms = await repo.listFarms();
          cache.saveFarms(user.id, farms);
        } catch (e) {
          const saved = e instanceof RepoError && e.offline ? cache.loadFarms(user.id) : null;
          if (!saved) {
            set({ loading: false, farmsReady: true, loadError: message(e, 'Não deu para ler as fazendas.') });
            return;
          }
          farms = saved.value;
        }
        if (get().user?.id !== user.id) return;
        set({ farms, farmsReady: true, loading: false });

        // Reabre a última fazenda usada; com uma fazenda só, abre direto.
        const last = cache.loadLastFarm(user.id);
        const pick = farms.find((f) => f.id === last) ?? (farms.length === 1 ? farms[0] : null);
        if (pick && !get().farmId) await get().openFarm(pick.id);
      },

      async openFarm(farmId) {
        const user = get().user;
        if (!user) return;
        const outbox = cache.loadOutbox(user.id, farmId);
        set({ farmId, data: null, loading: true, loadError: null, staleSince: null, ...NO_CLIMATE, outbox });
        cache.saveLastFarm(user.id, farmId);
        try {
          // O que foi feito sem sinal e ainda não chegou ao servidor continua na tela.
          const data = outbox.reduce(applyOp, await repo.loadFarm(farmId));
          if (get().farmId !== farmId) return;
          set({ data, loading: false });
          cache.saveFarm(user.id, data);
          if (outbox.length) void get().flushOutbox();
        } catch (e) {
          if (get().farmId !== farmId) return;
          const saved = e instanceof RepoError && e.offline ? cache.loadFarm(user.id, farmId) : null;
          // Cópia gravada por versão antiga do app pode não ter caderno nem chuva.
          if (saved) set({ data: { ...saved.value, reports: saved.value.reports ?? [], rain: saved.value.rain ?? [], fertilizations: saved.value.fertilizations ?? [] }, loading: false, staleSince: saved.savedAt });
          else set({ loading: false, loadError: message(e, 'Não deu para ler a fazenda.') });
        }
      },

      closeFarm() {
        const user = get().user;
        if (user) cache.saveLastFarm(user.id, null);
        set({ farmId: null, data: null, loadError: null, staleSince: null, ...NO_CLIMATE });
      },

      async refresh() {
        const { farmId, user } = get();
        if (!farmId || !user) return;
        set({ loading: true, loadError: null });
        try {
          const data = get().outbox.reduce(applyOp, await repo.loadFarm(farmId));
          if (get().farmId !== farmId) return;
          set({ data, loading: false, staleSince: null });
          cache.saveFarm(user.id, data);
        } catch (e) {
          if (get().farmId !== farmId) return;
          // Com dado na tela, falha de atualização não apaga o que já está sendo visto.
          if (get().data) set({ loading: false, staleSince: get().staleSince ?? new Date().toISOString() });
          else set({ loading: false, loadError: message(e, 'Não deu para ler a fazenda.') });
        }
      },

      async createFarm(input) {
        const user = get().user;
        const r = await attempt('abrir a fazenda', () => repo.createFarm(input));
        if (!r.ok || !user) return r;
        const farms = [...get().farms.filter((f) => f.id !== input.farm.id), input.farm].sort((a, b) =>
          a.name.localeCompare(b.name, 'pt-BR'),
        );
        cache.saveFarms(user.id, farms);
        set({ farms });
        await get().openFarm(input.farm.id);
        return OK;
      },

      async updatePaddock(paddockId, patch) {
        if (patch.name !== undefined && !patch.name.trim()) return fail('O piquete precisa de nome.');
        if (patch.initialLastExit) {
          if (!isIsoDate(patch.initialLastExit)) return fail('Data inválida.');
          if (patch.initialLastExit > today()) return fail('A data não pode ser depois de hoje.');
        }
        const clean = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) };
        const r = await attempt('alterar o piquete', () => repo.updatePaddock(paddockId, clean));
        if (r.ok) {
          patchData((d) => ({ ...d, paddocks: d.paddocks.map((p) => (p.id === paddockId ? { ...p, ...clean } : p)) }));
        }
        return r;
      },

      async cleanPaddockNames() {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        let done = 0;
        for (const change of namesToClean(data.paddocks)) {
          try {
            await repo.updatePaddock(change.id, { name: change.to });
          } catch (e) {
            return fail(`${done} nomes foram limpos antes de parar. ${message(e, 'Não deu para alterar o piquete.')}`);
          }
          patchData((d) => ({ ...d, paddocks: d.paddocks.map((p) => (p.id === change.id ? { ...p, name: change.to } : p)) }));
          done += 1;
        }
        return { ok: true, value: done };
      },

      async saveModule(module, composition) {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        const clean = { ...module, name: module.name.trim() };
        if (!clean.name) return fail('O módulo precisa de nome.');
        if (!Number.isInteger(clean.occupationDays) || clean.occupationDays < 1 || clean.occupationDays > 365) {
          return fail('Dias de ocupação: informe um número inteiro de 1 a 365.');
        }
        if (!(clean.mRef > 0) || clean.mRef > 250) return fail('M de referência: informe um valor entre 1 e 250.');
        if (composition) {
          if (!isIsoDate(composition.validFrom)) return fail('Informe a partir de quando a composição vale.');
          const name = (id: string) => data.paddocks.find((p) => p.id === id)?.name ?? 'Um piquete';
          const problem = checkComposition(clean, composition.paddockIds, composition.validFrom, data.modules, data.compositions, name);
          if (problem) return fail(problem);
        } else if (!data.modules.some((m) => m.id === clean.id)) {
          return fail('O módulo precisa de pelo menos um piquete.');
        }

        const r = await attempt('gravar o módulo', () => repo.saveModule(clean, composition));
        if (!r.ok) return r;
        patchData((d) => {
          const modules = d.modules.some((m) => m.id === clean.id)
            ? d.modules.map((m) => (m.id === clean.id ? clean : m))
            : [...d.modules, clean];
          if (!composition) return { ...d, modules };
          // Mesma regra do banco: a versão daquela data é substituída inteira.
          const kept = d.compositions.filter((c) => !(c.moduleId === clean.id && c.validFrom === composition.validFrom));
          const added = composition.paddockIds.map((paddockId, ord) => ({
            id: crypto.randomUUID(),
            moduleId: clean.id,
            paddockId,
            ord,
            validFrom: composition.validFrom,
          }));
          return { ...d, modules, compositions: [...kept, ...added] };
        });
        return OK;
      },

      async deleteModule(moduleId) {
        const r = await attempt('excluir o módulo', () => repo.setModuleDeleted(moduleId, now().toISOString()));
        if (r.ok) {
          patchData((d) => ({
            ...d,
            modules: d.modules.filter((m) => m.id !== moduleId),
            compositions: d.compositions.filter((c) => c.moduleId !== moduleId),
          }));
        }
        return r;
      },

      async createLot(input) {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        const name = input.name.trim();
        if (!name) return fail('O lote precisa de nome.');
        if (data.lots.some((l) => !l.deletedAt && l.name.toLowerCase() === name.toLowerCase())) {
          return fail(`Já existe um lote chamado ${name}.`);
        }
        if (!isIsoDate(input.date)) return fail('Informe a data de formação.');
        if (input.date > today()) return fail('A data não pode ser depois de hoje.');
        if (!Number.isInteger(input.heads) || input.heads <= 0) return fail('Informe o número de cabeças.');
        if (!(input.weightKg > 0) || input.weightKg > 1500) return fail('Informe o peso médio em kg.');
        if (!input.category.trim()) return fail('Escolha a categoria.');

        const lot: Lot = { id: crypto.randomUUID(), farmId: data.farm.id, name, deletedAt: null };
        const events: LotEvent[] = [
          { id: crypto.randomUUID(), lotId: lot.id, date: input.date, type: 'inicio', heads: input.heads, weightKg: input.weightKg, category: input.category },
        ];
        if (input.weighed) {
          events.push({ id: crypto.randomUUID(), lotId: lot.id, date: input.date, type: 'pesagem', weightKg: input.weightKg, headsWeighed: input.heads });
        }
        return runOp({ id: crypto.randomUUID(), kind: 'createLot', lot, events }, 'Não deu para criar o lote.');
      },

      async moveLot(lotId, toPaddockId, date) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        if (!ctx.data.paddocks.some((p) => p.id === toPaddockId)) return fail('Escolha o piquete de destino.');
        const plan = planMove({ events: ctx.events, lotId, lotName: ctx.lot.name, toPaddockId, date, today: today() });
        if (!plan.ok) return plan;
        // Saída e entrada vão na mesma chamada, nessa ordem (invariante 2).
        return runOp({ id: crypto.randomUUID(), kind: 'events', events: plan.value }, 'Não deu para gravar a mudança.');
      },

      async addEvent(lotId, draft) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        if (!isIsoDate(draft.date)) return fail('Informe a data.');
        if (draft.date > today()) return fail('A data não pode ser depois de hoje.');
        const formation = deriveLot(lotId, ctx.events).formationDate;
        if (formation && draft.date < formation) return fail(`${ctx.lot.name} foi formado em ${formatBr(formation)}.`);
        if ('heads' in draft && (!Number.isInteger(draft.heads) || draft.heads <= 0)) return fail('Informe o número de cabeças.');
        if ('weightKg' in draft && draft.weightKg != null && (!(draft.weightKg > 0) || draft.weightKg > 1500)) {
          return fail('Informe o peso em kg.');
        }
        if (draft.type === 'suplemento' && (!(draft.pctPv >= 0) || draft.pctPv > 2.5)) {
          return fail('Suplemento: informe de 0 a 2,5% do peso vivo.');
        }
        if (draft.type === 'categoria' && !draft.category.trim()) return fail('Escolha a categoria.');

        const event = { ...draft, id: crypto.randomUUID(), lotId } as LotEvent;
        const check = checkChange(lotId, [...ctx.events, event], ctx.lot.name);
        if (!check.ok) return check;
        return runOp({ id: crypto.randomUUID(), kind: 'events', events: [event] }, 'Não deu para gravar o registro.');
      },

      async transferAnimals(fromLotId, toLotId, heads, date) {
        const from = lotContext(fromLotId);
        const to = lotContext(toLotId);
        if (!from) return fail('Lote não encontrado.');
        if (!to || toLotId === fromLotId) return fail('Escolha o lote que recebe os animais.');
        if (!isIsoDate(date)) return fail('Informe a data.');
        if (date > today()) return fail('A data não pode ser depois de hoje.');
        if (!Number.isInteger(heads) || heads <= 0) return fail('Informe o número de cabeças.');
        for (const ctx of [from, to]) {
          const formation = deriveLot(ctx.lot.id, ctx.events).formationDate;
          if (formation && date < formation) return fail(`${ctx.lot.name} foi formado em ${formatBr(formation)}.`);
        }
        // Os animais chegam ao outro lote com o peso médio que tinham neste, na data.
        const state = stateAt(deriveLot(fromLotId, from.events), date);
        if (!state || state.heads < heads) return fail(`${from.lot.name} não tem ${heads} cabeças em ${formatBr(date)}.`);
        const link = crypto.randomUUID();
        const out: LotEvent = { id: crypto.randomUUID(), lotId: fromLotId, date, type: 'transf_out', heads, reason: `transferência para ${to.lot.name}`, link };
        const into: LotEvent = { id: crypto.randomUUID(), lotId: toLotId, date, type: 'transf_in', heads, weightKg: Number(state.weightKg.toFixed(2)), reason: `transferência de ${from.lot.name}`, link };
        const checkOut = checkChange(fromLotId, [...from.events, out], from.lot.name);
        if (!checkOut.ok) return checkOut;
        const checkIn = checkChange(toLotId, [...to.events, into], to.lot.name);
        if (!checkIn.ok) return checkIn;
        // Saída e entrada na mesma chamada: ou as duas, ou nenhuma.
        return runOp({ id: crypto.randomUUID(), kind: 'events', events: [out, into] }, 'Não deu para gravar a transferência.');
      },

      async changeEventDate(lotId, eventId, date) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        const target = ctx.events.find((e) => e.id === eventId && !e.deletedAt);
        if (!target) return fail('Registro não encontrado.');
        if (!isIsoDate(date)) return fail('Informe a data.');
        if (date > today()) return fail('A data não pode ser depois de hoje.');
        if (date === target.date) return OK;
        if (get().outbox.length) return fail('Há registros esperando sinal. Envie esses primeiro e depois corrija a data.');

        const data = ctx.data;
        // A mudança de piquete e a transferência têm duas pontas, que andam juntas e na mesma ordem.
        const group = orderEvents(target.link ? data.events.filter((e) => e.link === target.link) : [target]);
        const oldIds = new Set(group.map((e) => e.id));
        const link = target.link ? crypto.randomUUID() : null;
        const deletedAt = now().toISOString();
        const replacements = group.map((e) => {
          const { seq: _seq, ...rest } = e;
          return { ...rest, id: crypto.randomUUID(), date, deletedAt: null, link } as LotEvent;
        });
        for (const affected of new Set(group.map((e) => e.lotId))) {
          const next = [
            ...data.events.filter((e) => e.lotId === affected).map((e) => (oldIds.has(e.id) ? { ...e, deletedAt } : e)),
            ...replacements.filter((e) => e.lotId === affected),
          ];
          const check = checkChange(affected, next, data.lots.find((l) => l.id === affected)?.name);
          if (!check.ok) return check;
        }

        try {
          await repo.setEventsDeleted([...oldIds], deletedAt);
        } catch (e) {
          return fail(message(e, 'Não deu para corrigir a data.'));
        }
        try {
          const saved = await repo.recordEvents(data.farm.id, replacements);
          setDeletedLocally([...oldIds], deletedAt);
          mergeEvents(saved);
          return OK;
        } catch (e) {
          // O novo não entrou: devolve o antigo, para o registro não sumir.
          await repo.setEventsDeleted([...oldIds], null).catch(() => undefined);
          return fail(message(e, 'Não deu para corrigir a data.'));
        }
      },

      async removeEvent(lotId, eventId) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        const deletedAt = now().toISOString();
        const plan = planRemoval(lotId, ctx.events, eventId, deletedAt, ctx.lot.name);
        if (!plan.ok) return plan;
        const others = linkedInOtherLots(lotId, eventId, deletedAt);
        if (!others.ok) return others;
        const ids = [...plan.value.filter((e) => e.deletedAt === deletedAt).map((e) => e.id), ...others.value];
        const r = await attempt('apagar o registro', () => repo.setEventsDeleted(ids, deletedAt));
        if (r.ok) setDeletedLocally(ids, deletedAt);
        return r;
      },

      async restoreEvent(lotId, eventId) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        const plan = planRestore(lotId, ctx.events, eventId, ctx.lot.name);
        if (!plan.ok) return plan;
        const before = new Map(ctx.events.map((e) => [e.id, e.deletedAt]));
        const others = linkedInOtherLots(lotId, eventId, null);
        if (!others.ok) return others;
        const ids = [...plan.value.filter((e) => !e.deletedAt && before.get(e.id)).map((e) => e.id), ...others.value];
        const r = await attempt('desfazer a exclusão', () => repo.setEventsDeleted(ids, null));
        if (r.ok) setDeletedLocally(ids, null);
        return r;
      },

      async deleteLot(lotId) {
        const deletedAt = now().toISOString();
        const r = await attempt('excluir o lote', () => repo.setLotDeleted(lotId, deletedAt));
        if (r.ok) patchData((d) => ({ ...d, lots: d.lots.map((l) => (l.id === lotId ? { ...l, deletedAt } : l)) }));
        return r;
      },

      async restoreLot(lotId) {
        const data = get().data;
        const lot = data?.lots.find((l) => l.id === lotId);
        if (!data || !lot) return fail('Lote não encontrado.');
        if (data.lots.some((l) => !l.deletedAt && l.id !== lotId && l.name.toLowerCase() === lot.name.toLowerCase())) {
          return fail(`Já existe um lote chamado ${lot.name}.`);
        }
        const r = await attempt('restaurar o lote', () => repo.setLotDeleted(lotId, null));
        if (r.ok) patchData((d) => ({ ...d, lots: d.lots.map((l) => (l.id === lotId ? { ...l, deletedAt: null } : l)) }));
        return r;
      },

      async refreshReports() {
        const farmId = get().farmId;
        if (!farmId || !get().data || get().data?.notebookReady === false) return;
        try {
          const reports = await repo.listReports(farmId);
          if (get().farmId === farmId) patchData((d) => ({ ...d, reports }));
        } catch {
          // Sem sinal: fica com o que já tinha. A próxima conferência tenta de novo.
        }
      },

      async updateReport(reportId, patch) {
        const ctx = newReport(reportId);
        if (!ctx) return fail('Relato não encontrado.');
        if (ctx.report.status !== 'novo') return fail('Esse relato já foi lançado ou descartado.');
        if (patch.date !== undefined) {
          if (!isIsoDate(patch.date)) return fail('Informe a data.');
          if (patch.date > today()) return fail('A data não pode ser depois de hoje.');
        }
        if (patch.mm !== undefined && (patch.mm == null || !(patch.mm >= 0) || patch.mm > 500)) {
          return fail('Chuva: informe os milímetros, de 0 a 500.');
        }
        if (patch.lotId !== undefined && !ctx.data.lots.some((l) => l.id === patch.lotId && !l.deletedAt)) return fail('Escolha o lote.');
        if (patch.toPaddockId !== undefined && !ctx.data.paddocks.some((p) => p.id === patch.toPaddockId)) return fail('Escolha o piquete.');
        const r = await attempt('alterar o relato', () => repo.updateReport(reportId, patch));
        if (r.ok) patchData((d) => ({ ...d, reports: d.reports.map((x) => (x.id === reportId ? { ...x, ...patch } : x)) }));
        return r;
      },

      async discardReport(reportId) {
        const ctx = newReport(reportId);
        if (!ctx) return fail('Relato não encontrado.');
        if (ctx.report.status !== 'novo') return fail('Esse relato já foi lançado ou descartado.');
        const r = await attempt('descartar o relato', () => repo.setReportStatus(reportId, 'descartado'));
        if (r.ok) setReportStatusLocally(reportId, 'descartado');
        return r;
      },

      async reopenReport(reportId) {
        const ctx = newReport(reportId);
        if (!ctx) return fail('Relato não encontrado.');
        if (ctx.report.status !== 'descartado') return fail('Só relato descartado volta para novo.');
        const r = await attempt('reabrir o relato', () => repo.setReportStatus(reportId, 'novo'));
        if (r.ok) setReportStatusLocally(reportId, 'novo');
        return r;
      },

      async launchMoveReport(reportId) {
        const ctx = newReport(reportId);
        if (!ctx) return fail('Relato não encontrado.');
        const { report, data } = ctx;
        if (report.kind !== 'mudanca' || report.status !== 'novo') return fail('Esse relato já foi lançado ou descartado.');
        const lot = data.lots.find((l) => l.id === report.lotId && !l.deletedAt);
        if (!lot || !report.toPaddockId) return fail('O lote deste relato não existe mais. Edite o relato ou descarte.');
        // As mesmas regras de uma mudança feita pelo consultor (invariantes 2 e 3).
        const plan = planMove({
          events: data.events.filter((e) => e.lotId === lot.id),
          lotId: lot.id,
          lotName: lot.name,
          toPaddockId: report.toPaddockId,
          date: report.date,
          today: today(),
        });
        if (!plan.ok) return plan;
        try {
          mergeEvents(await repo.launchMoveReport(reportId, data.farm.id, plan.value));
          setReportStatusLocally(reportId, 'lancado');
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para lançar a mudança.'));
        }
      },

      async launchRainReport(reportId, mode) {
        const ctx = newReport(reportId);
        if (!ctx) return fail('Relato não encontrado.');
        const { report, data } = ctx;
        if (report.kind !== 'chuva' || report.status !== 'novo' || report.mm == null) return fail('Esse relato já foi lançado ou descartado.');
        const problem = checkRain(report.date, report.mm);
        if (problem) return fail(problem);
        const note = [report.reporter ? `relato de ${report.reporter}` : 'relato do caderno', report.note].filter(Boolean).join(': ');
        try {
          const saved = await repo.recordRain(
            data.farm.id,
            { id: crypto.randomUUID(), date: report.date, mm: report.mm, note },
            { replace: mode === 'substituir', reportId },
          );
          mergeRain(saved, mode);
          setReportStatusLocally(reportId, 'lancado');
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para lançar a chuva.'));
        }
      },

      async addRain(input, mode) {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        const problem = checkRain(input.date, input.mm);
        if (problem) return fail(problem);
        return runOp(
          { id: crypto.randomUUID(), kind: 'rain', rain: { id: crypto.randomUUID(), date: input.date, mm: input.mm, note: input.note?.trim() || null }, replace: mode === 'substituir' },
          'Não deu para registrar a chuva.',
        );
      },

      async removeRain(rainId) {
        const r = await attempt('apagar a chuva', () => repo.setRainDeleted(rainId, now().toISOString()));
        if (r.ok) patchData((d) => ({ ...d, rain: d.rain.filter((x) => x.id !== rainId) }));
        return r;
      },

      async rotateShareToken() {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        try {
          const shareToken = await repo.rotateShareToken(data.farm.id);
          patchData((d) => ({ ...d, farm: { ...d.farm, shareToken } }));
          set({ farms: get().farms.map((f) => (f.id === data.farm.id ? { ...f, shareToken } : f)) });
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para trocar o link.'));
        }
      },

      flushOutbox() {
        if (flushing) return flushing;
        const farmId = get().farmId;
        if (!farmId || !get().outbox.length || !get().data) return Promise.resolve();
        flushing = (async () => {
          let sent = 0;
          while (get().outbox.length && get().farmId === farmId) {
            const [op, ...rest] = get().outbox;
            try {
              await sendOp(farmId, op);
              sent += 1;
            } catch (e) {
              if (e instanceof RepoError && e.offline) break;
              // O servidor recusou: sai da fila e da tela, e o consultor é avisado.
              patchData((d) => undoOp(d, op));
              set({ outboxError: `Um registro feito sem sinal não foi aceito e foi desfeito: ${message(e, 'erro desconhecido')}` });
            }
            persistOutbox(rest);
          }
          // Releitura para ficar com o que o servidor guardou (ordem e `seq`).
          if (sent && get().farmId === farmId) await get().refresh();
        })().finally(() => {
          flushing = null;
        });
        return flushing;
      },

      dismissOutboxError() {
        set({ outboxError: null });
      },

      async loadClimate(force = false) {
        const data = get().data;
        const farmId = get().farmId;
        const c = data?.farm.centroid;
        if (!data || !c) {
          set({ climateState: 'error', climateError: 'Esta fazenda não tem centroide: sem ele não há como buscar o clima.' });
          return;
        }
        if (get().climateState === 'loading') return;
        const day = today();
        const cached = climateCache.load(c.lat, c.lon);
        const fresh = !!cached && cached.forecastFrom === addDays(day, 1) && now().getTime() - Date.parse(cached.fetchedAt) < CLIMATE_MAX_AGE_MS;
        if (cached && fresh && !force) {
          set({ climate: cached, climateState: 'ready', climateError: null, climateStale: false });
          return;
        }
        if (!climateApi) {
          set(cached ? { climate: cached, climateState: 'ready', climateStale: true } : { climateState: 'error', climateError: 'Fonte de clima não configurada.' });
          return;
        }
        set({ climateState: 'loading', climateError: null, ...(cached && !get().climate ? { climate: cached, climateStale: true } : {}) });
        try {
          const series = await climateApi.fetch(c.lat, c.lon, day);
          if (get().farmId !== farmId) return;
          climateCache.save(series);
          set({ climate: series, climateState: 'ready', climateError: null, climateStale: false });
        } catch {
          if (get().farmId !== farmId) return;
          // Sem sinal: fica com a cópia do aparelho, se houver, e avisa.
          if (cached) set({ climate: cached, climateState: 'ready', climateStale: true });
          else set({ climateState: 'error', climateError: 'Não deu para buscar o clima. Confira o sinal e tente de novo.' });
        }
      },

      setUseCalibratedM(value) {
        set({ useCalibratedM: value });
      },

      async addFertilization(input) {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        if (!data.paddocks.some((p) => p.id === input.paddockId)) return fail('Escolha o piquete.');
        if (!isIsoDate(input.date)) return fail('Informe a data.');
        if (input.date > today()) return fail('A data não pode ser depois de hoje.');
        if (!(input.nKgHa > 0) || input.nKgHa > 500) return fail('Informe a dose de N, de 1 a 500 kg por hectare.');
        const fert = { id: crypto.randomUUID(), paddockId: input.paddockId, date: input.date, nKgHa: input.nKgHa, note: input.note?.trim() || null };
        const r = await attempt('registrar a adubação', () => repo.recordFertilization(data.farm.id, fert));
        if (r.ok) patchData((d) => ({ ...d, fertilizations: [...d.fertilizations, fert] }));
        return r;
      },

      async removeFertilization(fertilizationId) {
        const r = await attempt('apagar a adubação', () => repo.setFertilizationDeleted(fertilizationId, now().toISOString()));
        if (r.ok) patchData((d) => ({ ...d, fertilizations: d.fertilizations.filter((f) => f.id !== fertilizationId) }));
        return r;
      },

      async renameFarm(input) {
        const data = get().data;
        if (!data) return fail('Nenhuma fazenda aberta.');
        const patch = { name: input.name.trim(), municipality: input.municipality.trim() || null };
        if (!patch.name) return fail('A fazenda precisa de nome.');
        const r = await attempt('alterar a fazenda', () => repo.renameFarm(data.farm.id, patch));
        if (r.ok) {
          patchData((d) => ({ ...d, farm: { ...d.farm, ...patch } }));
          set({ farms: get().farms.map((f) => (f.id === data.farm.id ? { ...f, ...patch } : f)) });
        }
        return r;
      },

      async loadMembers() {
        const farmId = get().farmId;
        if (!farmId) return fail('Nenhuma fazenda aberta.');
        try {
          const members = await repo.listMembers(farmId);
          if (get().farmId === farmId) set({ members });
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para ler quem tem acesso.'));
        }
      },

      async addMember(email) {
        const farmId = get().farmId;
        if (!farmId) return fail('Nenhuma fazenda aberta.');
        const clean = email.trim();
        if (!/^\S+@\S+\.\S+$/.test(clean)) return fail('Informe o e-mail da conta.');
        const r = await attempt('dar acesso', () => repo.addMember(farmId, clean));
        if (r.ok) await get().loadMembers();
        return r;
      },

      async removeMember(userId) {
        const farmId = get().farmId;
        if (!farmId) return fail('Nenhuma fazenda aberta.');
        const r = await attempt('tirar o acesso', () => repo.removeMember(farmId, userId));
        if (r.ok) await get().loadMembers();
        return r;
      },
    };
  });
}
