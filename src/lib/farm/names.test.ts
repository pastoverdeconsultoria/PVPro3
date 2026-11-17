import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../data/memoryRepo';
import { createAppStore } from '../../state/store';
import { exampleNewFarm, NOW } from '../../test/fixtures';
import { byName, cleanPaddockName, groupOf, namesToClean } from './names';

describe('nomes de piquete', () => {
  it('tira a área escrita junto do nome, em qualquer das formas comuns', () => {
    expect(cleanPaddockName('A1 — 15.7 ha')).toBe('A1');
    expect(cleanPaddockName('Bloco A – 24,69 ha')).toBe('Bloco A');
    expect(cleanPaddockName('P3 - 12 ha')).toBe('P3');
    expect(cleanPaddockName('Pasto 4 (18,5 ha)')).toBe('Pasto 4');
    expect(cleanPaddockName('Feno (B) – 14,46 ha')).toBe('Feno (B)');
    expect(cleanPaddockName('B10: 3.0 HA')).toBe('B10');
    // Nome sem área, ou que é só a área, fica como está.
    expect(cleanPaddockName('Setor 9')).toBe('Setor 9');
    expect(cleanPaddockName('Pasto da Chácara')).toBe('Pasto da Chácara');
    expect(cleanPaddockName('- 15 ha')).toBe('- 15 ha');
  });

  it('não limpa quando o nome limpo já é de outro piquete', () => {
    const list = [
      { id: '1', name: 'A1 — 15.7 ha' },
      { id: '2', name: 'A1' },
      { id: '3', name: 'A2 — 9 ha' },
      { id: '4', name: 'A2 - 8 ha' },
    ];
    expect(namesToClean(list)).toEqual([{ id: '3', from: 'A2 — 9 ha', to: 'A2' }]);
  });

  it('agrupa pela pasta do mapa ou pela letra do nome, e ordena A2 antes de A10', () => {
    expect(groupOf({ name: 'A12 — 8.9 ha', folder: null })).toBe('A');
    expect(groupOf({ name: 'Setor 3', folder: null })).toBe('Setor');
    expect(groupOf({ name: '7', folder: null })).toBe('Outros');
    expect(groupOf({ name: 'Setor 3', folder: 'Bloco C – 19,61 ha' })).toBe('Bloco C');
    expect(['A10', 'B1', 'A2', 'A1'].sort(byName)).toEqual(['A1', 'A2', 'A10', 'B1']);
  });
});

describe('limpar os nomes da fazenda aberta', () => {
  let store: ReturnType<typeof createAppStore>;
  beforeEach(async () => {
    localStorage.clear();
    const be = createMemoryBackend();
    store = createAppStore({ repo: be.repo, auth: be.auth, now: NOW });
    await be.signInAs('ana@exemplo.test');
    await store.getState().init();
    const nf = exampleNewFarm();
    nf.paddocks = nf.paddocks.map((p, i) => (i < 3 ? { ...p, name: `${p.name} — ${p.areaHa.toFixed(1)} ha` } : p));
    await store.getState().createFarm(nf);
  });

  it('troca só os nomes sujos, no servidor e na tela', async () => {
    const s = () => store.getState();
    expect(s().data!.paddocks[0].name).toMatch(/^P01 — [\d.]+ ha$/);
    expect(await s().cleanPaddockNames()).toEqual({ ok: true, value: 3 });
    expect(s().data!.paddocks.slice(0, 4).map((p) => p.name)).toEqual(['P01', 'P02', 'P03', 'P04']);
    await s().refresh();
    expect(s().data!.paddocks[0].name).toBe('P01');
    expect(await s().cleanPaddockNames()).toEqual({ ok: true, value: 0 });
  });
});
