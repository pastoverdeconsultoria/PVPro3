import { beforeEach, describe, expect, it } from 'vitest';
import { cache } from '../data/cache';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { NewFarm } from '../data/types';
import { exampleNewFarm, NOW } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

// O app tem de abrir sem sinal com a cópia do aparelho, e o que for feito sem
// sinal (ou com o login ainda vencido) vai ao servidor quando a sessão voltar.

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;
let userId: string;

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const newStore = () => createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
const onServer = () => be.repo.loadFarm(nf.farm.id);
const entradas = async () => (await onServer()).events.filter((e) => e.type === 'piquete_entrada');

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = newStore();
  userId = (await be.signInAs('ana@exemplo.test')).id;
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
});

describe('abrir sem sinal', () => {
  it('abre direto na fazenda pela cópia do aparelho', async () => {
    be.setOffline(true);
    store = newStore();
    await s().init();
    expect(s().phase).toBe('signedIn');
    expect(s().farmId).toBe(nf.farm.id);
    expect(s().data?.lots.map((l) => l.name)).toEqual(['Lote 1']);
    expect(s().staleSince).not.toBeNull();
  });

  it('a cópia entra na tela antes de o servidor responder', async () => {
    store = newStore();
    const init = s().init();
    // Antes de qualquer resposta da rede, a fazenda já está na tela.
    await Promise.resolve();
    await Promise.resolve();
    expect(s().data?.farm.id).toBe(nf.farm.id);
    await init;
    await new Promise((r) => setTimeout(r, 0));
    expect(s().staleSince).toBeNull();
  });

  it('com o login vencido não troca a cópia por lista vazia nem envia nada', async () => {
    be.setSessionExpired(true);
    store = newStore();
    await s().init();
    expect(s().data?.lots).toHaveLength(1);
    expect(cache.loadFarm(userId, nf.farm.id)?.value.lots).toHaveLength(1);

    // Registro feito com o login vencido: fica na fila, não é desfeito.
    expect((await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10')).ok).toBe(true);
    expect(s().outbox).toHaveLength(1);
    expect(s().outboxError).toBeNull();
    // Tentar enviar de novo com o login ainda vencido também não desfaz.
    await s().resync();
    expect(s().outbox).toHaveLength(1);
    expect(s().data?.lots).toHaveLength(1);

    // Login renovou: a fila vai ao servidor e a cópia vira o dado do servidor.
    be.setSessionExpired(false);
    expect(await entradas()).toHaveLength(0);
    await s().resync();
    expect(s().outbox).toEqual([]);
    expect(await entradas()).toHaveLength(1);
    expect(s().staleSince).toBeNull();
  });

  it('o sinal voltou: o que foi feito offline é enviado e a tela sai da cópia', async () => {
    be.setOffline(true);
    store = newStore();
    await s().init();
    expect((await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10')).ok).toBe(true);
    expect(s().outbox).toHaveLength(1);

    be.setOffline(false);
    await s().resync();
    expect(s().outbox).toEqual([]);
    expect(await entradas()).toHaveLength(1);
    expect(s().staleSince).toBeNull();
  });

  it('a fazenda aberta pela cópia fecha se o acesso foi retirado', async () => {
    const other = await be.signInAs('bruno@exemplo.test');
    await be.signInAs('ana@exemplo.test');
    await be.repo.addMember(nf.farm.id, 'bruno@exemplo.test', 'member');
    await be.signInAs('bruno@exemplo.test');
    store = newStore();
    await s().init();
    await new Promise((r) => setTimeout(r, 0));
    expect(s().farmId).toBe(nf.farm.id);

    await be.signInAs('ana@exemplo.test');
    await be.repo.removeMember(nf.farm.id, other.id);
    await be.signInAs('bruno@exemplo.test');
    store = newStore();
    await s().init();
    await new Promise((r) => setTimeout(r, 0));
    expect(s().farms).toEqual([]);
    expect(s().farmId).toBeNull();
    expect(s().data).toBeNull();
  });
});
