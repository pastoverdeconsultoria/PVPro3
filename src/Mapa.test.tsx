import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { addDays, formatBr, todayLocal } from './lib/lots/dates';
import { orderEvents } from './lib/lots/deriveLot';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

let be: MemoryBackend;
let store: AppStore;
const s = () => store.getState();
const today = () => todayLocal();
const paddock = (name: string) => s().data!.paddocks.find((p) => p.name === name)!;

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

describe('zoom do mapa', () => {
  const box = (svg: Element) => svg.getAttribute('viewBox')!.split(' ').map(Number);

  it('aproxima, afasta e volta ao mapa inteiro; tocar no piquete continua funcionando', async () => {
    const user = userEvent.setup();
    open('/mapa');
    const map = screen.getByRole('group', { name: 'Piquetes da fazenda' });
    const zoom = screen.getByRole('group', { name: 'Zoom do mapa' });
    const [, , w0, h0] = box(map);
    expect((within(zoom).getByRole('button', { name: 'Afastar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(zoom).queryByRole('button', { name: 'Ver o mapa inteiro' })).toBeNull();

    await user.click(within(zoom).getByRole('button', { name: 'Aproximar' }));
    const [, , w1, h1] = box(map);
    expect(w1).toBeCloseTo(w0 / 1.6, 3);
    expect(h1).toBeCloseTo(h0 / 1.6, 3);

    // Com zoom, o piquete tocado ainda abre o cartão.
    await user.click(screen.getByRole('button', { name: /^P06, / }));
    expect(screen.getByRole('region', { name: 'Piquete P06' })).toBeTruthy();

    // O zoom tem teto (8 vezes) e o botão trava ao chegar nele.
    for (let i = 0; i < 6; i++) await user.click(within(zoom).getByRole('button', { name: 'Aproximar' }));
    expect(box(map)[2]).toBeCloseTo(w0 / 8, 3);
    expect((within(zoom).getByRole('button', { name: 'Aproximar' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(zoom).getByRole('button', { name: 'Ver o mapa inteiro' }));
    expect(box(map)[2]).toBeCloseTo(w0, 6);
    expect(box(map)[3]).toBeCloseTo(h0, 6);
    expect(within(zoom).queryByRole('button', { name: 'Ver o mapa inteiro' })).toBeNull();
  });

  it('arrastar o mapa com zoom move a vista e não seleciona piquete', async () => {
    const user = userEvent.setup();
    open('/mapa');
    const map = screen.getByRole('group', { name: 'Piquetes da fazenda' });
    // O jsdom não calcula tamanho na tela; damos um ao mapa para o arrasto ter escala.
    map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240, toJSON: () => ({}) });
    await user.click(screen.getByRole('button', { name: 'Aproximar' }));
    const x0 = box(map)[0];

    const alvo = screen.getByRole('button', { name: /^P06, / });
    fireEvent.pointerDown(alvo, { pointerId: 1, clientX: 200, clientY: 120 });
    fireEvent.pointerMove(alvo, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(alvo, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.click(alvo);

    expect(box(map)[0]).toBeGreaterThan(x0);
    expect(screen.queryByRole('region', { name: 'Piquete P06' })).toBeNull();
    // O toque seguinte, sem arrastar, seleciona normalmente.
    fireEvent.pointerDown(alvo, { pointerId: 2, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(alvo, { pointerId: 2, clientX: 140, clientY: 120 });
    fireEvent.click(alvo);
    expect(screen.getByRole('region', { name: 'Piquete P06' })).toBeTruthy();
  });
});

describe('corrigir data pelo histórico', () => {
  it('o botão Data troca a data da mudança inteira e o registro antigo vai para Apagados', async () => {
    const user = userEvent.setup();
    await s().createLot({ name: 'Lote 1', date: addDays(today(), -40), heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
    await s().moveLot(s().data!.lots[0].id, paddock('P01').id, addDays(today(), -5));
    open('/rebanho');

    await user.click(within(screen.getByRole('region', { name: 'Lote 1' })).getByRole('button', { name: 'Histórico' }));
    const hist = screen.getByRole('dialog', { name: 'Histórico de Lote 1' });
    await user.click(within(hist).getByRole('button', { name: 'Corrigir a data: Entrou em P01' }));
    const campo = within(hist).getByLabelText('Nova data: Entrou em P01');
    fireEvent.change(campo, { target: { value: addDays(today(), 3) } });
    await user.click(within(hist).getByRole('button', { name: 'Gravar data' }));
    expect(within(hist).getByRole('alert').textContent).toBe('A data não pode ser depois de hoje.');

    fireEvent.change(campo, { target: { value: addDays(today(), -12) } });
    await user.click(within(hist).getByRole('button', { name: 'Gravar data' }));
    await waitFor(() => expect(within(hist).getByText('Apagados (1)')).toBeTruthy());
    expect(within(within(hist).getByRole('list', { name: 'Registros' })).getByText(formatBr(addDays(today(), -12)))).toBeTruthy();
    const entradas = orderEvents(s().data!.events).filter((e) => e.type === 'piquete_entrada');
    expect(entradas.map((e) => e.date)).toEqual([addDays(today(), -12)]);
  });
});
