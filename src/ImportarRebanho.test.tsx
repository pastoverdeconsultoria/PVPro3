import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { readCsvFile } from './components/ImportHerdSheet';
import { createMemoryBackend, type MemoryBackend } from './data/memoryRepo';
import { deriveFarm } from './lib/farm/farmView';
import { addDays, formatBr, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

// Importação do rebanho de hoje por planilha CSV, na tela Rebanho.

let be: MemoryBackend;
let store: AppStore;
const s = () => store.getState();
const today = () => todayLocal();
const pid = (name: string) => s().data!.paddocks.find((p) => p.name === name)!.id;
const lotByName = (name: string) => deriveFarm(s().data!, today()).lots.find((l) => l.lot.name === name);

function open(path: string) {
  return render(
    <AppProvider store={store} notebook={be.notebook}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

const csvFile = (text: string, name = 'rebanho.csv') => new File([text], name, { type: 'text/csv' });

beforeEach(async () => {
  localStorage.clear();
  be = createMemoryBackend();
  store = createAppStore({ repo: be.repo, auth: be.auth });
  await be.signInAs('consultor@exemplo.test');
  await s().init();
  await s().createFarm(exampleNewFarm('Fazenda Planilha'));
  await waitFor(() => expect(s().data).not.toBeNull());
});

describe('lote novo já no piquete', () => {
  it('grava formação, pesagem e entrada no mesmo dia, e o lote aparece no piquete', async () => {
    const d = addDays(today(), -10);
    const r = await s().createLot({ name: 'L1', date: d, heads: 50, weightKg: 300, category: 'Recria', weighed: true, paddockId: pid('P02') });
    expect(r).toEqual({ ok: true });
    const l = lotByName('L1')!;
    expect(l.location).toEqual({ kind: 'no_piquete', paddockId: pid('P02'), since: d });
    expect(l.lastWeigh).toBe(d);
    expect(l.problem).toBeNull();
  });

  it('recusa piquete que não existe', async () => {
    const r = await s().createLot({ name: 'L1', date: today(), heads: 50, weightKg: 300, category: 'Recria', weighed: false, paddockId: 'nao-existe' });
    expect(r).toEqual({ ok: false, error: 'Piquete não encontrado.' });
  });
});

describe('tela de importação', () => {
  it('mostra a prévia, importa só as linhas boas e conta o que ficou de fora', async () => {
    await s().createLot({ name: 'Já existe', date: today(), heads: 10, weightKg: 300, category: 'Recria', weighed: false });
    const user = userEvent.setup();
    open('/rebanho');
    await user.click(await screen.findByRole('button', { name: 'Importar' }));
    const dialog = screen.getByRole('dialog', { name: 'Importar rebanho' });

    const d = addDays(today(), -5);
    const csv = [
      'Lote;Cabeças;Peso médio (kg);Categoria;Piquete;Data;Pesado na balança',
      `Garrotes;120;280;Recria;P01;${formatBr(d)};sim`,
      'Vacas;85;;Vacas;P03;;não',
      'Já existe;10;300;Recria;P01;;',
      'Sem pasto;30;400;Engorda;;;',
    ].join('\r\n');
    await user.upload(within(dialog).getByLabelText('Arquivo CSV'), csvFile(csv));

    expect(await within(dialog).findByText('3 lotes prontos')).toBeTruthy();
    expect(within(dialog).getByText(/1 com erro, ficam de fora/)).toBeTruthy();
    expect(within(dialog).getByText('Já existe um lote com esse nome na fazenda.')).toBeTruthy();
    expect(within(dialog).getByText(/Sem peso: usa o padrão de Vacas \(450 kg\)/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Importar 3 lotes' }));
    expect(await within(dialog).findByText('3 lotes importados')).toBeTruthy();

    const g = lotByName('Garrotes')!;
    expect(g.heads).toBe(120);
    expect(g.location).toEqual({ kind: 'no_piquete', paddockId: pid('P01'), since: d });
    expect(g.lastWeigh).toBe(d);
    const v = lotByName('Vacas')!;
    expect(v.weightKg).toBe(450);
    expect(v.lastWeigh).toBeNull();
    expect(v.location).toMatchObject({ kind: 'no_piquete', paddockId: pid('P03'), since: today() });
    expect(lotByName('Sem pasto')!.location).toEqual({ kind: 'sem_movimentacao' });

    await user.click(within(dialog).getAllByRole('button', { name: 'Fechar' }).find((b) => b.textContent === 'Fechar')!);
    expect(await screen.findByRole('region', { name: 'Garrotes' })).toBeTruthy();
  });

  it('planilha do Excel (.xlsx) recebe a instrução de salvar como CSV', async () => {
    const user = userEvent.setup({ applyAccept: false });
    open('/rebanho');
    await user.click(await screen.findByRole('button', { name: 'Importar' }));
    const dialog = screen.getByRole('dialog', { name: 'Importar rebanho' });
    await user.upload(within(dialog).getByLabelText('Arquivo CSV'), new File(['x'], 'rebanho.xlsx'));
    expect(await within(dialog).findByText(/Salvar como/)).toBeTruthy();
  });

  it('quem tem leitura + campo não vê o botão', async () => {
    await s().addMember('cliente@exemplo.test', 'viewer');
    await s().signOut();
    await be.auth.signUp('cliente@exemplo.test', 'senha-forte-1');
    await waitFor(() => expect(s().data?.myRole).toBe('viewer'));
    open('/rebanho');
    await screen.findByRole('heading', { name: 'Rebanho' });
    expect(screen.queryByRole('button', { name: 'Importar' })).toBeNull();
  });
});

describe('leitura do arquivo', () => {
  it('entende o CSV que o Excel em português salva (Windows-1252)', async () => {
    // "Várzea;não" em Windows-1252: á = 0xE1, ã = 0xE3.
    const bytes = new Uint8Array([0x56, 0xe1, 0x72, 0x7a, 0x65, 0x61, 0x3b, 0x6e, 0xe3, 0x6f]);
    expect(await readCsvFile(new Blob([bytes]))).toBe('Várzea;não');
    expect(await readCsvFile(new Blob(['Várzea;não']))).toBe('Várzea;não');
  });
});
