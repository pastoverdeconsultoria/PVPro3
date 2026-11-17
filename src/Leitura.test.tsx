import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { addDays, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// Cliente com "leitura + campo": vê tudo, grava troca de gado, chuva e pesagem
// pela tela Campo, e não mexe no resto. E o "esqueci a senha".

let be: MemoryBackend;
let store: AppStore;
let farmId: string;
const s = () => store.getState();
const today = () => todayLocal();
const pid = (name: string) => s().data!.paddocks.find((p) => p.name === name)!.id;
const lotId = (name: string) => s().data!.lots.find((l) => l.name === name)!.id;

function open(path: string) {
  return render(
    <AppProvider store={store} notebook={be.notebook}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

/** Consultor abre a fazenda com um lote no P01 e convida o cliente; o cliente cria a conta e entra. */
async function asClient() {
  await s().addMember('cliente@exemplo.test');
  await s().signOut();
  await be.auth.signUp('cliente@exemplo.test', 'senha-forte-1');
  await waitFor(() => expect(s().data?.farm.id).toBe(farmId));
  expect(s().data!.myRole).toBe('viewer');
}

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  be.restrictTo(['consultor@exemplo.test']);
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('consultor@exemplo.test');
  await s().init();
  const nf = exampleNewFarm('Fazenda do Cliente');
  farmId = nf.farm.id;
  await s().createFarm(nf);
  await s().createLot({ name: 'Lote 1', date: addDays(today(), -30), heads: 100, weightKg: 300, category: 'Recria', weighed: false });
  await s().moveLot(lotId('Lote 1'), pid('P01'), addDays(today(), -20));
});

describe('leitura + campo', () => {
  it('as telas mostram tudo, sem os botões de mudar o que não é de campo', async () => {
    await asClient();
    open('/rebanho');
    const nav = screen.getByRole('navigation', { name: 'Áreas do sistema' });
    expect(within(nav).getByRole('link', { name: /Campo/ })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /Módulos/ })).toBeNull();

    const card = await screen.findByRole('region', { name: 'Lote 1' });
    expect(within(card).getByText('100')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Mover' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Pesar' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Alterar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Novo lote/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByText(/Para corrigir um registro, fale com o consultor/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Apagar registro/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Excluir lote/ })).toBeNull();
  });

  it('no Campo, muda o gado de pasto e desfaz o engano', async () => {
    await asClient();
    const user = userEvent.setup();
    open('/campo');
    await user.click(await screen.findByRole('button', { name: 'Mudei o gado' }));
    await user.click(within(screen.getByRole('group', { name: 'Qual lote mudou?' })).getByRole('button', { name: /Lote 1/ }));
    const pastos = screen.getByRole('group', { name: 'Pra qual pasto foi?' });
    // O pasto onde o lote já está não aparece como destino.
    expect(within(pastos).queryByRole('button', { name: 'P01' })).toBeNull();
    await user.click(within(pastos).getByRole('button', { name: 'P02' }));
    await user.click(screen.getByRole('button', { name: '🌙 Ontem' }));
    expect(screen.getByText('Lote 1 ➜ P02')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'CONFIRMAR ✓' }));

    expect(await screen.findByText('Gravado!')).toBeTruthy();
    const view = () => s().data!.events.filter((e) => !e.deletedAt && e.type === 'piquete_entrada').map((e) => [e.type === 'piquete_entrada' && e.paddockId === pid('P02'), e.date]);
    expect(view()).toEqual([
      [false, addDays(today(), -20)],
      [true, addDays(today(), -1)],
    ]);

    await user.click(screen.getByRole('button', { name: '↩️ Errei, desfazer' }));
    expect(await screen.findByText('Desfeito')).toBeTruthy();
    expect(view()).toEqual([[false, addDays(today(), -20)]]);
  });

  it('no Campo, registra pesagem e chuva', async () => {
    await asClient();
    const user = userEvent.setup();
    open('/campo');

    await user.click(await screen.findByRole('button', { name: 'Pesei o gado' }));
    await user.click(within(screen.getByRole('group', { name: 'Qual lote pesou?' })).getByRole('button', { name: /Lote 1/ }));
    const pad = screen.getByRole('group', { name: 'Teclado numérico' });
    for (const k of ['3', '2', '5']) await user.click(within(pad).getByRole('button', { name: k }));
    await user.click(screen.getByRole('button', { name: 'GRAVAR ✓' }));
    expect(await screen.findByText('Gravado!')).toBeTruthy();
    expect(s().data!.events.filter((e) => e.type === 'pesagem').map((e) => (e.type === 'pesagem' ? e.weightKg : 0))).toEqual([325]);

    await user.click(screen.getByRole('button', { name: 'REGISTRAR OUTRA COISA' }));
    await user.click(screen.getByRole('button', { name: 'Choveu' }));
    const pad2 = screen.getByRole('group', { name: 'Teclado numérico' });
    for (const k of ['1', '2']) await user.click(within(pad2).getByRole('button', { name: k }));
    await user.click(screen.getByRole('button', { name: 'GRAVAR ✓' }));
    expect(await screen.findByText('Gravado!')).toBeTruthy();
    expect(s().data!.rain.map((r) => [r.date, r.mm])).toEqual([[today(), 12]]);
  });

  it('o servidor recusa o que não é de campo, mesmo sem a tela', async () => {
    await asClient();
    expect(await s().addEvent(lotId('Lote 1'), { type: 'animais_saida', date: today(), heads: 5 })).toEqual({ ok: false, error: 'Sua conta não tem permissão para gravar isso nesta fazenda.' });
    expect((await s().saveModule({ id: crypto.randomUUID(), farmId, name: 'M', color: '#fff', occupationDays: 3, plannedLotId: null, condition: 'extensiva', mRef: 40 })).ok).toBe(false);
  });

  it('o dono escolhe o tipo de acesso no convite e troca depois', async () => {
    const user = userEvent.setup();
    await be.signInAs('outro@exemplo.test');
    await be.signInAs('consultor@exemplo.test');
    await waitFor(() => expect(s().data?.farm.id).toBe(farmId));
    open('/fazendas');
    const acesso = await screen.findByRole('region', { name: 'Quem tem acesso' });
    const form = within(acesso).getByRole('form', { name: 'Dar acesso a outra conta' });
    expect((within(form).getByRole('radio', { name: /Leitura \+ campo/ }) as HTMLInputElement).checked).toBe(true);
    await user.type(within(form).getByLabelText('Dar acesso pelo e-mail'), 'outro@exemplo.test');
    await user.click(within(form).getByRole('button', { name: 'Dar acesso' }));
    expect(await within(acesso).findByText('leitura + campo')).toBeTruthy();

    await user.click(within(acesso).getByRole('button', { name: 'Dar acesso completo a outro@exemplo.test' }));
    expect(await within(acesso).findByText('acesso completo')).toBeTruthy();
  });
});

describe('esqueci a senha', () => {
  it('pede o link, volta por ele, grava a senha nova e entra com ela', async () => {
    await asClient();
    await s().signOut();
    const user = userEvent.setup();
    const { unmount } = open('/');
    await user.click(await screen.findByRole('button', { name: 'Esqueci a senha' }));
    await user.type(screen.getByLabelText('E-mail'), 'cliente@exemplo.test');
    await user.click(screen.getByRole('button', { name: 'Mandar o link' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/o link chegou/);
    expect(be.resetRequests).toEqual(['cliente@exemplo.test']);
    unmount();

    // A pessoa abre o link do e-mail.
    await be.openRecoveryLink('cliente@exemplo.test');
    open('/');
    const form = await screen.findByRole('form', { name: 'Senha nova' });
    await user.type(within(form).getByLabelText('Senha nova'), 'outra-senha-9');
    await user.type(within(form).getByLabelText('Repita a senha nova'), 'outra-senha-8');
    await user.click(within(form).getByRole('button', { name: 'Gravar a senha nova' }));
    expect((await within(form).findByRole('alert')).textContent).toBe('As duas senhas não são iguais.');
    await user.clear(within(form).getByLabelText('Repita a senha nova'));
    await user.type(within(form).getByLabelText('Repita a senha nova'), 'outra-senha-9');
    await user.click(within(form).getByRole('button', { name: 'Gravar a senha nova' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Senha nova' })).toBeNull());
    expect(s().passwordRecovery).toBe(false);

    await s().signOut();
    expect((await s().signIn('cliente@exemplo.test', 'senha-forte-1')).ok).toBe(false);
    expect((await s().signIn('cliente@exemplo.test', 'outra-senha-9')).ok).toBe(true);
  });
});
