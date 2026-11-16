import { createMemoryBackend } from './memoryRepo';
import { exampleNewFarm } from '../test/fixtures';
import { todayLocal } from '../lib/lots/dates';
import { createAppStore } from '../state/store';

/**
 * Só no desenvolvimento (`npm run dev`, endereço com ?demo): abre o app com a
 * fazenda inventada do simulador, em memória, para conferir as telas sem banco.
 * Os números são inventados. Não entra no app publicado.
 */
export async function demoBackend() {
  const be = createMemoryBackend();
  await be.signInAs('demo@exemplo.test');
  const store = createAppStore({ repo: be.repo, auth: be.auth });
  await store.getState().init();
  const farm = exampleNewFarm();
  await store.getState().createFarm(farm);
  const s = store.getState;
  const pid = (name: string) => farm.paddocks.find((p) => p.name === name)!.id;
  const day = (back: number) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return todayLocal(d);
  };

  await s().createLot({ name: 'Lote 1', date: day(60), heads: 420, weightKg: 262, category: 'Recria', weighed: true });
  await s().createLot({ name: 'Lote 2', date: day(60), heads: 380, weightKg: 440, category: 'Engorda', weighed: true });
  await s().createLot({ name: 'Lote 3', date: day(60), heads: 350, weightKg: 442, category: 'Vacas', weighed: false });
  const lot = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
  await s().addEvent(lot('Lote 1'), { type: 'pesagem', date: day(30), weightKg: 272 });
  await s().addEvent(lot('Lote 2'), { type: 'pesagem', date: day(30), weightKg: 454 });
  await s().addEvent(lot('Lote 2'), { type: 'suplemento', date: day(30), pctPv: 0.5 });

  const rounds: [string, string[], number[]][] = [
    ['Lote 1', ['P01', 'P02', 'P03'], [22, 12, 1]],
    ['Lote 2', ['P07', 'P08', 'P05'], [14, 8, 2]],
    ['Lote 3', ['P09', 'P10', 'P11', 'P12'], [30, 21, 12, 7]],
  ];
  for (const [name, paddocks, backs] of rounds) {
    for (let i = 0; i < paddocks.length; i++) await s().moveLot(lot(name), pid(paddocks[i]), day(backs[i]));
  }

  const colors = ['#5B8DEF', '#D08A4B', '#9B7BE0'];
  const groups = [['P01', 'P02', 'P03', 'P04'], ['P05', 'P06', 'P07', 'P08'], ['P09', 'P10', 'P11', 'P12']];
  for (let i = 0; i < 3; i++) {
    await s().saveModule(
      {
        id: crypto.randomUUID(),
        farmId: farm.farm.id,
        name: `Módulo ${'ABC'[i]}`,
        color: colors[i],
        occupationDays: [5, 4, 6][i],
        plannedLotId: lot(`Lote ${i + 1}`),
        condition: i === 1 ? 'adubada' : 'extensiva',
        mRef: i === 1 ? 105 : 40,
      },
      { validFrom: day(60), paddockIds: groups[i].map(pid) },
    );
  }
  // Caderno: dois relatos esperando revisão e um pouco de chuva registrada.
  const token = s().data!.farm.shareToken!;
  const now = new Date().toISOString();
  await be.notebook.submit(token, { id: crypto.randomUUID(), kind: 'mudanca', date: day(0), lotId: lot('Lote 2'), toPaddockId: pid('P06'), reporter: 'Zé', note: 'pasto no ponto', deviceCreatedAt: now });
  await be.notebook.submit(token, { id: crypto.randomUUID(), kind: 'chuva', date: day(1), mm: 18.5, reporter: 'Zé', deviceCreatedAt: now });
  await s().addRain({ date: day(1), mm: 4 }, 'somar');
  await s().addRain({ date: day(6), mm: 22 }, 'somar');
  await s().addRain({ date: day(9), mm: 0 }, 'somar');
  await s().refreshReports();
  console.info('Demonstração: link do caderno em', `${window.location.origin}/c/${token}?demo`);
  return { store, notebook: be.notebook };
}
