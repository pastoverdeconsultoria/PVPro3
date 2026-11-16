import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { nf } from './lib/format';
import { addDays, formatBr, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// Etapa 3 na tela: ocorrida e global do ciclo no cartão do piquete, e a Análise.

let be: MemoryBackend;
let store: AppStore;
const s = () => store.getState();
const today = () => todayLocal();
const paddock = (name: string) => s().data!.paddocks.find((p) => p.name === name)!;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;
const LAZY_WAIT = { timeout: 20_000 };

function open(path: string) {
  return render(
    <AppProvider store={store} notebook={be.notebook}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  await s().createFarm(exampleNewFarm());
});

/** Lote de 90 UA: 10 dias em P01 (de 20 a 10 dias atrás) e desde então em P02. */
async function history() {
  await s().createLot({ name: 'Lote 1', date: addDays(today(), -40), heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
  await s().moveLot(lotId('Lote 1'), paddock('P01').id, addDays(today(), -20));
  await s().moveLot(lotId('Lote 1'), paddock('P02').id, addDays(today(), -10));
}

describe('cartão do piquete', () => {
  it('em descanso mostra a ocorrida do último pastejo e a global do ciclo, sem acumulado do ano', async () => {
    const user = userEvent.setup();
    await history();
    open('/mapa');

    // No mapa, o piquete em descanso leva a global do ciclo no rótulo.
    const area = paddock('P01').areaHa;
    const ciclo = nf((90 * 10) / area / 21, 2);
    await user.click(screen.getByRole('button', { name: `P01, 10 d, global ${ciclo}` }));

    const card = screen.getByRole('region', { name: 'Piquete P01' });
    expect(within(card).getByText(/Último pastejo: Lote 1, de .* \(10 dias\)\./)).toBeTruthy();
    expect(card.textContent).toContain(`Lotação ocorrida: ${nf(90 / area, 2)} UA/ha`);
    expect(card.textContent).toContain(`Global do ciclo: ${ciclo} UA/ha`);
    expect(card.textContent).not.toMatch(/anual|no ano/i);
  });

  it('ocupado mostra a instantânea e a ocorrida até agora', async () => {
    const user = userEvent.setup();
    await history();
    open('/mapa');
    await user.click(screen.getByRole('button', { name: /^P02, / }));
    const card = screen.getByRole('region', { name: 'Piquete P02' });
    const v = nf(90 / paddock('P02').areaHa, 2);
    expect(card.textContent).toContain('lotação instantânea · dia 11 de uso');
    expect(card.textContent).toContain(`Ocorrida até agora: ${v} UA/ha, em 11 dias de pastejo.`);
  });

  it('com suplemento mostra também a lotação de pasto', async () => {
    const user = userEvent.setup();
    await history();
    await s().addEvent(lotId('Lote 1'), { type: 'suplemento', date: addDays(today(), -10), pctPv: 1 });
    open('/mapa');
    await user.click(screen.getByRole('button', { name: /^P02, / }));
    const card = screen.getByRole('region', { name: 'Piquete P02' });
    const area = paddock('P02').areaHa;
    expect(card.textContent).toContain(`${nf(90 / area, 2)} UA/ha (${nf((90 * 0.72) / area, 2)} de pasto)`);
    // O percentual de capim substituído não aparece em lugar nenhum.
    expect(card.textContent).not.toMatch(/28\s?%|72\s?%/);
  });
});

describe('análise', () => {
  it('sem movimentação diz que não há histórico', async () => {
    open('/analise');
    expect(await screen.findByText('Sem histórico ainda', undefined, LAZY_WAIT)).toBeTruthy();
  });

  it('mostra a lotação do período registrado, avisa que ainda não é um ano e ordena os piquetes', async () => {
    const user = userEvent.setup();
    await history();
    open('/analise');

    const hero = await screen.findByRole('region', { name: 'Lotação global no período' }, LAZY_WAIT);
    const util = s().data!.paddocks.filter((p) => p.isGrazing).reduce((sum, p) => sum + p.areaHa, 0);
    expect(hero.textContent).toContain('Lotação global no período');
    expect(hero.textContent).toContain(`${nf(90 / util, 2)}UA/ha`);
    expect(hero.textContent).toContain(`${nf(90 * 21, 0)} UA-dia em ${nf(util, 1)} ha úteis.`);
    expect(screen.getByText(new RegExp(`${formatBr(addDays(today(), -20))} a ${formatBr(today())} · 21 dias`))).toBeTruthy();
    expect(screen.getByText(/O registro tem 21 dias\. A lotação anual só fecha com um ano/)).toBeTruthy();

    // Sem módulo montado, todos os piquetes de pastejo caem em "Sem módulo".
    const ranking = screen.getByRole('region', { name: 'Ranking dos piquetes' });
    expect(within(ranking).getByText('Sem módulo')).toBeTruthy();
    const names = () => Array.from(ranking.querySelectorAll('ol li b')).map((b) => b.textContent);
    expect(names()).toHaveLength(12);
    // P02 (11 dias, piquete maior) e P01 (10 dias) na frente; os dez nunca pastejados depois.
    expect(new Set(names().slice(0, 2))).toEqual(new Set(['P01', 'P02']));
    expect(within(ranking).getAllByText(/não pastejado/)).toHaveLength(10);
    expect(within(ranking).getByText(new RegExp(`10 d de pastejo · 1 período · ocorrida média ${nf(90 / paddock('P01').areaHa, 2).replace('.', '\\.')}`))).toBeTruthy();

    await user.click(within(ranking).getByRole('button', { name: 'Fazenda toda' }));
    expect(within(ranking).getByText('Fazenda toda', { selector: 'h3' })).toBeTruthy();
    expect(names()).toHaveLength(12);

    // A reserva não é pastejo e não entra no ranking.
    expect(names()).not.toContain('Reserva legal');
    expect(screen.getByText(/Projeção de capacidade de suporte/)).toBeTruthy();
  });

  it('com módulo montado, agrupa o ranking e mostra a lotação do módulo', async () => {
    await history();
    await s().saveModule(
      { id: crypto.randomUUID(), farmId: s().data!.farm.id, name: 'Módulo A', color: '#5B8DEF', occupationDays: 5, plannedLotId: null, condition: 'extensiva', mRef: 40 },
      { validFrom: addDays(today(), -30), paddockIds: [paddock('P01').id, paddock('P02').id, paddock('P03').id] },
    );
    open('/analise');
    const modules = await screen.findByRole('region', { name: 'Módulos no período' }, LAZY_WAIT);
    const area = paddock('P01').areaHa + paddock('P02').areaHa + paddock('P03').areaHa;
    expect(modules.textContent).toContain('Módulo A');
    expect(modules.textContent).toContain(nf(90 / area, 2));

    const ranking = screen.getByRole('region', { name: 'Ranking dos piquetes' });
    expect(within(ranking).getByText('Módulo A', { selector: 'h3' })).toBeTruthy();
    expect(within(ranking).getByText('Sem módulo', { selector: 'h3' })).toBeTruthy();
  });
});
