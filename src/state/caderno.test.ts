import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { NewFarm, NotebookReport } from '../data/types';
import { deriveFarm } from '../lib/farm/farmView';
import { rainByDay, rainByMonth, rainOn } from '../lib/farm/rain';
import { orderEvents } from '../lib/lots/deriveLot';
import {
  dropQueued,
  emptyNotebookState,
  enqueue,
  localNotebookStorage,
  pendingCount,
  refreshContext,
  syncQueue,
} from '../lib/notebook/queue';
import { exampleNewFarm, NOW, TODAY } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;
let token = '';

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);
const novos = () => s().data!.reports.filter((r) => r.status === 'novo');
let n = 0;
const relato = (over: Partial<NotebookReport>): NotebookReport => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  kind: 'chuva',
  date: TODAY,
  deviceCreatedAt: NOW().toISOString(),
  ...over,
});

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: '2026-10-01', heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
  await s().moveLot(lotId('Lote 1'), pid('P01'), '2026-11-01');
  token = s().data!.farm.shareToken!;
});

describe('fila do caderno no aparelho', () => {
  it('a fazenda aberta traz o token do link, e o link dá só os nomes', async () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const c = await be.notebook.context(token);
    expect(c!.farmName).toBe('Fazenda Exemplo');
    expect(c!.paddocks).toHaveLength(13);
    expect(c!.lots).toEqual([{ id: lotId('Lote 1'), name: 'Lote 1' }]);
    expect(await be.notebook.context('x'.repeat(64))).toBeNull();
  });

  it('com sinal o relato sai da fila e chega como novo para o consultor', async () => {
    let st = enqueue(emptyNotebookState(), relato({ mm: 12, reporter: 'Zé' }));
    expect(pendingCount(st)).toBe(1);
    st = await syncQueue(st, be.notebook, token);
    expect(st.queue).toEqual([]);
    expect(st.sent).toHaveLength(1);
    expect(st.reporter).toBe('Zé');

    await s().refreshReports();
    expect(novos()).toMatchObject([{ kind: 'chuva', mm: 12, date: TODAY, reporter: 'Zé' }]);
  });

  it('sem sinal o relato espera na fila, na ordem, e vai inteiro quando o sinal volta', async () => {
    be.setOffline(true);
    let st = emptyNotebookState();
    st = enqueue(st, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P02'), date: '2026-11-10' }));
    st = enqueue(st, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P03'), date: '2026-11-14' }));
    st = await syncQueue(st, be.notebook, token);
    expect(pendingCount(st)).toBe(2);
    expect(st.sent).toEqual([]);

    // A fila sobrevive a fechar e abrir a página.
    localNotebookStorage.save(token, st);
    st = localNotebookStorage.load(token);
    expect(pendingCount(st)).toBe(2);

    be.setOffline(false);
    st = await syncQueue(st, be.notebook, token);
    expect(st.queue).toEqual([]);
    await s().refreshReports();
    expect(novos().map((r) => r.toPaddockId)).toEqual([pid('P02'), pid('P03')]);
  });

  it('reenviar o mesmo relato não duplica', async () => {
    const r = relato({ mm: 5 });
    await be.notebook.submit(token, r);
    await be.notebook.submit(token, r);
    await syncQueue(enqueue(emptyNotebookState(), r), be.notebook, token);
    await s().refreshReports();
    expect(novos()).toHaveLength(1);
  });

  it('recusa do servidor marca só aquele relato e os outros seguem', async () => {
    let st = emptyNotebookState();
    const ruim = relato({ kind: 'mudanca', lotId: 'lote-que-nao-existe', toPaddockId: pid('P02') });
    st = enqueue(st, ruim);
    st = enqueue(st, relato({ mm: 3 }));
    st = await syncQueue(st, be.notebook, token);
    expect(st.queue).toMatchObject([{ state: 'recusado', error: 'Lote não encontrado. Atualize a página.' }]);
    expect(st.sent).toHaveLength(1);
    // Recusado não é tentado de novo, e quem relatou pode apagar da lista.
    const calls = be.calls.length;
    st = await syncQueue(st, be.notebook, token);
    expect(be.calls.length).toBe(calls);
    expect(dropQueued(st, ruim.id).queue).toEqual([]);
  });

  it('a lista de piquetes e lotes fica guardada para abrir sem sinal; link trocado é avisado', async () => {
    let r = await refreshContext(emptyNotebookState(), be.notebook, token);
    expect(r).toMatchObject({ invalid: false, offline: false });
    expect(r.state.context!.lots).toHaveLength(1);

    be.setOffline(true);
    r = await refreshContext(r.state, be.notebook, token);
    expect(r).toMatchObject({ invalid: false, offline: true });
    expect(r.state.context!.paddocks).toHaveLength(13);

    be.setOffline(false);
    expect((await s().rotateShareToken()).ok).toBe(true);
    expect(s().data!.farm.shareToken).not.toBe(token);
    r = await refreshContext(r.state, be.notebook, token);
    expect(r.invalid).toBe(true);
    const st = await syncQueue(enqueue(r.state, relato({ mm: 1 })), be.notebook, token);
    expect(st.queue[0]).toMatchObject({ state: 'recusado', error: 'Este link do caderno não vale mais. Peça o link novo.' });
  });
});

describe('consultor revisa e lança', () => {
  it('lança a mudança de gado como saída e entrada do lote, e o relato sai dos novos', async () => {
    await be.notebook.submit(token, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P02'), date: '2026-11-13' }));
    await s().refreshReports();
    const [r] = novos();

    expect((await s().launchMoveReport(r.id)).ok).toBe(true);
    expect(novos()).toEqual([]);
    expect(s().data!.reports[0].status).toBe('lancado');
    const moves = orderEvents(s().data!.events).filter((e) => e.date === '2026-11-13');
    expect(moves.map((e) => e.type)).toEqual(['piquete_saida', 'piquete_entrada']);
    expect(moves[0].seq!).toBeLessThan(moves[1].seq!);
    const v = deriveFarm(s().data!, TODAY);
    expect(v.paddockById.get(pid('P02'))!.occupants).toHaveLength(1);
    expect(v.paddockById.get(pid('P01'))!.restDays).toBe(2);
    expect(err(await s().launchMoveReport(r.id))).toBe('Esse relato já foi lançado ou descartado.');
  });

  it('mudança que não fecha com o histórico é recusada com o motivo, e pode ser corrigida e lançada', async () => {
    await be.notebook.submit(token, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P01'), date: '2026-11-13' }));
    await be.notebook.submit(token, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P02'), date: '2026-10-20' }));
    await s().refreshReports();
    const [mesmo, antiga] = novos();
    const events = s().data!.events.length;

    expect(err(await s().launchMoveReport(mesmo.id))).toBe('O lote já está nesse piquete.');
    expect(err(await s().launchMoveReport(antiga.id))).toMatch(/A entrada atual foi em 01\/11\/2026/);
    expect(s().data!.events).toHaveLength(events);
    expect(novos()).toHaveLength(2);

    expect(err(await s().updateReport(antiga.id, { date: '2026-12-01' }))).toBe('A data não pode ser depois de hoje.');
    expect((await s().updateReport(antiga.id, { date: '2026-11-12' })).ok).toBe(true);
    expect((await s().launchMoveReport(antiga.id)).ok).toBe(true);
    expect((await s().discardReport(mesmo.id)).ok).toBe(true);
    expect(novos()).toEqual([]);
  });

  it('descarta e devolve para novo; relato lançado não muda mais', async () => {
    await be.notebook.submit(token, relato({ mm: 7 }));
    await s().refreshReports();
    const [r] = novos();
    expect((await s().discardReport(r.id)).ok).toBe(true);
    expect(err(await s().launchRainReport(r.id, 'somar'))).toBe('Esse relato já foi lançado ou descartado.');
    expect((await s().reopenReport(r.id)).ok).toBe(true);
    expect((await s().launchRainReport(r.id, 'somar')).ok).toBe(true);
    expect(err(await s().discardReport(r.id))).toBe('Esse relato já foi lançado ou descartado.');
    expect(err(await s().updateReport(r.id, { mm: 1 }))).toBe('Esse relato já foi lançado ou descartado.');
    expect(err(await s().reopenReport(r.id))).toBe('Só relato descartado volta para novo.');
  });

  it('chuva: somar acrescenta ao dia, substituir fica só com a nova, e o que está em memória bate com o servidor', async () => {
    expect((await s().addRain({ date: '2026-11-14', mm: 10 }, 'somar')).ok).toBe(true);
    await be.notebook.submit(token, relato({ mm: 6, date: '2026-11-14', reporter: 'Zé', note: 'de tarde' }));
    await be.notebook.submit(token, relato({ mm: 20, date: '2026-11-14' }));
    await s().refreshReports();
    const [a, b] = novos();

    expect((await s().launchRainReport(a.id, 'somar')).ok).toBe(true);
    expect(rainOn(s().data!.rain, '2026-11-14')).toBe(16);
    expect(s().data!.rain.find((r) => r.reportId === a.id)!.note).toBe('relato de Zé: de tarde');

    expect((await s().launchRainReport(b.id, 'substituir')).ok).toBe(true);
    expect(rainOn(s().data!.rain, '2026-11-14')).toBe(20);
    expect(s().data!.rain).toHaveLength(1);

    await s().refresh();
    expect(rainOn(s().data!.rain, '2026-11-14')).toBe(20);
    expect(s().data!.rain).toHaveLength(1);
    expect(s().data!.reports.map((r) => r.status)).toEqual(['lancado', 'lancado']);
  });

  it('valida a chuva do consultor e apaga uma leitura de forma suave', async () => {
    expect(err(await s().addRain({ date: '2026-11-16', mm: 5 }, 'somar'))).toBe('A data não pode ser depois de hoje.');
    expect(err(await s().addRain({ date: '2026-11-10', mm: -1 }, 'somar'))).toMatch(/de 0 a 500/);
    expect(err(await s().addRain({ date: '2026-11-10', mm: Number.NaN }, 'somar'))).toMatch(/de 0 a 500/);
    await s().addRain({ date: '2026-11-10', mm: 0 }, 'somar');
    await s().addRain({ date: '2026-11-10', mm: 4.5 }, 'somar');
    await s().addRain({ date: '2026-10-30', mm: 30 }, 'somar');

    // Dia com leitura de 0 mm é dia medido, diferente de dia sem leitura.
    expect(rainOn(s().data!.rain, '2026-11-10')).toBe(4.5);
    expect(rainOn(s().data!.rain, '2026-11-09')).toBeNull();
    expect(rainByDay(s().data!.rain).map((d) => [d.date, d.mm, d.records.length])).toEqual([
      ['2026-11-10', 4.5, 2],
      ['2026-10-30', 30, 1],
    ]);
    expect(rainByMonth(s().data!.rain)).toEqual([
      { month: '2026-11', mm: 4.5, days: 1 },
      { month: '2026-10', mm: 30, days: 1 },
    ]);

    const leitura = s().data!.rain.find((r) => r.mm === 4.5)!;
    expect((await s().removeRain(leitura.id)).ok).toBe(true);
    expect(rainOn(s().data!.rain, '2026-11-10')).toBe(0);
    await s().refresh();
    expect(s().data!.rain).toHaveLength(2);
  });

  it('sem sinal, lançar dá erro claro e o relato continua novo', async () => {
    await be.notebook.submit(token, relato({ mm: 7 }));
    await s().refreshReports();
    const [r] = novos();
    be.setOffline(true);
    expect(err(await s().launchRainReport(r.id, 'somar'))).toBe('Sem resposta do servidor. Confira o sinal e tente de novo.');
    expect(novos()).toHaveLength(1);
    // Conferir relatos sem sinal não derruba nada.
    await s().refreshReports();
    expect(novos()).toHaveLength(1);
  });

  it('quem não tem vínculo não lê o caderno da fazenda', async () => {
    await be.notebook.submit(token, relato({ mm: 7 }));
    const farmId = nf.farm.id;
    await s().signOut();
    await be.signInAs('bruno@exemplo.test');
    await expect(be.repo.listReports(farmId)).rejects.toThrow('Sua conta não tem acesso a essa fazenda.');
  });
});
