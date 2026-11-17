import { deriveLot, orderEvents } from '../lib/lots/deriveLot';
import type { LotEvent } from '../lib/lots/types';
import {
  OFFLINE_MESSAGE,
  RepoError,
  type Auth,
  type CompositionRow,
  type Farm,
  type Fertilization,
  type FieldReport,
  type Lot,
  type Module,
  type NotebookApi,
  type Paddock,
  type RainRecord,
  type Repo,
  type User,
  type WaterPoint,
} from './types';

/**
 * Banco em memória com as mesmas regras do banco real que importam para a tela:
 * só membro enxerga a fazenda, `seq` é dado na gravação, reenvio não duplica e
 * apagar é suave. Usado nos testes de tela e no modo de demonstração do
 * desenvolvimento. Não vai para o app publicado.
 */
export function createMemoryBackend() {
  const farms: Farm[] = [];
  const members = new Map<string, Set<string>>();
  const paddocks: Paddock[] = [];
  const waterPoints: WaterPoint[] = [];
  const lots: Lot[] = [];
  const modules: (Module & { deletedAt: string | null })[] = [];
  const compositions: (CompositionRow & { deletedAt: string | null })[] = [];
  const events: LotEvent[] = [];
  const reports: (FieldReport & { farmId: string })[] = [];
  const rain: (RainRecord & { farmId: string; deletedAt: string | null })[] = [];
  const fertilizations: (Fertilization & { farmId: string; deletedAt: string | null })[] = [];
  const owners = new Map<string, string>();
  const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const farmByToken = (token: string) => farms.find((f) => token.length >= 32 && f.shareToken === token);
  const accounts = new Map<string, { id: string; password: string }>();
  const listeners = new Set<(u: User | null) => void>();

  let seq = 0;
  let user: User | null = null;
  let offline = false;
  let notebookMissing = false;
  const calls: string[] = [];

  const online = (name: string) => {
    calls.push(name);
    if (offline) throw new RepoError(OFFLINE_MESSAGE, true);
  };
  const uid = () => {
    if (!user) throw new RepoError('Entre na conta.');
    return user.id;
  };
  const member = (farmId: string) => {
    if (!members.get(farmId)?.has(uid())) throw new RepoError('Sua conta não tem acesso a essa fazenda.');
  };
  const setUser = (u: User | null) => {
    user = u;
    for (const l of listeners) l(u);
  };
  const insertEvents = (farmId: string, list: LotEvent[]): LotEvent[] => {
    const saved: LotEvent[] = [];
    for (const e of list) {
      if (events.some((x) => x.id === e.id)) continue;
      const lot = lots.find((l) => l.id === e.lotId);
      if (!lot || lot.farmId !== farmId) throw new RepoError('Lote de outra fazenda.');
      const row = { ...e, seq: ++seq, deletedAt: null, link: e.link ?? null } as LotEvent;
      events.push(row);
      saved.push(row);
    }
    return saved;
  };

  const repo: Repo = {
    async listFarms() {
      online('listFarms');
      const id = uid();
      return farms.filter((f) => members.get(f.id)?.has(id)).map((f) => ({ ...f }));
    },

    async loadFarm(farmId) {
      online('loadFarm');
      member(farmId);
      const farmLots = lots.filter((l) => l.farmId === farmId);
      const farmModules = modules.filter((m) => m.farmId === farmId && !m.deletedAt);
      return structuredClone({
        farm: farms.find((f) => f.id === farmId)!,
        paddocks: paddocks.filter((p) => p.farmId === farmId),
        waterPoints: waterPoints.filter((w) => w.farmId === farmId),
        lots: farmLots,
        modules: farmModules.map(({ deletedAt: _d, ...m }) => m),
        compositions: compositions
          .filter((c) => !c.deletedAt && farmModules.some((m) => m.id === c.moduleId))
          .map(({ deletedAt: _d, ...c }) => c),
        events: events.filter((e) => farmLots.some((l) => l.id === e.lotId)),
        reports: reports.filter((r) => r.farmId === farmId).map(({ farmId: _f, ...r }) => r),
        rain: rain.filter((r) => r.farmId === farmId && !r.deletedAt).map(({ farmId: _f, deletedAt: _d, ...r }) => r),
        fertilizations: fertilizations.filter((x) => x.farmId === farmId && !x.deletedAt).map(({ farmId: _f, deletedAt: _d, ...x }) => x),
      });
    },

    async createFarm(input) {
      online('createFarm');
      const id = uid();
      if (!input.paddocks.length) throw new RepoError('A fazenda precisa de pelo menos um piquete.');
      if (farms.some((f) => f.id === input.farm.id)) {
        if (members.get(input.farm.id)?.has(id)) return;
        throw new RepoError('Esse id de fazenda já está em uso.');
      }
      farms.push({ ...input.farm, shareToken: newToken() });
      members.set(input.farm.id, new Set([id]));
      owners.set(input.farm.id, id);
      paddocks.push(...structuredClone(input.paddocks));
      waterPoints.push(...structuredClone(input.waterPoints));
    },

    async updatePaddock(paddockId, patch) {
      online('updatePaddock');
      const p = paddocks.find((x) => x.id === paddockId);
      if (!p) return;
      member(p.farmId);
      Object.assign(p, patch);
    },

    async saveModule(module, composition) {
      online('saveModule');
      member(module.farmId);
      const i = modules.findIndex((m) => m.id === module.id);
      if (i >= 0) modules[i] = { ...module, deletedAt: null };
      else modules.push({ ...module, deletedAt: null });
      if (composition) {
        if (!composition.paddockIds.length) throw new RepoError('O módulo precisa de pelo menos um piquete.');
        const now = new Date().toISOString();
        for (const c of compositions) {
          if (c.moduleId === module.id && c.validFrom === composition.validFrom && !c.deletedAt) c.deletedAt = now;
        }
        composition.paddockIds.forEach((paddockId, ord) =>
          compositions.push({
            id: crypto.randomUUID(),
            moduleId: module.id,
            paddockId,
            ord,
            validFrom: composition.validFrom,
            deletedAt: null,
          }),
        );
      }
    },

    async setModuleDeleted(moduleId, deletedAt) {
      online('setModuleDeleted');
      const m = modules.find((x) => x.id === moduleId);
      if (!m) return;
      member(m.farmId);
      m.deletedAt = deletedAt;
    },

    async createLot(lot, list) {
      online('createLot');
      member(lot.farmId);
      const inicio = list.find((e) => e.type === 'inicio');
      if (!inicio || inicio.type !== 'inicio' || inicio.heads <= 0 || inicio.weightKg <= 0) {
        throw new RepoError('Não deu para criar o lote: formação inválida.');
      }
      if (!lots.some((l) => l.id === lot.id)) lots.push({ ...lot, deletedAt: null });
      return structuredClone(insertEvents(lot.farmId, list));
    },

    async recordEvents(farmId, list) {
      online('recordEvents');
      member(farmId);
      return structuredClone(insertEvents(farmId, list));
    },

    async setEventsDeleted(eventIds, deletedAt) {
      online('setEventsDeleted');
      uid();
      for (const e of events) if (eventIds.includes(e.id)) e.deletedAt = deletedAt;
    },

    async setLotDeleted(lotId, deletedAt) {
      online('setLotDeleted');
      const l = lots.find((x) => x.id === lotId);
      if (!l) return;
      member(l.farmId);
      l.deletedAt = deletedAt;
    },

    async listReports(farmId) {
      online('listReports');
      member(farmId);
      return structuredClone(reports.filter((r) => r.farmId === farmId).map(({ farmId: _f, ...r }) => r));
    },

    async updateReport(reportId, patch) {
      online('updateReport');
      const r = reports.find((x) => x.id === reportId);
      if (!r) return;
      member(r.farmId);
      Object.assign(r, patch);
    },

    async setReportStatus(reportId, status) {
      online('setReportStatus');
      const r = reports.find((x) => x.id === reportId);
      if (!r) return;
      member(r.farmId);
      r.status = status;
    },

    async launchMoveReport(reportId, farmId, list) {
      online('launchMoveReport');
      member(farmId);
      const r = reports.find((x) => x.id === reportId && x.farmId === farmId);
      if (!r || r.kind !== 'mudanca' || r.status !== 'novo') throw new RepoError('Esse relato já foi lançado ou descartado.');
      const saved = insertEvents(farmId, list);
      r.status = 'lancado';
      return structuredClone(saved);
    },

    async recordRain(farmId, input, options) {
      online('recordRain');
      member(farmId);
      if (options.reportId) {
        const r = reports.find((x) => x.id === options.reportId && x.farmId === farmId);
        if (!r || r.kind !== 'chuva' || r.status !== 'novo') throw new RepoError('Esse relato já foi lançado ou descartado.');
        r.status = 'lancado';
      }
      if (options.replace) {
        const now = new Date().toISOString();
        for (const x of rain) if (x.farmId === farmId && x.date === input.date && !x.deletedAt) x.deletedAt = now;
      }
      const row = { ...input, reportId: options.reportId ?? null, farmId, deletedAt: null };
      rain.push(row);
      const { farmId: _f, deletedAt: _d, ...out } = row;
      return out;
    },

    async setRainDeleted(rainId, deletedAt) {
      online('setRainDeleted');
      const r = rain.find((x) => x.id === rainId);
      if (!r) return;
      member(r.farmId);
      r.deletedAt = deletedAt;
    },

    async rotateShareToken(farmId) {
      online('rotateShareToken');
      member(farmId);
      const f = farms.find((x) => x.id === farmId)!;
      f.shareToken = newToken();
      return f.shareToken;
    },

    async recordFertilization(farmId, fert) {
      online('recordFertilization');
      member(farmId);
      if (!paddocks.some((p) => p.id === fert.paddockId && p.farmId === farmId)) throw new RepoError('Piquete de outra fazenda.');
      if (!fertilizations.some((x) => x.id === fert.id)) fertilizations.push({ ...fert, farmId, deletedAt: null });
    },

    async setFertilizationDeleted(fertilizationId, deletedAt) {
      online('setFertilizationDeleted');
      const x = fertilizations.find((y) => y.id === fertilizationId);
      if (!x) return;
      member(x.farmId);
      x.deletedAt = deletedAt;
    },

    async renameFarm(farmId, patch) {
      online('renameFarm');
      member(farmId);
      Object.assign(farms.find((f) => f.id === farmId)!, patch);
    },

    async listMembers(farmId) {
      online('listMembers');
      member(farmId);
      const emailOf = (id: string) => [...accounts.entries()].find(([, a]) => a.id === id)?.[0] ?? '';
      return [...members.get(farmId)!].map((id) => ({ userId: id, email: emailOf(id), role: owners.get(farmId) === id ? ('owner' as const) : ('member' as const) }));
    },

    async addMember(farmId, email) {
      online('addMember');
      if (owners.get(farmId) !== uid()) throw new RepoError('Só o dono da fazenda dá acesso a outra conta.');
      const acc = accounts.get(email.trim().toLowerCase());
      if (!acc) throw new RepoError('Não existe conta com esse e-mail. A pessoa precisa criar a conta no app primeiro.');
      members.get(farmId)!.add(acc.id);
    },

    async removeMember(farmId, userId) {
      online('removeMember');
      if (owners.get(farmId) !== uid()) throw new RepoError('Só o dono da fazenda tira o acesso de outra conta.');
      if (userId === uid()) throw new RepoError('Você não pode tirar o próprio acesso.');
      members.get(farmId)!.delete(userId);
    },
  };

  /** O link público: não olha quem está logado, só o token. */
  const notebook: NotebookApi = {
    async context(token) {
      calls.push('notebook.context');
      if (notebookMissing) throw new RepoError('O banco ainda não foi preparado.', false, true);
      if (offline) throw new RepoError(OFFLINE_MESSAGE, true);
      const f = farmByToken(token);
      if (!f) return null;
      // Mesma regra da função do banco: contorno com no máximo ~40 pontos; lote só
      // com animais; "onde está" é o relato pendente mais recente, ou o histórico.
      const outline = (ring: [number, number][]) => {
        const step = Math.max(1, Math.ceil(ring.length / 40));
        return ring.filter((_, i) => i % step === 0);
      };
      return {
        farmName: f.name,
        paddocks: paddocks
          .filter((p) => p.farmId === f.id)
          .sort((a, b) => a.sort - b.sort)
          .map((p) => ({ id: p.id, name: p.name, outline: outline(p.geom.coordinates[0]) })),
        lots: lots
          .filter((l) => l.farmId === f.id && !l.deletedAt)
          .map((l) => {
            const mine = events.filter((e) => e.lotId === l.id);
            const heads = deriveLot(l.id, mine).current?.heads ?? 0;
            const last = orderEvents(mine).filter((e) => e.type === 'piquete_entrada' || e.type === 'piquete_saida').pop();
            const official = last?.type === 'piquete_entrada' ? last.paddockId : null;
            const pending = reports
              .filter((r) => r.lotId === l.id && r.kind === 'mudanca' && r.status === 'novo')
              .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))[0];
            return { id: l.id, name: l.name, heads, paddockId: pending?.toPaddockId ?? official };
          })
          .filter((l) => l.heads > 0)
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    async submit(token, report) {
      calls.push('notebook.submit');
      if (offline) throw new RepoError(OFFLINE_MESSAGE, true);
      const f = farmByToken(token);
      if (!f) throw new RepoError('Este link do caderno não vale mais. Peça o link novo.');
      if (reports.some((r) => r.id === report.id)) return;
      if (report.kind === 'chuva' && !(report.mm != null && report.mm >= 0 && report.mm <= 500)) {
        throw new RepoError('Chuva: informe os milímetros, de 0 a 500.');
      }
      if (report.kind === 'mudanca') {
        if (!lots.some((l) => l.id === report.lotId && l.farmId === f.id && !l.deletedAt)) throw new RepoError('Lote não encontrado. Atualize a página.');
        if (!paddocks.some((p) => p.id === report.toPaddockId && p.farmId === f.id)) throw new RepoError('Piquete não encontrado. Atualize a página.');
      }
      reports.push({
        id: report.id,
        farmId: f.id,
        kind: report.kind,
        date: report.date,
        mm: report.kind === 'chuva' ? report.mm! : null,
        lotId: report.kind === 'mudanca' ? report.lotId! : null,
        toPaddockId: report.kind === 'mudanca' ? report.toPaddockId! : null,
        reporter: report.reporter?.trim() || null,
        note: report.note?.trim() || null,
        status: 'novo',
        createdAt: new Date().toISOString(),
      });
    },
  };

  const auth: Auth = {
    currentUser: async () => user,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      if (offline) throw new RepoError(OFFLINE_MESSAGE, true);
      const acc = accounts.get(email.toLowerCase());
      if (!acc || acc.password !== password) throw new RepoError('E-mail ou senha incorretos.');
      setUser({ id: acc.id, email: email.toLowerCase() });
    },
    async signUp(email, password) {
      if (offline) throw new RepoError(OFFLINE_MESSAGE, true);
      if (accounts.has(email.toLowerCase())) throw new RepoError('Esse e-mail já tem conta. Use "Entrar".');
      if (password.length < 6) throw new RepoError('A senha precisa ter pelo menos 6 caracteres.');
      const acc = { id: crypto.randomUUID(), password };
      accounts.set(email.toLowerCase(), acc);
      setUser({ id: acc.id, email: email.toLowerCase() });
      return { needsConfirmation: false };
    },
    async signOut() {
      setUser(null);
    },
  };

  return {
    repo,
    auth,
    notebook,
    /** Nomes das chamadas feitas ao "servidor", para os testes conferirem. */
    calls,
    setOffline(value: boolean) {
      offline = value;
    },
    /** Simula o banco sem a migração do caderno. */
    setNotebookMissing(value: boolean) {
      notebookMissing = value;
    },
    /** Entra direto com uma conta nova, sem passar pela tela. */
    async signInAs(email: string) {
      if (!accounts.has(email)) accounts.set(email, { id: crypto.randomUUID(), password: 'senha-de-teste' });
      setUser({ id: accounts.get(email)!.id, email });
      return user!;
    },
  };
}

export type MemoryBackend = ReturnType<typeof createMemoryBackend>;
