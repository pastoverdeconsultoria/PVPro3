import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { NewFarm } from '../data/types';
import { deriveFarm } from '../lib/farm/farmView';
import { moduleViews, moveQueue, whenText } from '../lib/farm/modules';
import { exampleNewFarm, NOW, TODAY } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const view = () => deriveFarm(s().data!, TODAY);
const lot = (name: string) => view().lotById.get(lotId(name))!;
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);
const queue = () => moveQueue(moduleViews(s().data!.modules, s().data!.compositions, view()));

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 100, weightKg: 400, category: 'Recria', weighed: false });
  await s().createLot({ name: 'Lote 2', date: '2026-10-01', heads: 50, weightKg: 300, category: 'Recria', weighed: false });
});

describe('fila de trocas', () => {
  const modulo = (days: number) => ({ id: 'm1', farmId: nf.farm.id, name: 'Módulo A', color: '#5B8DEF', occupationDays: days, plannedLotId: null, condition: 'extensiva' as const, mRef: 40 });

  it('diz quando o lote vai para o próximo piquete da ordem e o descanso que ele terá', async () => {
    await s().saveModule(modulo(5), { validFrom: '2026-10-01', paddockIds: [pid('P01'), pid('P02'), pid('P03')] });
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-01');
    // Em 15/11 o lote está no dia 4 de 5 em P02: troca em 2 dias, para P03.
    await s().moveLot(lotId('Lote 1'), pid('P02'), '2026-11-12');
    const [q] = queue();
    expect(q).toMatchObject({ lotName: 'Lote 1', daysUntil: 2 });
    expect([q.from.paddock.name, q.to.paddock.name]).toEqual(['P02', 'P03']);
    // P03 nunca foi usado: não há descanso para informar.
    expect(q.restAtEntry).toBeNull();
    expect(whenText(q.daysUntil)).toBe('Em 2 dias');
  });

  it('último dia do plano é a véspera da troca; passou do plano, fica atrasada; a ordem dá a volta', async () => {
    await s().saveModule(modulo(5), { validFrom: '2026-10-01', paddockIds: [pid('P01'), pid('P02')] });
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-01');
    await s().moveLot(lotId('Lote 1'), pid('P02'), '2026-11-11');
    // Dia 5 de 5 em P02: troca amanhã, de volta para P01, que saiu em 11/11 (4 dias) e terá 5 na entrada.
    let [q] = queue();
    expect([q.daysUntil, q.to.paddock.name, q.restAtEntry]).toEqual([1, 'P01', 5]);

    await s().saveModule(modulo(2));
    [q] = queue();
    expect(q.daysUntil).toBe(-2);
    expect(q.restAtEntry).toBe(4);
    expect([whenText(1), whenText(0), whenText(-1), whenText(-2)]).toEqual(['Amanhã', 'Hoje', 'Atrasada 1 dia', 'Atrasada 2 dias']);
  });

  it('não sugere troca sem piquete ocupado, com um piquete só ou com o próximo ocupado', async () => {
    await s().saveModule(modulo(5), { validFrom: '2026-10-01', paddockIds: [pid('P01'), pid('P02')] });
    expect(queue()).toEqual([]);
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-10');
    expect(queue()).toHaveLength(1);
    await s().moveLot(lotId('Lote 2'), pid('P02'), '2026-11-10');
    expect(queue()).toEqual([]);
    await s().saveModule(modulo(5), { validFrom: '2026-11-15', paddockIds: [pid('P01')] });
    expect(queue()).toEqual([]);
  });
});

describe('transferência entre lotes', () => {
  it('tira de um lote e põe no outro com o peso de origem, num registro ligado', async () => {
    expect((await s().transferAnimals(lotId('Lote 1'), lotId('Lote 2'), 50, '2026-11-01')).ok).toBe(true);
    expect(lot('Lote 1')).toMatchObject({ heads: 50, weightKg: 400 });
    // 50 × 300 kg + 50 × 400 kg = 350 kg de média.
    expect(lot('Lote 2')).toMatchObject({ heads: 100, weightKg: 350 });
    const linked = s().data!.events.filter((e) => e.link);
    expect(linked.map((e) => e.type).sort()).toEqual(['transf_in', 'transf_out']);
    expect(linked[0].link).toBe(linked[1].link);
    expect(linked.find((e) => e.type === 'transf_out')).toMatchObject({ reason: 'transferência para Lote 2' });
    // Uma chamada só ao servidor: as duas pontas entram juntas.
    expect(be.calls.filter((c) => c === 'recordEvents')).toHaveLength(1);
  });

  it('recusa mais cabeças do que o lote tem, o mesmo lote e data antes da formação', async () => {
    const [a, b] = [lotId('Lote 1'), lotId('Lote 2')];
    expect(err(await s().transferAnimals(a, b, 101, '2026-11-01'))).toBe('Lote 1 não tem 101 cabeças em 01/11/2026.');
    expect(err(await s().transferAnimals(a, a, 10, '2026-11-01'))).toBe('Escolha o lote que recebe os animais.');
    expect(err(await s().transferAnimals(a, b, 10, '2026-09-01'))).toBe('Lote 1 foi formado em 01/10/2026.');
    expect(err(await s().transferAnimals(a, b, 0, '2026-11-01'))).toBe('Informe o número de cabeças.');
    expect(s().data!.events).toHaveLength(2);
  });

  it('apagar uma ponta apaga a outra, no outro lote, e desfazer devolve as duas', async () => {
    const [a, b] = [lotId('Lote 1'), lotId('Lote 2')];
    await s().transferAnimals(a, b, 50, '2026-11-01');
    const entrada = s().data!.events.find((e) => e.type === 'transf_in')!;

    expect((await s().removeEvent(b, entrada.id)).ok).toBe(true);
    expect(s().data!.events.filter((e) => e.deletedAt)).toHaveLength(2);
    expect([lot('Lote 1').heads, lot('Lote 2').heads]).toEqual([100, 50]);

    expect((await s().restoreEvent(b, entrada.id)).ok).toBe(true);
    expect([lot('Lote 1').heads, lot('Lote 2').heads]).toEqual([50, 100]);
  });

  it('não deixa apagar a transferência se o lote que recebeu já vendeu esses animais', async () => {
    const [a, b] = [lotId('Lote 1'), lotId('Lote 2')];
    await s().transferAnimals(a, b, 50, '2026-11-01');
    await s().addEvent(b, { type: 'animais_saida', date: '2026-11-05', heads: 80, reason: 'venda' });
    const saida = s().data!.events.find((e) => e.type === 'transf_out')!;
    // Apagando pela ponta de origem: sem os 50 recebidos, o Lote 2 ficaria com 50 e a venda de 80 não fecha.
    expect(err(await s().removeEvent(a, saida.id))).toBe('Lote 2 ficaria com menos de zero cabeças em 05/11/2026.');
    expect(s().data!.events.filter((e) => e.deletedAt)).toEqual([]);
  });
});
