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
  /** Primeira vez no aparelho: a página pergunta o nome uma vez só. */
  async function sayName(user: ReturnType<typeof userEvent.setup>, name = 'Zé') {
    await user.type(await screen.findByLabelText('Seu nome'), name);
    await user.click(screen.getByRole('button', { name: 'PRONTO ✓' }));
  }

  it('abre sem login, pergunta o nome uma vez e mostra as duas ações com figura', async () => {
    const user = userEvent.setup();
    await s().signOut();
    const first = open(`/c/${token}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' })).toBeTruthy();
    // Nada de tela de entrada, nem de navegação do sistema.
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();

    expect(screen.getByText('Qual seu nome?')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'PRONTO ✓' }) as HTMLButtonElement).disabled).toBe(true);
    await sayName(user);

    expect(screen.getByText('O que aconteceu?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choveu' }).textContent).toBe('🌧️CHOVEU');
    expect(screen.getByRole('button', { name: 'Mudei o gado' }).textContent).toBe('🐮MUDEI O GADO');
    expect(screen.getByText(/Zé ·/)).toBeTruthy();

    // Da segunda vez em diante, o nome já está guardado no aparelho.
    first.unmount();
    open(`/c/${token}`);
    expect(await screen.findByText('O que aconteceu?')).toBeTruthy();
    expect(screen.queryByText('Qual seu nome?')).toBeNull();
  });

  it('mudança de gado: escolhe o lote, toca no pasto, diz quando foi e confirma', async () => {
    const user = userEvent.setup();
    open(`/c/${token}`);
    await sayName(user);
    await user.click(screen.getByRole('button', { name: 'Mudei o gado' }));

    // O lote aparece com onde está e quantas cabeças tem, para ser reconhecido.
    const lote = screen.getByRole('button', { name: /^Lote 1/ });
    expect(lote.textContent).toBe('🐂 Lote 1está no P01 · 90 cabeças');
    expect(screen.queryByText('2. Pra qual pasto foi?')).toBeNull();
    await user.click(lote);

    const pastos = screen.getByRole('group', { name: 'Pra qual pasto foi?' });
    // O pasto onde o lote já está não é oferecido como destino.
    expect(within(pastos).queryByRole('button', { name: 'P01' })).toBeNull();
    expect(within(pastos).getAllByRole('button')).toHaveLength(12);
    // O mapinha mostra os mesmos pastos para tocar.
    expect(within(screen.getByRole('group', { name: 'Toque no pasto' })).getAllByRole('button')).toHaveLength(13);
    expect(screen.queryByRole('button', { name: 'CONFIRMAR ✓' })).toBeNull();
    await user.click(within(pastos).getByRole('button', { name: 'P02' }));

    await user.click(screen.getByRole('button', { name: /Ontem/ }));
    expect(screen.getByText('Lote 1 ➜ P02')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'CONFIRMAR ✓' }));

    expect(await screen.findByText('Enviado!')).toBeTruthy();
    expect(await be.repo.listReports(s().farmId!)).toMatchObject([
      { kind: 'mudanca', date: addDays(today(), -1), reporter: 'Zé', lotId: lotId('Lote 1'), toPaddockId: pid('P02'), status: 'novo' },
    ]);

    // De volta ao início: o relato aparece como enviado, e o lote já consta no pasto novo.
    await user.click(screen.getByRole('button', { name: 'REGISTRAR OUTRA COISA' }));
    expect(within(screen.getByRole('region', { name: 'Enviados' })).getByText(/Lote 1 ➜ P02/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mudei o gado' }));
    expect(screen.getByRole('button', { name: /^Lote 1/ }).textContent).toContain('está no P02');
  });

  it('chuva: digita no teclado grande, sem sinal guarda no aparelho e envia quando o sinal volta', async () => {
    const user = userEvent.setup();
    const { unmount } = open(`/c/${token}`);
    await sayName(user);

    setOnline(false);
    expect(screen.getByRole('status').textContent).toBe('Sem sinal');
    await user.click(screen.getByRole('button', { name: 'Choveu' }));

    const visor = screen.getByRole('status', { name: 'Milímetros de chuva' });
    const enviar = screen.getByRole('button', { name: 'ENVIAR ✓' }) as HTMLButtonElement;
    expect(visor.textContent).toBe('0mm');
    expect(enviar.disabled).toBe(true);
    for (const k of ['1', '2', 'Vírgula', '5']) await user.click(screen.getByRole('button', { name: k }));
    expect(visor.textContent).toBe('12,5mm');
    // O teclado não deixa passar de uma casa depois da vírgula, e apagar volta um passo.
    await user.click(screen.getByRole('button', { name: '9' }));
    expect(visor.textContent).toBe('12,5mm');
    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(visor.textContent).toBe('12,5mm');
    await user.click(enviar);

    expect(await screen.findByText('Guardado!')).toBeTruthy();
    expect(screen.getByText(/Vai enviar sozinho quando pegar internet/)).toBeTruthy();
    expect(screen.getByText('📥 1 esperando sinal pra enviar')).toBeTruthy();
    // Nada chegou ao consultor ainda (o estado dele em memória não mudou).
    expect(s().data!.reports).toEqual([]);

    // Fecha e abre de novo, ainda sem sinal: a lista da fazenda e o relato continuam lá.
    unmount();
    open(`/c/${token}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Fazenda Exemplo' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Esperando sinal' })).getByText(/12,5 mm/)).toBeTruthy();

    setOnline(true);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Esperando sinal' })).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Enviados' })).getByText(/12,5 mm/)).toBeTruthy();
    expect(await be.repo.listReports(s().farmId!)).toMatchObject([{ kind: 'chuva', mm: 12.5, date: today(), reporter: 'Zé' }]);
  });

  it('link errado avisa com figura; sem sinal na primeira vez explica o que fazer', async () => {
    const first = open(`/c/${'f'.repeat(64)}`);
    expect(await screen.findByText('Link não funciona')).toBeTruthy();
    expect(screen.getByText('Peça o link novo pro responsável.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choveu' })).toBeNull();
    first.unmount();

    localStorage.clear();
    be.setOffline(true);
    open(`/c/${token}`);
    expect(await screen.findByText(/Abra esta página uma vez com internet/)).toBeTruthy();
  });

  it('não deixa enviar data futura, e avisa quando o servidor não aceita o relato', async () => {
    const user = userEvent.setup();
    open(`/c/${token}`);
    await sayName(user);
    await user.click(screen.getByRole('button', { name: 'Choveu' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    const enviar = screen.getByRole('button', { name: 'ENVIAR ✓' }) as HTMLButtonElement;
    await user.click(screen.getByRole('button', { name: /Outro/ }));
    expect(enviar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: addDays(today(), 2) } });
    expect(enviar.disabled).toBe(true);
    expect(be.calls).not.toContain('notebook.submit');
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: addDays(today(), -3) } });
    expect(enviar.disabled).toBe(false);

    // O consultor troca o link enquanto o vaqueiro está com a página aberta.
    await s().rotateShareToken();
    await user.click(enviar);
    expect(await screen.findByText('Não deu certo')).toBeTruthy();
    expect(screen.getByText('Este link do caderno não vale mais. Peça o link novo.')).toBeTruthy();
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
