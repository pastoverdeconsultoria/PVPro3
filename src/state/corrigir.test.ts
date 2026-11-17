import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import { RepoError, type NewFarm } from '../data/types';
import { deriveFarm } from '../lib/farm/farmView';
import { orderEvents } from '../lib/lots/deriveLot';
import { exampleNewFarm, NOW, TODAY } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

// Corrigir a data de um registro: o antigo é apagado de forma suave e um novo entra.

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const view = () => deriveFarm(s().data!, TODAY);
const live = () => orderEvents(s().data!.events);
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 100, weightKg: 400, category: 'Recria', weighed: false });
  await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-01');
  await s().moveLot(lotId('Lote 1'), pid('P02'), '2026-11-13');
});

describe('corrigir a data de um registro', () => {
  it('numa mudança de piquete, saída e entrada mudam juntas e tudo é recalculado', async () => {
    const entrada = live().find((e) => e.type === 'piquete_entrada' && e.date === '2026-11-13')!;
    expect((await s().changeEventDate(lotId('Lote 1'), entrada.id, '2026-11-10')).ok).toBe(true);

    const moved = live().filter((e) => e.date === '2026-11-10');
    expect(moved.map((e) => e.type)).toEqual(['piquete_saida', 'piquete_entrada']);
    expect(moved[0].link).toBe(moved[1].link);
    expect(moved[0].link).not.toBe(entrada.link);
    expect(live().some((e) => e.date === '2026-11-13')).toBe(false);
    // Os dois antigos continuam no banco, apagados de forma suave.
    expect(s().data!.events.filter((e) => e.deletedAt).map((e) => e.date)).toEqual(['2026-11-13', '2026-11-13']);

    const v = view();
    expect(v.paddockById.get(pid('P01'))!.lastPeriod).toMatchObject({ start: '2026-11-01', end: '2026-11-10', days: 9 });
    expect(v.paddockById.get(pid('P02'))!.dayOfUse).toBe(6);

    // O servidor ficou igual ao que está na tela.
    await s().refresh();
    expect(live().filter((e) => e.date === '2026-11-10')).toHaveLength(2);
    expect(view().paddockById.get(pid('P01'))!.restDays).toBe(5);
  });

  it('corrige pesagem e formação, e recusa o que deixaria o histórico sem sentido', async () => {
    const id = lotId('Lote 1');
    await s().addEvent(id, { type: 'pesagem', date: '2026-10-10', weightKg: 410 });
    await s().addEvent(id, { type: 'pesagem', date: '2026-11-09', weightKg: 440 });
    expect(view().lotById.get(id)!.gmd!.kgDay).toBeCloseTo(1, 10);
    const pesagem = live().find((e) => e.type === 'pesagem' && e.date === '2026-11-09')!;
    expect((await s().changeEventDate(id, pesagem.id, '2026-10-30')).ok).toBe(true);
    expect(view().lotById.get(id)!.gmd!.kgDay).toBeCloseTo(1.5, 10);

    const inicio = live().find((e) => e.type === 'inicio')!;
    expect(err(await s().changeEventDate(id, inicio.id, '2026-10-20'))).toBe('Há registro de Lote 1 antes da formação do lote (20/10/2026).');
    expect((await s().changeEventDate(id, inicio.id, '2026-09-15')).ok).toBe(true);
    expect(view().lotById.get(id)!.derived.formationDate).toBe('2026-09-15');

    const calls = be.calls.length;
    const segunda = live().find((e) => e.type === 'piquete_entrada' && e.date === '2026-11-13')!;
    // Levar a segunda mudança para antes da primeira entrada: a saída ficaria sem entrada antes.
    expect(err(await s().changeEventDate(id, segunda.id, '2026-10-25'))).toMatch(/saída de piquete em 25\/10\/2026 sem entrada antes/);
    expect(err(await s().changeEventDate(id, segunda.id, '2026-11-16'))).toBe('A data não pode ser depois de hoje.');
    expect(err(await s().changeEventDate(id, 'nao-existe', '2026-11-10'))).toBe('Registro não encontrado.');
    expect((await s().changeEventDate(id, segunda.id, '2026-11-13')).ok).toBe(true);
    expect(be.calls.length).toBe(calls);
  });

  it('numa transferência, a data muda nos dois lotes', async () => {
    await s().createLot({ name: 'Lote 2', date: '2026-10-01', heads: 50, weightKg: 300, category: 'Recria', weighed: false });
    await s().transferAnimals(lotId('Lote 1'), lotId('Lote 2'), 20, '2026-11-05');
    const saida = live().find((e) => e.type === 'transf_out')!;
    expect((await s().changeEventDate(lotId('Lote 1'), saida.id, '2026-11-02')).ok).toBe(true);
    const pair = live().filter((e) => e.type === 'transf_out' || e.type === 'transf_in');
    expect(pair.map((e) => [e.type, e.date])).toEqual([['transf_out', '2026-11-02'], ['transf_in', '2026-11-02']]);
    expect(pair[0].link).toBe(pair[1].link);
    expect(view().lots.map((l) => l.heads)).toEqual([80, 70]);
  });

  it('se o registro novo não entra, o antigo é devolvido e nada some', async () => {
    const flaky = { ...be.repo, recordEvents: async () => Promise.reject(new RepoError('O servidor recusou.')) };
    const st = createAppStore({ repo: flaky, auth: be.auth, now: NOW });
    await st.getState().init();
    const entrada = orderEvents(st.getState().data!.events).find((e) => e.type === 'piquete_entrada' && e.date === '2026-11-13')!;
    expect(await st.getState().changeEventDate(lotId('Lote 1'), entrada.id, '2026-11-10')).toEqual({ ok: false, error: 'O servidor recusou.' });
    expect(st.getState().data!.events.filter((e) => e.deletedAt)).toEqual([]);

    await s().refresh();
    expect(s().data!.events.filter((e) => e.deletedAt)).toEqual([]);
    expect(live().filter((e) => e.date === '2026-11-13')).toHaveLength(2);
  });

  it('com registro esperando sinal, pede para enviar primeiro', async () => {
    be.setOffline(true);
    await s().addEvent(lotId('Lote 1'), { type: 'pesagem', date: '2026-11-14', weightKg: 420 });
    const entrada = live().find((e) => e.type === 'piquete_entrada' && e.date === '2026-11-13')!;
    expect(err(await s().changeEventDate(lotId('Lote 1'), entrada.id, '2026-11-10'))).toMatch(/Há registros esperando sinal/);
  });
});
