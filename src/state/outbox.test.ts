import { beforeEach, describe, expect, it } from 'vitest';
import { cache } from '../data/cache';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { NewFarm } from '../data/types';
import { deriveFarm } from '../lib/farm/farmView';
import { rainOn } from '../lib/farm/rain';
import { orderEvents } from '../lib/lots/deriveLot';
import { exampleNewFarm, NOW, TODAY } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

// Ação de campo do consultor sem sinal: fica guardada no aparelho, aparece na
// tela como feita e é enviada depois, na mesma ordem, sem duplicar.

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const view = () => deriveFarm(s().data!, TODAY);
const newStore = () => createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
/** O que o servidor tem de verdade, lido por fora do app. */
const onServer = () => be.repo.loadFarm(nf.farm.id);

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = newStore();
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
});

describe('gravar sem sinal', () => {
  it('a mudança de gado fica guardada, aparece na tela e vai ao servidor quando o sinal volta', async () => {
    be.setOffline(true);
    expect((await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10')).ok).toBe(true);
    expect(s().outbox).toHaveLength(1);
    expect(view().paddockById.get(pid('P01'))!.occupants.map((o) => o.lot.name)).toEqual(['Lote 1']);
    // Guardado sem `seq`: conta como o registro mais recente do dia.
    expect(s().data!.events.find((e) => e.type === 'piquete_entrada')!.seq).toBeUndefined();

    be.setOffline(false);
    expect((await onServer()).events.filter((e) => e.type === 'piquete_entrada')).toEqual([]);
    await s().flushOutbox();
    expect(s().outbox).toEqual([]);
    expect((await onServer()).events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
    expect(s().data!.events.every((e) => typeof e.seq === 'number')).toBe(true);
    expect(view().paddockById.get(pid('P01'))!.occupants).toHaveLength(1);
  });

  it('várias ações sem sinal entram em ordem: lote novo, mudança, pesagem, transferência e chuva', async () => {
    be.setOffline(true);
    expect((await s().createLot({ name: 'Lote 2', date: '2026-11-01', heads: 40, weightKg: 300, category: 'Recria', weighed: false })).ok).toBe(true);
    expect((await s().moveLot(lotId('Lote 2'), pid('P02'), '2026-11-05')).ok).toBe(true);
    expect((await s().moveLot(lotId('Lote 2'), pid('P03'), '2026-11-12')).ok).toBe(true);
    expect((await s().addEvent(lotId('Lote 2'), { type: 'pesagem', date: '2026-11-12', weightKg: 320 })).ok).toBe(true);
    expect((await s().transferAnimals(lotId('Lote 1'), lotId('Lote 2'), 10, '2026-11-13')).ok).toBe(true);
    expect((await s().addRain({ date: '2026-11-14', mm: 12 }, 'somar')).ok).toBe(true);
    expect(s().outbox.map((o) => o.kind)).toEqual(['createLot', 'events', 'events', 'events', 'events', 'rain']);

    // As regras continuam valendo sobre o que está guardado no aparelho.
    expect(await s().moveLot(lotId('Lote 2'), pid('P03'), '2026-11-13')).toEqual({ ok: false, error: 'O lote já está nesse piquete.' });
    const v = view();
    expect(v.lotById.get(lotId('Lote 2'))).toMatchObject({ heads: 50 });
    expect(v.paddockById.get(pid('P03'))!.occupants).toHaveLength(1);
    expect(v.paddockById.get(pid('P02'))!.restDays).toBe(3);
    expect(rainOn(s().data!.rain, '2026-11-14')).toBe(12);
    expect((await onServerSafe()).lots).toHaveLength(1);

    be.setOffline(false);
    await s().flushOutbox();
    expect(s().outbox).toEqual([]);
    const server = await onServer();
    expect(server.lots.map((l) => l.name).sort()).toEqual(['Lote 1', 'Lote 2']);
    const lote2 = server.lots.find((l) => l.name === 'Lote 2')!.id;
    // A ordem em que foram feitos é a ordem do `seq` no servidor.
    expect(orderEvents(server.events.filter((e) => e.lotId === lote2)).map((e) => e.type)).toEqual([
      'inicio', 'piquete_entrada', 'piquete_saida', 'piquete_entrada', 'pesagem', 'transf_in',
    ]);
    expect(rainOn(server.rain, '2026-11-14')).toBe(12);
    const after = deriveFarm(server, TODAY);
    expect(after.lots.map((l) => [l.lot.name, l.heads])).toEqual([['Lote 1', 80], ['Lote 2', 50]]);
  });

  async function onServerSafe() {
    be.setOffline(false);
    const d = await onServer();
    be.setOffline(true);
    return d;
  }

  it('fechar e abrir o app sem sinal não perde nada; ao voltar o sinal, envia sozinho', async () => {
    be.setOffline(true);
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10');
    await s().addRain({ date: '2026-11-12', mm: 7 }, 'somar');

    const offline = newStore();
    await offline.getState().init();
    expect(offline.getState().outbox).toHaveLength(2);
    expect(offline.getState().staleSince).not.toBeNull();
    expect(deriveFarm(offline.getState().data!, TODAY).paddockById.get(pid('P01'))!.occupants).toHaveLength(1);

    be.setOffline(false);
    const online = newStore();
    await online.getState().init();
    await online.getState().flushOutbox();
    expect(online.getState().outbox).toEqual([]);
    const server = await onServer();
    expect(server.events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
    expect(rainOn(server.rain, '2026-11-12')).toBe(7);
    expect(rainOn(online.getState().data!.rain, '2026-11-12')).toBe(7);
  });

  it('se a resposta do servidor se perdeu e o envio se repete, nada é duplicado', async () => {
    be.setOffline(true);
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10');
    const [op] = s().outbox;
    be.setOffline(false);
    // O servidor recebeu, mas o aparelho não ficou sabendo: a fila ainda tem o registro.
    if (op.kind === 'events') await be.repo.recordEvents(nf.farm.id, op.events);
    await s().flushOutbox();
    expect(s().outbox).toEqual([]);
    expect((await onServer()).events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
    expect(s().data!.events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
    expect(s().data!.events.every((e) => typeof e.seq === 'number')).toBe(true);
  });

  it('registro recusado pelo servidor sai da fila, é desfeito na tela e o consultor é avisado', async () => {
    be.setOffline(true);
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10');
    // Enquanto o aparelho estava sem sinal, a fila ganhou um registro de um lote que o servidor não conhece.
    const ghost = { id: 'op-fantasma', kind: 'events' as const, events: [{ id: crypto.randomUUID(), lotId: 'lote-que-nao-existe', date: '2026-11-11', type: 'pesagem' as const, weightKg: 300 }] };
    cache.saveOutbox(s().user!.id, nf.farm.id, [ghost, ...s().outbox]);
    be.setOffline(false);

    const again = newStore();
    await again.getState().init();
    await again.getState().flushOutbox();
    const st = again.getState();
    expect(st.outbox).toEqual([]);
    expect(st.outboxError).toMatch(/Um registro feito sem sinal não foi aceito e foi desfeito/);
    expect(st.data!.events.some((e) => e.lotId === 'lote-que-nao-existe')).toBe(false);
    // O registro bom, que vinha depois, foi enviado normalmente.
    expect((await onServer()).events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
    st.dismissOutboxError();
    expect(again.getState().outboxError).toBeNull();
  });

  it('sair da conta com registro esperando não apaga a fila; ao entrar de novo, ela volta', async () => {
    be.setOffline(true);
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10');
    await s().signOut();
    expect(Object.keys(localStorage).filter((k) => k.includes(':outbox:'))).toHaveLength(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('pvpro3:') && !k.includes(':outbox:'))).toEqual([]);

    be.setOffline(false);
    await be.signInAs('ana@exemplo.test');
    await s().loadFarms();
    await s().flushOutbox();
    expect(s().outbox).toEqual([]);
    expect((await onServer()).events.filter((e) => e.type === 'piquete_entrada')).toHaveLength(1);
  });

  it('lançar relato do caderno e editar piquete continuam exigindo sinal', async () => {
    be.setOffline(true);
    expect(await s().updatePaddock(pid('P01'), { name: 'X' })).toEqual({ ok: false, error: 'Sem resposta do servidor. Confira o sinal e tente de novo.' });
    expect((await s().addFertilization({ paddockId: pid('P01'), date: '2026-11-10', nKgHa: 40 })).ok).toBe(false);
    expect(s().outbox).toEqual([]);
  });
});
