import type { LotEvent } from '../lib/lots/types';
import {
  OFFLINE_MESSAGE,
  RepoError,
  type Auth,
  type CompositionRow,
  type Farm,
  type Lot,
  type Module,
  type Paddock,
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
  const accounts = new Map<string, { id: string; password: string }>();
  const listeners = new Set<(u: User | null) => void>();

  let seq = 0;
  let user: User | null = null;
  let offline = false;
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
      farms.push({ ...input.farm });
      members.set(input.farm.id, new Set([id]));
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
    /** Nomes das chamadas feitas ao "servidor", para os testes conferirem. */
    calls,
    setOffline(value: boolean) {
      offline = value;
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
