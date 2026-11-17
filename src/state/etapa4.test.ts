import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, type MemoryBackend } from '../data/memoryRepo';
import type { NewFarm } from '../data/types';
import { fakeClimateApi } from '../test/climateFixture';
import { exampleNewFarm, NOW } from '../test/fixtures';
import { createAppStore, type AppStore } from './store';

let be: MemoryBackend;
let store: AppStore;
let nf: NewFarm;
let climate: ReturnType<typeof fakeClimateApi>;

const s = () => store.getState();
const pid = (name: string) => nf.paddocks.find((p) => p.name === name)!.id;
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);
const newStore = () => createAppStore({ repo: be.repo, auth: be.auth, climate, now: NOW });

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  climate = fakeClimateApi();
  store = newStore();
  await be.signInAs('ana@exemplo.test');
  await s().init();
  nf = exampleNewFarm();
  await s().createFarm(nf);
});

describe('clima do centroide', () => {
  it('busca uma vez, guarda no aparelho e não busca de novo no mesmo dia', async () => {
    expect(s().climateState).toBe('idle');
    await s().loadClimate();
    expect(s().climateState).toBe('ready');
    expect(s().climate!.tmax.length).toBeGreaterThan(3650);
    // A coordenada sai arredondada para duas casas.
    expect([s().climate!.lat, s().climate!.lon]).toEqual([-14.86, -40.84]);
    expect(climate.calls).toBe(1);

    await s().loadClimate();
    expect(climate.calls).toBe(1);

    // Outro carregamento do app no mesmo dia usa a cópia.
    const again = newStore();
    await again.getState().init();
    await again.getState().loadClimate();
    expect(again.getState().climateState).toBe('ready');
    expect(climate.calls).toBe(1);

    await s().loadClimate(true);
    expect(climate.calls).toBe(2);
  });

  it('sem sinal usa a cópia e avisa; sem cópia, dá erro claro', async () => {
    climate.fail = true;
    await s().loadClimate();
    expect(s()).toMatchObject({ climateState: 'error', climate: null, climateError: 'Não deu para buscar o clima. Confira o sinal e tente de novo.' });

    climate.fail = false;
    await s().loadClimate();
    climate.fail = true;
    await s().loadClimate(true);
    expect(s()).toMatchObject({ climateState: 'ready', climateStale: true });
    expect(s().climate).not.toBeNull();
  });

  it('trocar de fazenda descarta o clima da anterior', async () => {
    await s().loadClimate();
    await s().openFarm(nf.farm.id);
    expect(s()).toMatchObject({ climate: null, climateState: 'idle' });
  });
});

describe('adubação', () => {
  it('valida, grava e apaga de forma suave', async () => {
    expect(err(await s().addFertilization({ paddockId: 'x', date: '2026-11-10', nKgHa: 40 }))).toBe('Escolha o piquete.');
    expect(err(await s().addFertilization({ paddockId: pid('P01'), date: '2026-11-16', nKgHa: 40 }))).toBe('A data não pode ser depois de hoje.');
    expect(err(await s().addFertilization({ paddockId: pid('P01'), date: '2026-11-10', nKgHa: 0 }))).toMatch(/de 1 a 500/);
    expect((await s().addFertilization({ paddockId: pid('P01'), date: '2026-11-10', nKgHa: 40, note: ' ureia ' })).ok).toBe(true);
    expect(s().data!.fertilizations).toMatchObject([{ paddockId: pid('P01'), date: '2026-11-10', nKgHa: 40, note: 'ureia' }]);

    await s().refresh();
    expect(s().data!.fertilizations).toHaveLength(1);
    expect((await s().removeFertilization(s().data!.fertilizations[0].id)).ok).toBe(true);
    await s().refresh();
    expect(s().data!.fertilizations).toEqual([]);
  });
});

describe('fazenda e acesso', () => {
  it('renomeia a fazenda na lista e na fazenda aberta', async () => {
    expect(err(await s().renameFarm({ name: ' ', municipality: '' }))).toBe('A fazenda precisa de nome.');
    expect((await s().renameFarm({ name: ' Fazenda Boa ', municipality: ' Poções, BA ' })).ok).toBe(true);
    expect(s().data!.farm).toMatchObject({ name: 'Fazenda Boa', municipality: 'Poções, BA' });
    expect(s().farms[0].name).toBe('Fazenda Boa');
    await s().refresh();
    expect(s().data!.farm.name).toBe('Fazenda Boa');
  });

  it('o dono dá acesso a uma conta existente, e ela passa a enxergar a fazenda; depois tira', async () => {
    const bruno = await be.signInAs('bruno@exemplo.test');
    await be.signInAs('ana@exemplo.test');

    expect((await s().loadMembers()).ok).toBe(true);
    expect(s().members).toMatchObject([{ email: 'ana@exemplo.test', role: 'owner' }]);
    expect(err(await s().addMember('sem-arroba'))).toBe('Informe o e-mail da conta.');
    expect(err(await s().addMember('ninguem@exemplo.test'))).toMatch(/Não existe conta com esse e-mail/);
    expect((await s().addMember(' Bruno@Exemplo.test ')).ok).toBe(true);
    expect(s().members!.map((m) => [m.email, m.role])).toEqual([
      ['ana@exemplo.test', 'owner'],
      ['bruno@exemplo.test', 'member'],
    ]);

    await be.signInAs('bruno@exemplo.test');
    expect((await be.repo.listFarms()).map((f) => f.name)).toEqual(['Fazenda Exemplo']);
    // Quem não é dono não mexe no acesso.
    await expect(be.repo.addMember(nf.farm.id, 'ana@exemplo.test')).rejects.toThrow('Só o dono');

    await be.signInAs('ana@exemplo.test');
    expect(err(await s().removeMember(s().user!.id))).toBe('Você não pode tirar o próprio acesso.');
    expect((await s().removeMember(bruno.id)).ok).toBe(true);
    expect(s().members).toHaveLength(1);
    await be.signInAs('bruno@exemplo.test');
    expect(await be.repo.listFarms()).toEqual([]);
  });
});
