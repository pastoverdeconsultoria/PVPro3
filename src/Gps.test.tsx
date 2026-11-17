import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { areaWeightedCentroid, pointInPolygon, pointInRing } from './lib/geo';
import { addDays, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// GPS: "onde estou" no mapa do consultor e no caderno do vaqueiro.

let be: MemoryBackend;
let store: AppStore;
const s = () => store.getState();
const paddock = (name: string) => s().data!.paddocks.find((p) => p.name === name)!;
/** Um ponto bem no meio do piquete. */
const middle = (name: string) => areaWeightedCentroid([paddock(name).geom.coordinates[0].slice(0, -1)])!;

type Watcher = { ok: PositionCallback; fail: PositionErrorCallback | null | undefined };
let watchers: Watcher[] = [];
const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
const fix = (lat: number, lon: number, accuracy = 6) =>
  act(() => watchers.forEach((w) => w.ok({ coords: { latitude: lat, longitude: lon, accuracy } } as GeolocationPosition)));

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
  watchers = [];
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: PositionCallback, fail?: PositionErrorCallback | null) => watchers.push({ ok, fail }),
      clearWatch: (id: number) => {
        watchers[id - 1] = { ok: () => undefined, fail: null };
      },
    },
  });
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  await s().createFarm(exampleNewFarm());
});

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'geolocation', original);
  else delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('ponto dentro do polígono', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  it('reconhece dentro, fora e o buraco', () => {
    expect(pointInRing([5, 5], square)).toBe(true);
    expect(pointInRing([11, 5], square)).toBe(false);
    expect(pointInRing([-0.1, 5], square)).toBe(false);
    expect(pointInPolygon([2, 2], [square, hole])).toBe(true);
    expect(pointInPolygon([5, 5], [square, hole])).toBe(false);
    expect(pointInPolygon([5, 5], [])).toBe(false);
  });
});

describe('onde estou, no mapa', () => {
  it('diz em que piquete o aparelho está, mostra o ponto e abre o cartão', async () => {
    const user = userEvent.setup();
    open('/mapa');
    expect(screen.queryByRole('img', { name: 'Você está aqui' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Onde estou/ }));
    expect(screen.getByText('Procurando o sinal do GPS…')).toBeTruthy();

    const c = middle('P07');
    fix(c.lat, c.lon, 8);
    const status = screen.getByLabelText('Minha posição');
    expect(within(status).getByRole('status').textContent).toBe('Você está em P07 (±8 m)');
    expect(screen.getByRole('img', { name: 'Você está aqui' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Piquete P07' })).toBeTruthy();

    // Andou para outro piquete: o texto acompanha, mas o cartão aberto não troca sozinho.
    const d = middle('P08');
    fix(d.lat, d.lon);
    expect(within(status).getByRole('status').textContent).toBe('Você está em P08 (±6 m)');
    expect(screen.getByRole('region', { name: 'Piquete P07' })).toBeTruthy();

    fix(0, 0);
    expect(within(status).getByRole('status').textContent).toMatch(/fora dos piquetes do mapa/);

    await user.click(screen.getByRole('button', { name: /Parar de me localizar/ }));
    expect(screen.queryByRole('img', { name: 'Você está aqui' })).toBeNull();
  });

  it('explica quando o aparelho não libera a localização', async () => {
    const user = userEvent.setup();
    open('/mapa');
    await user.click(screen.getByRole('button', { name: /Onde estou/ }));
    act(() => watchers.forEach((w) => w.fail?.({ code: 1 } as GeolocationPositionError)));
    expect(screen.getByText(/O aparelho não deixou usar a localização/)).toBeTruthy();
  });
});

describe('estou nesse pasto, no caderno', () => {
  it('o vaqueiro escolhe o destino pelo GPS', async () => {
    const user = userEvent.setup();
    await s().createLot({ name: 'Lote 1', date: addDays(todayLocal(), -30), heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
    await s().moveLot(s().data!.lots[0].id, paddock('P01').id, addDays(todayLocal(), -5));
    const c = middle('P04');
    const p01 = middle('P01');
    open(`/c/${s().data!.farm.shareToken}`);
    await user.type(await screen.findByLabelText('Seu nome'), 'Zé');
    await user.click(screen.getByRole('button', { name: 'PRONTO ✓' }));
    await user.click(screen.getByRole('button', { name: 'Mudei o gado' }));
    await user.click(screen.getByRole('button', { name: /^Lote 1/ }));

    await user.click(screen.getByRole('button', { name: /Estou nesse pasto agora/ }));
    expect(screen.getByText(/Procurando o GPS/)).toBeTruthy();
    // Ainda no pasto de onde o lote saiu: não serve de destino.
    fix(p01.lat, p01.lon);
    expect(screen.getByText(/Você está no P01, onde o lote já estava/)).toBeTruthy();

    fix(c.lat, c.lon);
    await user.click(screen.getByRole('button', { name: /Você está no P04/ }));
    expect(screen.getByText('Lote 1 ➜ P04')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'CONFIRMAR ✓' }));
    expect(await screen.findByText('Enviado!')).toBeTruthy();
    expect(await be.repo.listReports(s().farmId!)).toMatchObject([{ kind: 'mudanca', toPaddockId: paddock('P04').id }]);
  });
});
