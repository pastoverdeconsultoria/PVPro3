import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { Module, NewFarm } from '../data/types';
import { deriveFarm } from '../lib/farm/farmView';
import { compositionAt } from '../lib/farm/modules';
import { orderEvents } from '../lib/lots/deriveLot';
import { exampleNewFarm, NOW, TODAY } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;

const s = () => store.getState();
const view = () => deriveFarm(s().data!, TODAY);
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const lotView = (name: string) => view().lotById.get(lotId(name))!;
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

async function openedFarm() {
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  expect(await s().createFarm(nf)).toEqual({ ok: true, value: undefined });
}

beforeEach(() => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
});

describe('entrada no app', () => {
  it('sem conta fica na tela de entrada; criar conta entra direto', async () => {
    await s().init();
    expect(s().phase).toBe('signedOut');
    expect(err(await s().signIn('ana@exemplo.test', 'errada'))).toBe('E-mail ou senha incorretos.');
    expect(err(await s().signUp('ana@exemplo.test', '123'))).toBe('A senha precisa ter pelo menos 6 caracteres.');
    expect((await s().signUp(' ana@exemplo.test ', 'segredo-teste')).ok).toBe(true);
    expect(s().phase).toBe('signedIn');
    expect(s().user?.email).toBe('ana@exemplo.test');
    expect(s().farmsReady).toBe(true);
    expect(s().farms).toEqual([]);
  });

  it('quem já entrou continua dentro ao reabrir o app', async () => {
    await be.signInAs('ana@exemplo.test');
    await s().init();
    expect(s().phase).toBe('signedIn');
  });

  it('abre a fazenda criada e reabre a mesma na próxima vez', async () => {
    await openedFarm();
    expect(s().farmId).toBe(nf.farm.id);
    expect(s().data!.paddocks).toHaveLength(13);

    const again = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
    await again.getState().init();
    expect(again.getState().farmId).toBe(nf.farm.id);
    expect(again.getState().data!.farm.name).toBe('Fazenda Exemplo');
  });

  it('um segundo usuário sem vínculo não enxerga nada', async () => {
    await openedFarm();
    await s().signOut();
    expect(s().phase).toBe('signedOut');
    expect(s().data).toBeNull();

    await be.signInAs('bruno@exemplo.test');
    expect(s().phase).toBe('signedIn');
    await Promise.resolve();
    await s().loadFarms();
    expect(s().farms).toEqual([]);
    await s().openFarm(nf.farm.id);
    expect(s().data).toBeNull();
    expect(s().loadError).toBe('Sua conta não tem acesso a essa fazenda.');
  });
});

describe('lotes', () => {
  beforeEach(openedFarm);

  const novo = { name: 'Lote 1', date: '2026-10-01', heads: 90, weightKg: 450, category: 'Vacas', weighed: false };

  it('cria o lote pelo registro de formação e mostra que ele ainda não entrou em piquete', async () => {
    expect((await s().createLot(novo)).ok).toBe(true);
    const l = lotView('Lote 1');
    expect(l).toMatchObject({ heads: 90, weightKg: 450, category: 'Vacas', ua: 90 });
    expect(l.location).toEqual({ kind: 'sem_movimentacao' });
    expect(s().data!.events.every((e) => typeof e.seq === 'number')).toBe(true);
  });

  it('recusa lote sem nome, repetido, com data futura ou sem cabeças', async () => {
    expect(err(await s().createLot({ ...novo, name: ' ' }))).toBe('O lote precisa de nome.');
    expect(err(await s().createLot({ ...novo, date: '2026-11-16' }))).toBe('A data não pode ser depois de hoje.');
    expect(err(await s().createLot({ ...novo, heads: 0 }))).toBe('Informe o número de cabeças.');
    await s().createLot(novo);
    expect(err(await s().createLot({ ...novo, name: 'lote 1' }))).toBe('Já existe um lote chamado lote 1.');
    expect(s().data!.lots).toHaveLength(1);
  });

  it('peso de balança na formação já grava a primeira pesagem', async () => {
    await s().createLot({ ...novo, weighed: true });
    expect(s().data!.events.map((e) => e.type)).toEqual(['inicio', 'pesagem']);
    expect(lotView('Lote 1').lastWeigh).toBe('2026-10-01');
  });

  it('mover grava saída e entrada juntas, saída antes, e o piquete de origem entra em descanso', async () => {
    await s().createLot(novo);
    const id = lotId('Lote 1');
    expect((await s().moveLot(id, pid('P01'), '2026-11-01')).ok).toBe(true);
    expect((await s().moveLot(id, pid('P02'), '2026-11-13')).ok).toBe(true);

    const moves = orderEvents(s().data!.events).filter((e) => e.date === '2026-11-13');
    expect(moves.map((e) => e.type)).toEqual(['piquete_saida', 'piquete_entrada']);
    expect(moves[0].seq!).toBeLessThan(moves[1].seq!);
    expect(moves[0].link).toBe(moves[1].link);

    const v = view();
    expect(v.paddockById.get(pid('P02'))!.occupants.map((o) => o.lot.name)).toEqual(['Lote 1']);
    expect(v.paddockById.get(pid('P01'))!.restDays).toBe(2);
    expect(be.calls.filter((c) => c === 'recordEvents')).toHaveLength(2);
  });

  it('mudança inválida não chega ao servidor', async () => {
    await s().createLot(novo);
    const id = lotId('Lote 1');
    await s().moveLot(id, pid('P01'), '2026-11-10');
    const before = be.calls.length;
    expect(err(await s().moveLot(id, pid('P01'), '2026-11-12'))).toBe('O lote já está nesse piquete.');
    expect(err(await s().moveLot(id, pid('P02'), '2026-11-05'))).toMatch(/A entrada atual foi em 10\/11\/2026/);
    expect(err(await s().moveLot(id, pid('P02'), '2026-11-16'))).toBe('A data não pode ser depois de hoje.');
    expect(err(await s().moveLot(id, pid('P02'), '2026-09-01'))).toBe('Lote 1 foi formado em 01/10/2026.');
    expect(be.calls.length).toBe(before);
  });

  it('pesagem, entrada e saída de animais recalculam peso, cabeças e UA', async () => {
    await s().createLot({ ...novo, heads: 100, weightKg: 300 });
    const id = lotId('Lote 1');
    expect((await s().addEvent(id, { date: '2026-10-10', type: 'pesagem', weightKg: 310 })).ok).toBe(true);
    expect((await s().addEvent(id, { date: '2026-10-20', type: 'animais_entrada', heads: 100, weightKg: 250, reason: 'compra' })).ok).toBe(true);
    expect((await s().addEvent(id, { date: '2026-10-25', type: 'animais_saida', heads: 20, reason: 'venda' })).ok).toBe(true);
    const l = lotView('Lote 1');
    expect(l.heads).toBe(180);
    expect(l.weightKg).toBe(280);
    expect(l.ua).toBeCloseTo((180 * 280) / 450, 10);
  });

  it('recusa saída de mais animais do que o lote tem e registro antes da formação', async () => {
    await s().createLot(novo);
    const id = lotId('Lote 1');
    expect(err(await s().addEvent(id, { date: '2026-10-05', type: 'animais_saida', heads: 91 }))).toBe(
      'Lote 1 ficaria com menos de zero cabeças em 05/10/2026.',
    );
    expect(err(await s().addEvent(id, { date: '2026-09-30', type: 'pesagem', weightKg: 400 }))).toBe('Lote 1 foi formado em 01/10/2026.');
    expect(err(await s().addEvent(id, { date: '2026-10-05', type: 'suplemento', pctPv: 3 }))).toMatch(/0 a 2,5%/);
    expect(s().data!.events).toHaveLength(1);
  });

  it('apagar uma mudança leva a saída e a entrada juntas, e dá para desfazer', async () => {
    await s().createLot(novo);
    const id = lotId('Lote 1');
    await s().moveLot(id, pid('P01'), '2026-11-01');
    await s().moveLot(id, pid('P02'), '2026-11-13');
    const entrada = s().data!.events.find((e) => e.type === 'piquete_entrada' && e.date === '2026-11-13')!;

    expect((await s().removeEvent(id, entrada.id)).ok).toBe(true);
    expect(s().data!.events.filter((e) => e.deletedAt)).toHaveLength(2);
    expect(lotView('Lote 1').location).toEqual({ kind: 'no_piquete', paddockId: pid('P01'), since: '2026-11-01' });

    expect((await s().restoreEvent(id, entrada.id)).ok).toBe(true);
    expect(s().data!.events.filter((e) => e.deletedAt)).toHaveLength(0);
    expect(lotView('Lote 1').location).toEqual({ kind: 'no_piquete', paddockId: pid('P02'), since: '2026-11-13' });
  });

  it('apagar a última pesagem devolve o peso anterior; a formação não pode ser apagada', async () => {
    await s().createLot({ ...novo, weightKg: 300 });
    const id = lotId('Lote 1');
    await s().addEvent(id, { date: '2026-10-10', type: 'pesagem', weightKg: 320 });
    await s().addEvent(id, { date: '2026-10-20', type: 'pesagem', weightKg: 340 });
    const last = s().data!.events.find((e) => e.type === 'pesagem' && e.date === '2026-10-20')!;
    await s().removeEvent(id, last.id);
    expect(lotView('Lote 1').weightKg).toBe(320);
    const inicio = s().data!.events.find((e) => e.type === 'inicio')!;
    expect(err(await s().removeEvent(id, inicio.id))).toBe('A formação do lote não pode ser excluída.');
  });

  it('excluir o lote libera o piquete e dá para restaurar', async () => {
    await s().createLot(novo);
    const id = lotId('Lote 1');
    await s().moveLot(id, pid('P01'), '2026-11-01');
    expect((await s().deleteLot(id)).ok).toBe(true);
    expect(view().lots).toEqual([]);
    expect(view().paddockById.get(pid('P01'))!.occupants).toEqual([]);
    expect((await s().restoreLot(id)).ok).toBe(true);
    expect(view().paddockById.get(pid('P01'))!.occupants).toHaveLength(1);
  });
});

describe('piquetes e módulos', () => {
  beforeEach(openedFarm);

  const modulo = (): Module => ({
    id: crypto.randomUUID(),
    farmId: nf.farm.id,
    name: 'Módulo A',
    color: '#5B8DEF',
    occupationDays: 5,
    plannedLotId: null,
    condition: 'extensiva',
    mRef: 40,
  });

  it('altera nome, capim, pastejo e última saída do piquete', async () => {
    const r = await s().updatePaddock(pid('P01'), { name: ' Piquete 1 ', species: 'Mombaça', isGrazing: false, initialLastExit: '2026-11-01' });
    expect(r.ok).toBe(true);
    const p = s().data!.paddocks.find((x) => x.id === pid('P01'))!;
    expect(p).toMatchObject({ name: 'Piquete 1', species: 'Mombaça', isGrazing: false, initialLastExit: '2026-11-01' });
    expect(err(await s().updatePaddock(pid('P02'), { name: '' }))).toBe('O piquete precisa de nome.');
    expect(err(await s().updatePaddock(pid('P02'), { initialLastExit: '2026-12-01' }))).toBe('A data não pode ser depois de hoje.');
  });

  it('grava o módulo com a ordem dos piquetes e guarda a versão anterior', async () => {
    const m = modulo();
    expect((await s().saveModule(m, { validFrom: '2026-10-01', paddockIds: [pid('P01'), pid('P02')] })).ok).toBe(true);
    expect((await s().saveModule({ ...m, occupationDays: 4 }, { validFrom: '2026-11-10', paddockIds: [pid('P02'), pid('P03'), pid('P01')] })).ok).toBe(true);

    const d = s().data!;
    expect(d.modules).toHaveLength(1);
    expect(d.modules[0].occupationDays).toBe(4);
    expect(compositionAt(d.compositions, m.id, '2026-10-15')).toEqual([pid('P01'), pid('P02')]);
    expect(compositionAt(d.compositions, m.id, TODAY)).toEqual([pid('P02'), pid('P03'), pid('P01')]);

    // O que está em memória bate com o que o servidor guardou.
    await s().refresh();
    expect(compositionAt(s().data!.compositions, m.id, TODAY)).toEqual([pid('P02'), pid('P03'), pid('P01')]);
    expect(compositionAt(s().data!.compositions, m.id, '2026-10-15')).toEqual([pid('P01'), pid('P02')]);
  });

  it('recusa piquete que já é de outro módulo e módulo sem piquete', async () => {
    const a = modulo();
    await s().saveModule(a, { validFrom: '2026-10-01', paddockIds: [pid('P01')] });
    const b = { ...modulo(), name: 'Módulo B' };
    expect(err(await s().saveModule(b, { validFrom: TODAY, paddockIds: [pid('P01')] }))).toBe('P01 já está no Módulo A. Tire de lá primeiro.');
    expect(err(await s().saveModule(b, { validFrom: TODAY, paddockIds: [] }))).toMatch(/pelo menos um piquete/);
    expect(err(await s().saveModule(b))).toBe('O módulo precisa de pelo menos um piquete.');
    expect(err(await s().saveModule({ ...b, occupationDays: 0 }, { validFrom: TODAY, paddockIds: [pid('P02')] }))).toMatch(/1 a 365/);
    expect(s().data!.modules).toHaveLength(1);
  });

  it('excluir o módulo solta os piquetes dele', async () => {
    const a = modulo();
    await s().saveModule(a, { validFrom: '2026-10-01', paddockIds: [pid('P01')] });
    expect((await s().deleteModule(a.id)).ok).toBe(true);
    expect(s().data!.modules).toEqual([]);
    const b = { ...modulo(), name: 'Módulo B' };
    expect((await s().saveModule(b, { validFrom: TODAY, paddockIds: [pid('P01')] })).ok).toBe(true);
  });
});

describe('sem sinal', () => {
  beforeEach(openedFarm);

  it('reabre o app com a cópia salva no aparelho e avisa que é cópia', async () => {
    await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
    await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-01');
    be.setOffline(true);

    const again = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
    await again.getState().init();
    const st = again.getState();
    expect(st.phase).toBe('signedIn');
    expect(st.farms.map((f) => f.name)).toEqual(['Fazenda Exemplo']);
    expect(st.staleSince).not.toBeNull();
    expect(st.loadError).toBeNull();
    const v = deriveFarm(st.data!, TODAY);
    expect(v.paddockById.get(pid('P01'))!.occupants.map((o) => o.lot.name)).toEqual(['Lote 1']);
  });

  it('ação de escritório sem sinal dá erro claro e não muda o que está na tela', async () => {
    be.setOffline(true);
    const before = s().data;
    expect(err(await s().updatePaddock(pid('P01'), { name: 'Outro nome' }))).toBe(
      'Sem resposta do servidor. Confira o sinal e tente de novo.',
    );
    expect(s().data).toBe(before);
    // A ação de campo (mudança de gado) sem sinal é guardada e enviada depois: ver outbox.test.ts.
  });

  it('falha ao atualizar não apaga o que já estava na tela', async () => {
    be.setOffline(true);
    await s().refresh();
    expect(s().data!.paddocks).toHaveLength(13);
    expect(s().staleSince).not.toBeNull();
    be.setOffline(false);
    await s().refresh();
    expect(s().staleSince).toBeNull();
  });

  it('sair da conta apaga a cópia do aparelho', async () => {
    expect(Object.keys(localStorage).some((k) => k.startsWith('pvpro3:'))).toBe(true);
    await s().signOut();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('pvpro3:'))).toEqual([]);
  });
});
