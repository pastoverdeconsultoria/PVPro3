import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// Cadastro só com convite: o consultor vê todas as fazendas que abriu; o cliente,
// só a dele, e não abre fazenda nova.

let be: MemoryBackend;
let store: AppStore;
let clientFarm: string;
const s = () => store.getState();

function open(path: string) {
  return render(
    <AppProvider store={store} notebook={be.notebook}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

/** O consultor convida o cliente para a primeira fazenda e sai. */
async function invite(email = 'cliente@exemplo.test') {
  await s().openFarm(clientFarm);
  expect(await s().addMember(email)).toEqual({ ok: true, value: 'invited' });
  await s().signOut();
}

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  be.restrictTo(['consultor@exemplo.test']);
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('consultor@exemplo.test');
  await s().init();
  const a = exampleNewFarm('Fazenda do Cliente');
  clientFarm = a.farm.id;
  await s().createFarm(a);
  await s().createFarm(exampleNewFarm('Outra Fazenda'));
  expect(s().farms.map((f) => f.name)).toEqual(['Fazenda do Cliente', 'Outra Fazenda']);
});

describe('cadastro só com convite', () => {
  it('sem convite a conta não é criada; com convite, o cliente entra e vê só a fazenda dele', async () => {
    const user = userEvent.setup();
    await invite();

    open('/');
    await user.click(await screen.findByRole('button', { name: 'Criar conta' }));
    expect(screen.getByText(/Só cria conta quem recebeu convite/)).toBeTruthy();
    const submit = () => screen.getAllByRole('button', { name: 'Criar conta' }).at(-1)!;

    await user.type(screen.getByLabelText('E-mail'), 'intruso@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'senha-forte-1');
    await user.click(submit());
    expect((await screen.findByRole('alert')).textContent).toMatch(/não tem convite/);
    expect(s().user).toBeNull();

    await user.clear(screen.getByLabelText('E-mail'));
    await user.type(screen.getByLabelText('E-mail'), 'cliente@exemplo.test');
    await user.click(submit());

    // Com uma fazenda só, ela abre direto.
    await waitFor(() => expect(s().data?.farm.name).toBe('Fazenda do Cliente'));
    expect(s().farms.map((f) => f.name)).toEqual(['Fazenda do Cliente']);
    await waitFor(() => expect(s().canCreateFarms).toBe(false));
  });

  it('cliente não vê o botão de abrir fazenda nem o de dar acesso', async () => {
    await invite();
    await be.auth.signUp('cliente@exemplo.test', 'senha-forte-1');
    await waitFor(() => expect(s().data?.farm.id).toBe(clientFarm));

    open('/fazendas');
    const lista = await screen.findByRole('region', { name: 'Suas fazendas' });
    expect(within(lista).getByText('Fazenda do Cliente')).toBeTruthy();
    expect(within(lista).queryByRole('link', { name: /Abrir fazenda nova/ })).toBeNull();
    const acesso = await screen.findByRole('region', { name: 'Quem tem acesso' });
    expect(await within(acesso).findByText('Só o dono da fazenda dá ou tira acesso.')).toBeTruthy();
    expect(within(acesso).queryByRole('form')).toBeNull();
    // Nem pelo caminho direto.
    expect((await s().createFarm(exampleNewFarm('Fazenda Nova'))).ok).toBe(false);
  });

  it('cliente sem fazenda liberada recebe a explicação e o botão de atualizar', async () => {
    await invite();
    await be.auth.signUp('cliente@exemplo.test', 'senha-forte-1');
    await waitFor(() => expect(s().data?.farm.id).toBe(clientFarm));
    const clienteId = s().user!.id;
    // O consultor tira o acesso.
    await be.signInAs('consultor@exemplo.test');
    await be.repo.removeMember(clientFarm, clienteId);
    await be.signInAs('cliente@exemplo.test');
    await waitFor(() => expect(s().farmsReady && s().user?.id === clienteId).toBe(true));
    localStorage.clear();
    await s().loadFarms();

    open('/fazendas');
    expect(await screen.findByText(/Sua conta ainda não tem fazenda liberada/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeTruthy();
  });
});
