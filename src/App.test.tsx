import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { exampleKml } from './lib/kml/exampleKml.fixture';
import { todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { nf } from './lib/format';
import { exampleNewFarm } from './test/fixtures';

/** Área útil da fazenda de exemplo (12 piquetes de pastejo), em hectares. */
const AREA_UTIL = exampleNewFarm()
  .paddocks.filter((p) => p.isGrazing)
  .reduce((sum, p) => sum + p.areaHa, 0);

// Testes de tela: o app inteiro, com o banco em memória no lugar do Supabase.

let be: MemoryBackend;
let store: AppStore;

/** A abertura de fazenda é tela sob demanda: a primeira carga pode passar de 1 s. */
const LAZY_WAIT = { timeout: 20_000 };

function open(path = '/') {
  return render(
    <AppProvider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

/** Entra com uma conta e abre a fazenda de exemplo, sem passar pelas telas. */
async function withFarm() {
  await be.signInAs('ana@exemplo.test');
  await store.getState().init();
  const farm = exampleNewFarm();
  await store.getState().createFarm(farm);
  return farm;
}

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayLocal(d);
};

beforeEach(() => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth });
});

describe('entrada', () => {
  it('sem conta mostra a tela de entrada, e senha errada dá erro claro', async () => {
    const user = userEvent.setup();
    await store.getState().init();
    open();
    expect(screen.getByRole('heading', { level: 1, name: 'PVPro3' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();

    await user.type(screen.getByLabelText('E-mail'), 'ana@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getAllByRole('button', { name: 'Entrar' }).find((b) => b.getAttribute('type') === 'submit')!);
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.');
  });

  it('cria a conta, cai na lista de fazendas vazia e consegue sair', async () => {
    const user = userEvent.setup();
    await store.getState().init();
    open();
    await user.click(screen.getByRole('button', { name: 'Criar conta', pressed: false }));
    await user.type(screen.getByLabelText('E-mail'), 'ana@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'senha-de-teste');
    const submit = screen.getAllByRole('button', { name: 'Criar conta' }).find((b) => b.getAttribute('type') === 'submit')!;
    await user.click(submit);

    expect(await screen.findByRole('heading', { level: 1, name: 'Fazendas' })).toBeTruthy();
    expect(screen.getByText(/Nenhuma fazenda ainda/)).toBeTruthy();
    expect(screen.getByText('ana@exemplo.test')).toBeTruthy();
    // Sem fazenda aberta não há navegação entre as áreas.
    expect(screen.queryByRole('navigation')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('Senha')).toBeTruthy();
  });
});

describe('abertura de fazenda pelo KML', () => {
  it('lê o arquivo, mostra as áreas, abre a fazenda e cai no mapa', async () => {
    const user = userEvent.setup();
    await be.signInAs('ana@exemplo.test');
    await store.getState().init();
    open('/fazendas/nova');

    await user.type(await screen.findByLabelText('Nome da fazenda', undefined, LAZY_WAIT), 'Fazenda Teste');
    const file = new File([exampleKml()], 'fazenda.kml', { type: 'application/vnd.google-earth.kml+xml' });
    await user.upload(screen.getByLabelText('Arquivo KML ou KMZ'), file);

    const resumo = await screen.findByText(/13 polígonos/);
    expect(resumo.textContent).toMatch(/fazenda\.kml: 13 polígonos, [\d.,]+ ha no total, 6 bebedouros\./);
    // A reserva vem desmarcada como pastejo, e a área útil exclui ela.
    const conferir = screen.getByRole('region', { name: 'Conferir e abrir' });
    expect(within(conferir).getByText('12 de 13')).toBeTruthy();
    expect(within(conferir).getByText(`${nf(AREA_UTIL, 2)} ha`)).toBeTruthy();
    expect(AREA_UTIL).toBeGreaterThan(490);
    expect(AREA_UTIL).toBeLessThan(500);

    await user.click(screen.getByRole('button', { name: 'Abrir fazenda' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mapa' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fazenda Teste/ })).toBeTruthy();
    // No mapa, cada piquete de pastejo é um botão com a situação no nome (aqui, ainda sem dado).
    expect(screen.getAllByRole('button', { name: /^Pasto \d\d, / })).toHaveLength(12);
    expect(store.getState().data!.paddocks).toHaveLength(13);
  });

  it('arquivo que não é KML dá erro e não deixa abrir', async () => {
    const user = userEvent.setup();
    await be.signInAs('ana@exemplo.test');
    await store.getState().init();
    open('/fazendas/nova');
    await user.type(await screen.findByLabelText('Nome da fazenda', undefined, LAZY_WAIT), 'X');
    await user.upload(screen.getByLabelText('Arquivo KML ou KMZ'), new File(['isto não é um mapa'], 'nota.kml'));
    expect((await screen.findByRole('alert')).textContent).toBe('Arquivo KML inválido.');
    await user.click(screen.getByRole('button', { name: 'Abrir fazenda' }));
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Escolha o arquivo KML ou KMZ da fazenda.')).toBe(true);
    expect(be.calls).not.toContain('createFarm');
  });
});

describe('casca do app com fazenda aberta', () => {
  beforeEach(withFarm);

  it('mostra as seis áreas na navegação e marca a atual', async () => {
    open('/');
    const nav = screen.getByRole('navigation', { name: 'Áreas do sistema' });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual(['Painel', 'Mapa', 'Módulos', 'Rebanho', 'Clima', 'Análise']);
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('link', { name: 'Rebanho' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Rebanho' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rebanho' }).getAttribute('aria-current')).toBe('page');
  });

  it('o painel sem lote não inventa número de lotação', () => {
    open('/');
    const hero = screen.getByRole('region', { name: 'Lotação global da fazenda' });
    expect(hero.textContent).toContain('—');
    expect(hero.textContent).toContain(`${nf(AREA_UTIL, 1)} ha`);
    expect(screen.getByText('Falta cadastrar o gado')).toBeTruthy();
  });

  it('endereço desconhecido volta para o painel', () => {
    open('/nao-existe');
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page');
  });

  it('avisa quando o aparelho fica sem sinal', () => {
    open('/');
    expect(screen.getByRole('status').textContent).toBe('Online');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('status').textContent).toBe('Sem sinal');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('status').textContent).toBe('Online');
  });

  it('a lista de fazendas marca a aberta e deixa trocar', async () => {
    const user = userEvent.setup();
    open('/');
    await user.click(screen.getByRole('link', { name: /Fazenda Exemplo/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fazendas' })).toBeTruthy();
    expect(screen.getByText(/aberta agora/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Fazenda Exemplo/ }));
    expect(await screen.findByRole('region', { name: 'Lotação global da fazenda' })).toBeTruthy();
  });
});

describe('rebanho, mapa e painel', () => {
  beforeEach(withFarm);

  it('cadastra o lote, move para um piquete pelo Rebanho e o painel passa a mostrar a lotação', async () => {
    const user = userEvent.setup();
    open('/rebanho');

    await user.click(screen.getByRole('button', { name: 'Novo lote' }));
    const novo = screen.getByRole('dialog', { name: 'Novo lote' });
    await user.selectOptions(within(novo).getByLabelText('Categoria'), 'Vacas');
    expect((within(novo).getByLabelText('Peso médio (kg)') as HTMLInputElement).value).toBe('450');
    await user.type(within(novo).getByLabelText('Cabeças'), '90');
    fireEvent.change(within(novo).getByLabelText('Formado em'), { target: { value: daysAgo(30) } });
    await user.click(within(novo).getByRole('button', { name: 'Criar lote' }));

    const card = await screen.findByRole('region', { name: 'Lote 1' });
    expect(within(card).getByText('Sem movimentação: ainda não entrou em piquete')).toBeTruthy();
    expect(within(card).getByText('fora de piquete')).toBeTruthy();

    await user.click(within(card).getByRole('button', { name: 'Mover' }));
    const mover = screen.getByRole('dialog', { name: 'Mover Lote 1' });
    expect(within(mover).getByText(/Não está em piquete: será gravada só a entrada/)).toBeTruthy();
    await user.click(within(mover).getByRole('button', { name: 'Gravar mudança' }));
    expect(within(mover).getByRole('alert').textContent).toBe('Escolha o piquete de destino.');
    await user.selectOptions(within(mover).getByLabelText('Piquete de destino'), screen.getByRole('option', { name: /^P01 ·/ }));
    fireEvent.change(within(mover).getByLabelText('Data da mudança'), { target: { value: daysAgo(2) } });
    await user.click(within(mover).getByRole('button', { name: 'Gravar mudança' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Lote 1' })).getByText('no pasto')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Painel' }));
    const hero = screen.getByRole('region', { name: 'Lotação global da fazenda' });
    const p01 = store.getState().data!.paddocks.find((p) => p.name === 'P01')!;
    expect(hero.textContent).toContain(nf(90 / AREA_UTIL, 2));
    expect(hero.textContent).toContain('90 UA em pastejo');
    const onde = screen.getByRole('region', { name: 'Onde está cada lote' });
    expect(onde.textContent).toContain(`${nf(90 / p01.areaHa, 2)} UA/ha · dia 3`);
  });

  it('no mapa, tocar no piquete mostra se está ocupado e deixa mover um lote para lá', async () => {
    const user = userEvent.setup();
    await store.getState().createLot({ name: 'Lote 1', date: daysAgo(30), heads: 90, weightKg: 450, category: 'Vacas', weighed: false });
    open('/mapa');

    await user.click(screen.getByRole('button', { name: /^P02, / }));
    let card = screen.getByRole('region', { name: 'Piquete P02' });
    expect(within(card).getByText('Vazio')).toBeTruthy();
    expect(within(card).getByText(/Sem dado de saída/)).toBeTruthy();

    await user.click(within(card).getByRole('button', { name: 'Mover lote para cá' }));
    const mover = screen.getByRole('dialog', { name: 'Mover para P02' });
    await user.click(within(mover).getByRole('button', { name: 'Gravar mudança' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    card = screen.getByRole('region', { name: 'Piquete P02' });
    expect(within(card).getByText('Ocupado')).toBeTruthy();
    expect(within(card).getByText(/lotação instantânea · dia 1 de uso/)).toBeTruthy();
    expect(within(card).getByText(/90 cabeças, 90 UA/)).toBeTruthy();
    // O acumulado do ano não aparece no cartão do piquete.
    expect(card.textContent).not.toMatch(/anual|no ano/i);
  });

  it('edita o piquete: tira do pastejo e a área útil diminui', async () => {
    const user = userEvent.setup();
    open('/mapa');
    await user.click(screen.getByRole('button', { name: /^P01, / }));
    await user.click(screen.getByRole('button', { name: 'Editar piquete' }));
    const sheet = screen.getByRole('dialog', { name: 'Editar P01' });
    await user.clear(within(sheet).getByLabelText('Nome'));
    await user.type(within(sheet).getByLabelText('Nome'), 'Piquete da sede');
    await user.click(within(sheet).getByLabelText(/Área de pastejo/));
    await user.click(within(sheet).getByRole('button', { name: 'Gravar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Piquete Piquete da sede' })).getByText('Fora do pastejo')).toBeTruthy();
    expect(store.getState().data!.paddocks.filter((p) => p.isGrazing)).toHaveLength(11);
  });

  it('pesa duas vezes e mostra o GMD; apaga a mudança pelo histórico e desfaz', async () => {
    const user = userEvent.setup();
    const s = store.getState();
    await s.createLot({ name: 'Lote 1', date: daysAgo(40), heads: 100, weightKg: 300, category: 'Recria', weighed: true });
    const lotId = store.getState().data!.lots[0].id;
    const p01 = store.getState().data!.paddocks.find((p) => p.name === 'P01')!.id;
    await store.getState().moveLot(lotId, p01, daysAgo(5));
    open('/rebanho');

    const card = screen.getByRole('region', { name: 'Lote 1' });
    await user.click(within(card).getByRole('button', { name: 'Pesar' }));
    const pesar = screen.getByRole('dialog', { name: 'Pesar Lote 1' });
    await user.type(within(pesar).getByLabelText('Peso médio do lote (kg)'), '320');
    fireEvent.change(within(pesar).getByLabelText('Data da pesagem'), { target: { value: daysAgo(0) } });
    await user.click(within(pesar).getByRole('button', { name: 'Gravar pesagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('region', { name: 'Lote 1' })).getByText('+0,50')).toBeTruthy();

    await user.click(within(screen.getByRole('region', { name: 'Lote 1' })).getByRole('button', { name: 'Histórico' }));
    const hist = screen.getByRole('dialog', { name: 'Histórico de Lote 1' });
    expect(within(hist).getByText('Entrou em P01')).toBeTruthy();
    await user.click(within(hist).getByRole('button', { name: 'Apagar registro: Entrou em P01' }));
    await user.click(within(hist).getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(within(hist).getByText('Apagados (1)')).toBeTruthy());
    expect(store.getState().data!.events.filter((e) => e.deletedAt)).toHaveLength(1);

    await user.click(within(hist).getByText('Apagados (1)'));
    await user.click(within(hist).getByRole('button', { name: 'Desfazer exclusão: Entrou em P01' }));
    await waitFor(() => expect(store.getState().data!.events.filter((e) => e.deletedAt)).toHaveLength(0));
  });
});

describe('módulos', () => {
  beforeEach(withFarm);

  it('monta um módulo escolhendo piquetes e trocando a ordem', async () => {
    const user = userEvent.setup();
    open('/modulos');
    expect(screen.getByText('Piquetes sem módulo (12)')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Novo módulo' }));
    const sheet = screen.getByRole('dialog', { name: 'Novo módulo' });
    expect((within(sheet).getByLabelText('Nome') as HTMLInputElement).value).toBe('Módulo A');
    await user.click(within(sheet).getByRole('button', { name: 'Gravar módulo' }));
    expect(within(sheet).getByRole('alert').textContent).toMatch(/pelo menos um piquete/);

    for (const p of ['P01', 'P02', 'P03']) await user.click(within(sheet).getByRole('button', { name: p }));
    await user.click(within(sheet).getByRole('button', { name: 'Subir P03' }));
    await user.selectOptions(within(sheet).getByLabelText('Condição'), 'adubada');
    expect((within(sheet).getByLabelText('M de referência') as HTMLInputElement).value).toBe('105');
    await user.click(within(sheet).getByRole('button', { name: 'Gravar módulo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const card = screen.getByRole('region', { name: 'Módulo A' });
    expect(Array.from(card.querySelectorAll('ol li b')).map((b) => b.textContent)).toEqual(['P01', 'P03', 'P02']);
    expect(card.textContent).toContain('Adubada · M de referência 105');
    expect(screen.getByText('Piquetes sem módulo (9)')).toBeTruthy();
  });
});

describe('quem não tem vínculo', () => {
  it('entra no app e não vê a fazenda de outra conta', async () => {
    await withFarm();
    await store.getState().signOut();
    await be.signInAs('bruno@exemplo.test');
    await store.getState().loadFarms();
    open('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fazendas' })).toBeTruthy();
    expect(screen.getByText(/Nenhuma fazenda ainda/)).toBeTruthy();
    expect(screen.queryByText('Fazenda Exemplo')).toBeNull();
  });
});
