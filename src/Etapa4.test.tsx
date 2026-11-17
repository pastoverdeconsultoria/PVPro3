import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { capacityOf } from './lib/calc/projection';
import { parseNum } from './lib/format';
import { addDays, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { fakeClimateApi } from './test/climateFixture';
import { exampleNewFarm } from './test/fixtures';

// Etapa 4 na tela: projeção, dose de N, adubação, clima estimado, aviso no painel e acesso à fazenda.

let be: MemoryBackend;
let store: AppStore;
let climate: ReturnType<typeof fakeClimateApi>;
const s = () => store.getState();
const today = () => todayLocal();
const paddock = (name: string) => s().data!.paddocks.find((p) => p.name === name)!;
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

async function withLot(heads: number) {
  await s().createLot({ name: 'Lote 1', date: addDays(today(), -40), heads, weightKg: 450, category: 'Vacas', weighed: false });
  await s().moveLot(s().data!.lots[0].id, paddock('P01').id, addDays(today(), -20));
}

/** Abre a Análise e vai para a aba Projeção. */
async function openProjection(user: ReturnType<typeof userEvent.setup>) {
  open('/analise');
  await user.click(await screen.findByRole('button', { name: 'Projeção' }, LAZY_WAIT));
  return screen.findByRole('region', { name: 'Capacidade sustentável do mês' });
}
const heroValue = (el: HTMLElement) => parseNum(el.querySelector('.big')!.textContent!);

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  climate = fakeClimateApi();
  store = createAppStore({ repo: be.repo, auth: be.auth, climate });
  await be.signInAs('ana@exemplo.test');
  await s().init();
  await s().createFarm(exampleNewFarm());
});

describe('projeção', () => {
  it('mostra a capacidade do mês com o aviso de hipótese, treze meses à frente e os parâmetros', async () => {
    const user = userEvent.setup();
    await withLot(90);
    const hero = await openProjection(user);

    expect(screen.getByRole('note').textContent).toMatch(/Hipótese, ainda não validada com fazenda real/);
    // Sem módulo, tudo é "Avulsos" com M 40: a capacidade nunca passa de 40 × 50% ÷ 11,25.
    const cap = heroValue(hero);
    expect(cap).toBeGreaterThan(0.2);
    expect(cap).toBeLessThanOrEqual(Number(capacityOf(40).toFixed(2)));
    expect(hero.textContent).toMatch(/lotação de pasto hoje: 0,18 UA\/ha/);

    expect(within(screen.getByRole('region', { name: 'Mês a mês' })).getAllByRole('listitem')).toHaveLength(13);
    const params = screen.getByRole('region', { name: 'Parâmetros' });
    expect(params.textContent).toContain('M em uso: 40 kg MS/ha/dia (referência)');
    // Um ou dois meses com lotação, conforme o dia do mês em que o teste roda: longe dos seis exigidos.
    expect(params.textContent).toMatch(/Sem calibração: precisa de 6 meses de lotação registrada, tem [12]\./);
    expect((within(params).getByRole('button', { name: 'M calibrado' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('img', { name: /Lotação de pasto ocorrida e capacidade projetada de Fazenda/ })).toBeTruthy();
    expect(climate.calls).toBe(1);
  });

  it('adubação registrada aumenta a capacidade do mês, e apagar volta ao que era', async () => {
    const user = userEvent.setup();
    const before = heroValue(await openProjection(user));

    const section = screen.getByRole('region', { name: 'Adubações nitrogenadas' });
    expect(within(section).getByText('Nenhuma adubação registrada.')).toBeTruthy();
    await user.click(within(section).getByRole('button', { name: 'Registrar adubação' }));
    const sheet = screen.getByRole('dialog', { name: 'Registrar adubação' });
    await user.click(within(sheet).getByRole('button', { name: 'Gravar adubação' }));
    expect(within(sheet).getByRole('alert').textContent).toBe('Escolha o piquete.');
    await user.selectOptions(within(sheet).getByLabelText('Piquete'), paddock('P03').id);
    await user.type(within(sheet).getByLabelText('Dose (kg N/ha)'), '120');
    await user.click(within(sheet).getByRole('button', { name: 'Gravar adubação' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(within(section).getByText(/P03/).closest('li')!.textContent).toMatch(/P03 · 120 kg N\/ha · [\d.]+ kg N/);
    const after = heroValue(screen.getByRole('region', { name: 'Capacidade sustentável do mês' }));
    expect(after).toBeGreaterThan(before);

    await user.click(within(section).getByRole('button', { name: /Apagar adubação de P03/ }));
    await waitFor(() => expect(within(section).getByText('Nenhuma adubação registrada.')).toBeTruthy());
    expect(heroValue(screen.getByRole('region', { name: 'Capacidade sustentável do mês' }))).toBe(before);
  });

  it('meta de lotação vira dose de N por mês, com o total em ureia; meta impossível é avisada', async () => {
    const user = userEvent.setup();
    await openProjection(user);
    const plan = screen.getByRole('region', { name: 'Meta de lotação e dose de N' });
    expect(within(plan).getByText('Informe uma meta para calcular a dose.')).toBeTruthy();

    await user.type(within(plan).getByLabelText(/Meta de lotação de pasto/), '3');
    expect(within(plan).getAllByRole('listitem')).toHaveLength(12);
    expect(plan.textContent).toMatch(/N em 12 meses/);
    expect(plan.textContent).toMatch(/em ureia \(45% N\)/);
    // Na seca o adubo não responde: a tela diz, em vez de inventar dose.
    expect(within(plan).getAllByText(/déficit hídrico: N não responde/).length).toBeGreaterThan(0);

    await user.clear(within(plan).getByLabelText(/Meta de lotação de pasto/));
    await user.type(within(plan).getByLabelText(/Meta de lotação de pasto/), '30');
    expect(within(plan).getAllByText(/meta acima do teto físico do pasto/).length).toBeGreaterThan(0);
  });

  it('sem sinal e sem cópia avisa e deixa tentar de novo; banco sem a migração avisa na adubação', async () => {
    const user = userEvent.setup();
    climate.fail = true;
    open('/analise');
    await user.click(await screen.findByRole('button', { name: 'Projeção' }, LAZY_WAIT));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não deu para buscar o clima/);

    climate.fail = false;
    store.setState({ data: { ...s().data!, fertilizationReady: false } });
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    const section = await screen.findByRole('region', { name: 'Adubações nitrogenadas' });
    expect(within(section).getByRole('alert').textContent).toMatch(/Falta preparar o banco para a adubação/);
    expect(within(section).queryByRole('button', { name: 'Registrar adubação' })).toBeNull();
  });
});

describe('clima e painel', () => {
  it('a tela de Clima mostra a previsão e a chuva estimada ao lado da registrada', async () => {
    await s().addRain({ date: today(), mm: 33 }, 'somar');
    open('/clima');
    const forecast = await screen.findByRole('region', { name: 'Previsão dos próximos dias' });
    expect(within(forecast).getAllByRole('listitem')).toHaveLength(7);
    const months = screen.getByRole('region', { name: 'Chuva por mês' });
    const rows = within(months).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
    expect(rows[11].textContent).toMatch(/registrada 33/);
    expect(rows[11].textContent).toMatch(/1 dia com leitura/);
    expect(rows[0].textContent).toMatch(/registrada —/);
    expect(months.textContent).toMatch(/Estimada: ERA5 pelo centroide \(-14,86; -40,84\)/);
  });

  it('o painel avisa quando a lotação de pasto passa da capacidade projetada do mês', async () => {
    await withLot(90);
    const first = open('/');
    await waitFor(() => expect(s().climateState).toBe('ready'));
    expect(screen.queryByRole('link', { name: 'Lotação acima da capacidade projetada' })).toBeNull();
    first.unmount();

    // 1.600 UA em 495 ha úteis: mais de 3 UA/ha, acima de qualquer capacidade de pasto extensivo.
    await s().addEvent(s().data!.lots[0].id, { type: 'animais_entrada', date: today(), heads: 1510, weightKg: 450 });
    open('/');
    const alert = await screen.findByRole('link', { name: 'Lotação acima da capacidade projetada' });
    expect(alert.textContent).toMatch(/Lotação \d+% acima da capacidade do mês/);
    expect(alert.textContent).toMatch(/Hipótese ainda não validada/);
  });
});

describe('fazenda aberta: dados e acesso', () => {
  it('renomeia a fazenda e dá acesso a outra conta pelo e-mail', async () => {
    const user = userEvent.setup();
    await be.signInAs('bruno@exemplo.test');
    await be.signInAs('ana@exemplo.test');
    open('/fazendas');

    const dados = await screen.findByRole('form', { name: 'Dados da fazenda aberta' });
    await user.clear(within(dados).getByLabelText('Nome'));
    await user.type(within(dados).getByLabelText('Nome'), 'Fazenda Boa');
    await user.click(within(dados).getByRole('button', { name: 'Gravar' }));
    expect(await within(dados).findByText('Gravado.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fazenda Boa/ })).toBeTruthy();

    const acesso = screen.getByRole('region', { name: 'Quem tem acesso' });
    expect(await within(acesso).findByText('ana@exemplo.test')).toBeTruthy();
    expect(within(acesso).getByText('dono · você')).toBeTruthy();

    const form = within(acesso).getByRole('form', { name: 'Dar acesso a outra conta' });
    // E-mail sem conta vira convite, com o recado do que mandar para a pessoa.
    await user.type(within(form).getByLabelText('Dar acesso pelo e-mail'), 'ninguem@exemplo.test');
    await user.click(within(form).getByRole('button', { name: 'Dar acesso' }));
    expect((await within(form).findByRole('status')).textContent).toMatch(/Convite criado.*Criar conta/);
    expect(await within(acesso).findByText('convidado · ainda não criou a conta')).toBeTruthy();
    await user.click(within(acesso).getByRole('button', { name: 'Cancelar o convite de ninguem@exemplo.test' }));
    await user.click(within(acesso).getByRole('button', { name: 'Cancelar convite' }));
    await waitFor(() => expect(within(acesso).queryByText('convidado · ainda não criou a conta')).toBeNull());

    await user.type(within(form).getByLabelText('Dar acesso pelo e-mail'), 'bruno@exemplo.test');
    await user.click(within(form).getByRole('button', { name: 'Dar acesso' }));
    expect(await within(acesso).findByText('acesso completo')).toBeTruthy();
    expect(within(form).getByRole('status').textContent).toMatch(/bruno@exemplo.test já tinha conta/);

    // Tirar o acesso pede confirmação.
    await user.click(within(acesso).getByRole('button', { name: 'Tirar o acesso de bruno@exemplo.test' }));
    expect(s().members).toHaveLength(2);
    await user.click(within(acesso).getByRole('button', { name: 'Tirar acesso' }));
    await waitFor(() => expect(within(acesso).queryByText('acesso completo')).toBeNull());
  });

  it('banco sem a migração avisa em vez de quebrar', async () => {
    store.setState({ data: { ...s().data!, fertilizationReady: false } });
    open('/fazendas');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Falta preparar o banco para dar acesso a outras contas/);
  });
});
