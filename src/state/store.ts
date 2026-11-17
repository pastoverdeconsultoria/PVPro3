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
  type RainRecord,
  type Repo,
  type ReportPatch,
  type User,
} from '../data/types';
import { climateCache, type ClimateApi, type ClimateSeries } from '../lib/climate/openMeteo';
import { checkComposition } from '../lib/farm/modules';
import { checkChange, planMove, planRemoval, planRestore, type Result } from '../lib/lots/changes';
import { addDays, formatBr, isIsoDate, todayLocal, type IsoDate } from '../lib/lots/dates';
import { deriveLot } from '../lib/lots/deriveLot';
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
  saveModule(module: Module, composition?: { validFrom: IsoDate; paddockIds: string[] }): Promise<Result<void>>;
  deleteModule(moduleId: string): Promise<Result<void>>;
  createLot(input: NewLotInput): Promise<Result<void>>;
  moveLot(lotId: string, toPaddockId: string, date: IsoDate): Promise<Result<void>>;
  addEvent(lotId: string, draft: EventDraft): Promise<Result<void>>;
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
const NO_CLIMATE = { climate: null, climateState: 'idle' as const, climateError: null, climateStale: false, members: null };

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
        set({ farmId, data: null, loading: true, loadError: null, staleSince: null, ...NO_CLIMATE });
        cache.saveLastFarm(user.id, farmId);
        try {
          const data = await repo.loadFarm(farmId);
          if (get().farmId !== farmId) return;
          set({ data, loading: false });
          cache.saveFarm(user.id, data);
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
          const data = await repo.loadFarm(farmId);
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
        try {
          const saved = await repo.createLot(lot, events);
          patchData((d) => ({ ...d, lots: [...d.lots, lot], events: [...d.events, ...saved] }));
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para criar o lote.'));
        }
      },

      async moveLot(lotId, toPaddockId, date) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        if (!ctx.data.paddocks.some((p) => p.id === toPaddockId)) return fail('Escolha o piquete de destino.');
        const plan = planMove({ events: ctx.events, lotId, lotName: ctx.lot.name, toPaddockId, date, today: today() });
        if (!plan.ok) return plan;
        try {
          // Saída e entrada vão na mesma chamada, nessa ordem (invariante 2).
          mergeEvents(await repo.recordEvents(ctx.data.farm.id, plan.value));
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para gravar a mudança.'));
        }
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
        try {
          mergeEvents(await repo.recordEvents(ctx.data.farm.id, [event]));
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para gravar o registro.'));
        }
      },

      async removeEvent(lotId, eventId) {
        const ctx = lotContext(lotId);
        if (!ctx) return fail('Lote não encontrado.');
        const deletedAt = now().toISOString();
        const plan = planRemoval(lotId, ctx.events, eventId, deletedAt, ctx.lot.name);
        if (!plan.ok) return plan;
        const ids = plan.value.filter((e) => e.deletedAt === deletedAt).map((e) => e.id);
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
        const ids = plan.value.filter((e) => !e.deletedAt && before.get(e.id)).map((e) => e.id);
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
        try {
          const saved = await repo.recordRain(
            data.farm.id,
            { id: crypto.randomUUID(), date: input.date, mm: input.mm, note: input.note?.trim() || null },
            { replace: mode === 'substituir' },
          );
          mergeRain(saved, mode);
          return OK;
        } catch (e) {
          return fail(message(e, 'Não deu para registrar a chuva.'));
        }
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
