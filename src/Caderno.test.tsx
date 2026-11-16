import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { deriveFarm } from './lib/farm/farmView';
import { rainOn } from './lib/farm/rain';
import { addDays, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// Caderno da equipe de ponta a ponta: o vaqueiro anota pelo link, sem login, e o
// consultor confere e lança. Banco em memória no lugar do Supabase.

let be: MemoryBackend;
let store: AppStore;
let token = '';
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

const setOnline = (value: boolean) => {
  be.setOffline(!value);
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  fireEvent(window, new Event(value ? 'online' : 'offline'));
};

beforeEach(async () => {
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  await s().createFarm(exampleNewFarm());
  await s().createLot({ name: 'Lote 1', date: addDays(today(), -40), heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
  await s().moveLot(lotId('Lote 1'), pid('P01'), addDays(today(), -10));
  token = s().data!.farm.shareToken!;
});

describe('link do vaqueiro', () => {
  it('abre sem login, anota a mudança de gado e ela chega para o consultor', async () => {
    const user = userEvent.setup();
    await s().signOut();
    open(`/c/${token}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' })).toBeTruthy();
    // Nada de tela de entrada, nem de navegação do sistema.
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Anotar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escolha o lote.');

    await user.selectOptions(screen.getByLabelText('Lote'), 'Lote 1');
    await user.selectOptions(screen.getByLabelText('Foi para o piquete'), 'P02');
    await user.click(screen.getByRole('button', { name: 'Ontem' }));
    await user.type(screen.getByLabelText('Seu nome (opcional)'), 'Zé');
    await user.click(screen.getByRole('button', { name: 'Anotar' }));

    const enviados = await screen.findByRole('region', { name: 'Enviados' });
    expect(within(enviados).getByText(/Lote 1 foi para P02/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Aguardando sinal' })).toBeNull();

    await be.signInAs('ana@exemplo.test');
    const reports = await be.repo.listReports(s().farmId ?? exampleFarmId());
    expect(reports).toMatchObject([{ kind: 'mudanca', date: addDays(today(), -1), reporter: 'Zé', status: 'novo' }]);
  });

  it('sem sinal guarda no aparelho, mostra que está esperando e envia quando o sinal volta', async () => {
    const user = userEvent.setup();
    const { unmount } = open(`/c/${token}`);
    await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' });

    setOnline(false);
    expect(screen.getByRole('status').textContent).toBe('Sem sinal');
    await user.click(screen.getByRole('button', { name: 'Chuva' }));
    await user.type(screen.getByLabelText('Quantos milímetros choveu'), '12,5');
    await user.click(screen.getByRole('button', { name: 'Anotar' }));

    const fila = await screen.findByRole('region', { name: 'Aguardando sinal' });
    expect(within(fila).getByText(/Chuva: 12,5 mm/)).toBeTruthy();
    expect(screen.getByText(/Vai ser enviado quando houver sinal/)).toBeTruthy();
    // Nada chegou ao consultor ainda (o estado dele em memória não mudou).
    expect(s().data!.reports).toEqual([]);

    // Fecha e abre de novo, ainda sem sinal: a lista da fazenda e o relato continuam lá.
    unmount();
    open(`/c/${token}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Aguardando sinal' })).getByText(/Chuva: 12,5 mm/)).toBeTruthy();

    setOnline(true);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Aguardando sinal' })).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Enviados' })).getByText(/Chuva: 12,5 mm/)).toBeTruthy();
    expect(await be.repo.listReports(s().farmId!)).toMatchObject([{ kind: 'chuva', mm: 12.5, date: today() }]);
  });

  it('link errado avisa que não vale; sem sinal na primeira vez explica o que fazer', async () => {
    const first = open(`/c/${'f'.repeat(64)}`);
    expect(await screen.findByText('Este link não vale mais')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Anotar' })).toBeNull();
    first.unmount();

    localStorage.clear();
    be.setOffline(true);
    open(`/c/${token}`);
    expect(await screen.findByText(/ainda não guardou a lista de piquetes e lotes/)).toBeTruthy();
  });

  it('recusa data futura e chuva sem número, sem pôr nada na fila', async () => {
    const user = userEvent.setup();
    open(`/c/${token}`);
    await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' });
    await user.click(screen.getByRole('button', { name: 'Chuva' }));
    await user.click(screen.getByRole('button', { name: 'Anotar' }));
    expect(screen.getByRole('alert').textContent).toMatch(/quantos milímetros/);
    await user.type(screen.getByLabelText('Quantos milímetros choveu'), '5');
    await user.click(screen.getByRole('button', { name: 'Outro dia' }));
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: addDays(today(), 2) } });
    await user.click(screen.getByRole('button', { name: 'Anotar' }));
    expect(screen.getByRole('alert').textContent).toBe('A data não pode ser depois de hoje.');
    expect(be.calls).not.toContain('notebook.submit');
  });
});

describe('consultor', () => {
  const relato = (over: object) => ({ id: crypto.randomUUID(), kind: 'chuva' as const, date: today(), deviceCreatedAt: new Date().toISOString(), ...over });

  it('vê o aviso no painel, confere o que vai ser gravado e lança a mudança', async () => {
    const user = userEvent.setup();
    await be.notebook.submit(token, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P02'), date: addDays(today(), -1), reporter: 'Zé', note: 'pasto rapado' }));
    await s().refreshReports();
    open('/');

    const card = screen.getByRole('link', { name: 'Caderno da equipe' });
    expect(card.textContent).toContain('1 relato novo esperando você lançar');
    expect(screen.getByLabelText('1 relato novo no caderno')).toBeTruthy();
    await user.click(card);

    const novos = await screen.findByRole('region', { name: 'Relatos novos' });
    expect(within(novos).getByText('Lote 1 foi para P02')).toBeTruthy();
    expect(within(novos).getByText(/por Zé, recebido em/)).toBeTruthy();
    expect(within(novos).getByText('“pasto rapado”')).toBeTruthy();
    expect(within(novos).getByText('Grava a saída de P01 e a entrada em P02.')).toBeTruthy();

    await user.click(within(novos).getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Relatos novos' })).getByText('Nenhum relato esperando revisão.')).toBeTruthy());
    const v = deriveFarm(s().data!, today());
    expect(v.paddockById.get(pid('P02'))!.occupants.map((o) => o.lot.name)).toEqual(['Lote 1']);
    expect(v.paddockById.get(pid('P01'))!.restDays).toBe(1);
    expect(screen.getByText('Já revisados (1)')).toBeTruthy();
  });

  it('relato que não fecha com o histórico fica bloqueado com o motivo; corrigindo, lança', async () => {
    const user = userEvent.setup();
    await be.notebook.submit(token, relato({ kind: 'mudanca', lotId: lotId('Lote 1'), toPaddockId: pid('P01'), reporter: 'Zé' }));
    await s().refreshReports();
    open('/caderno');

    const novos = await screen.findByRole('region', { name: 'Relatos novos' });
    expect(within(novos).getByText('O lote já está nesse piquete.')).toBeTruthy();
    expect((within(novos).getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(novos).getByRole('button', { name: 'Editar' }));
    const sheet = screen.getByRole('dialog', { name: 'Corrigir relato' });
    await user.selectOptions(within(sheet).getByLabelText('Foi para o piquete'), 'P03');
    await user.click(within(sheet).getByRole('button', { name: 'Gravar correção' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(within(novos).getByText('Lote 1 foi para P03')).toBeTruthy();
    await user.click(within(novos).getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(s().data!.reports[0].status).toBe('lancado'));
  });

  it('chuva em dia que já tem leitura oferece somar ou substituir; descartar tira dos novos', async () => {
    const user = userEvent.setup();
    await s().addRain({ date: today(), mm: 10 }, 'somar');
    await be.notebook.submit(token, relato({ mm: 6 }));
    await be.notebook.submit(token, relato({ mm: 99, date: addDays(today(), -3) }));
    await s().refreshReports();
    open('/caderno');

    const novos = await screen.findByRole('region', { name: 'Relatos novos' });
    expect(within(novos).getByText('Já há 10,0 mm registrados nesse dia.')).toBeTruthy();
    await user.click(within(novos).getByRole('button', { name: 'Somar (16,0 mm)' }));
    await waitFor(() => expect(rainOn(s().data!.rain, today())).toBe(16));

    await user.click(within(novos).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(within(novos).getByText('Nenhum relato esperando revisão.')).toBeTruthy());
    expect(rainOn(s().data!.rain, addDays(today(), -3))).toBeNull();

    await user.click(screen.getByText('Já revisados (2)'));
    await user.click(screen.getByRole('button', { name: 'Voltar para novos' }));
    await waitFor(() => expect(within(novos).getByText('Chuva: 99,0 mm')).toBeTruthy());
  });

  it('mostra o link da equipe e troca o link só depois de confirmar', async () => {
    const user = userEvent.setup();
    open('/caderno');
    const link = await screen.findByRole('region', { name: 'Link da equipe' });
    expect((within(link).getByLabelText('Endereço do caderno') as HTMLInputElement).value).toBe(`${window.location.origin}/c/${token}`);

    await user.click(within(link).getByRole('button', { name: 'Trocar link…' }));
    expect(s().data!.farm.shareToken).toBe(token);
    await user.click(within(link).getByRole('button', { name: 'Trocar link' }));
    await waitFor(() => expect(s().data!.farm.shareToken).not.toBe(token));
    expect(await be.notebook.context(token)).toBeNull();
    expect((within(link).getByLabelText('Endereço do caderno') as HTMLInputElement).value).toBe(`${window.location.origin}/c/${s().data!.farm.shareToken}`);
  });

  it('registra chuva pela tela de Clima, soma no dia e apaga uma leitura', async () => {
    const user = userEvent.setup();
    open('/clima');
    const form = await screen.findByRole('form', { name: 'Registrar chuva' });
    expect(within(screen.getByRole('region', { name: 'Chuva registrada no mês' })).getByText('Nenhuma leitura neste mês.')).toBeTruthy();

    await user.type(within(form).getByLabelText('Milímetros'), '12');
    await user.click(within(form).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(rainOn(s().data!.rain, today())).toBe(12));

    expect(within(form).getByText('Já há 12,0 mm registrados nesse dia.')).toBeTruthy();
    await user.type(within(form).getByLabelText('Milímetros'), '3,5');
    await user.click(within(form).getByRole('button', { name: 'Somar ao dia' }));
    await waitFor(() => expect(rainOn(s().data!.rain, today())).toBe(15.5));

    const lista = screen.getByRole('region', { name: 'Leituras por dia' });
    expect(within(lista).getByText('15,5 mm')).toBeTruthy();
    await user.click(within(lista).getByRole('button', { name: /Apagar leitura de 3,5 mm/ }));
    await waitFor(() => expect(rainOn(s().data!.rain, today())).toBe(12));
  });
});

function exampleFarmId(): string {
  throw new Error('fazenda fechada: o teste precisa do id antes de sair da conta');
}
