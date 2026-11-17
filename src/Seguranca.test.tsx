import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import JSZip from 'jszip';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { createMemoryBackend } from './data/memoryRepo';
import { exampleKml } from './lib/kml/exampleKml.fixture';
import { MAX_FILE_BYTES, readKml } from './lib/kml/readKml';
import { addDays, todayLocal } from './lib/lots/dates';
import { AppProvider } from './state/AppContext';
import { createAppStore } from './state/store';
import { exampleNewFarm } from './test/fixtures';

describe('limites do arquivo de mapa', () => {
  it('recusa arquivo grande demais antes de tentar ler', async () => {
    await expect(readKml(new Uint8Array(MAX_FILE_BYTES + 1))).rejects.toThrow('Arquivo grande demais');
  });

  it('recusa KMZ pequeno que esconde um mapa gigante', async () => {
    const zip = new JSZip();
    // 70 MB de espaços compactam para poucos kB.
    zip.file('doc.kml', new Uint8Array(70 * 1024 * 1024).fill(32));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.length).toBeLessThan(1024 * 1024);
    await expect(readKml(bytes)).rejects.toThrow('O mapa dentro do KMZ é grande demais.');
  }, 60_000);

  it('continua lendo um KMZ normal', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', exampleKml());
    const r = await readKml(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    expect(r.paddocks).toHaveLength(13);
  });
});

describe('cabeçalhos de segurança do site', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  const all = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));

  it('a política de conteúdo só deixa rodar código do próprio site e falar com o banco e o clima', () => {
    const csp = Object.fromEntries(all['Content-Security-Policy'].split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://api.open-meteo.com', 'https://archive-api.open-meteo.com']);
    expect(all['Content-Security-Policy']).not.toMatch(/unsafe-eval|\*;| \* /);
  });

  it('não vaza o endereço do caderno, não aparece em busca e só libera o GPS', () => {
    expect(all['Referrer-Policy']).toBe('no-referrer');
    expect(all['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(all['X-Frame-Options']).toBe('DENY');
    expect(all['X-Content-Type-Options']).toBe('nosniff');
    expect(all['Permissions-Policy']).toContain('geolocation=(self)');
    expect(all['Permissions-Policy']).toContain('camera=()');
  });
});

describe('aviso de pesagem atrasada', () => {
  let store: ReturnType<typeof createAppStore>;
  let be: ReturnType<typeof createMemoryBackend>;
  beforeEach(async () => {
    localStorage.clear();
    be = createMemoryBackend();
    store = createAppStore({ repo: be.repo, auth: be.auth });
    await be.signInAs('ana@exemplo.test');
    await store.getState().init();
    await store.getState().createFarm(exampleNewFarm());
  });
  const open = () =>
    render(
      <AppProvider store={store} notebook={be.notebook}>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </AppProvider>,
    );

  it('avisa do lote nunca pesado e do pesado há mais de 45 dias, e não do pesado há pouco', async () => {
    const s = store.getState;
    const today = todayLocal();
    await s().createLot({ name: 'Nunca', date: addDays(today, -80), heads: 10, weightKg: 300, category: 'Recria', weighed: false });
    await s().createLot({ name: 'Antigo', date: addDays(today, -80), heads: 10, weightKg: 300, category: 'Recria', weighed: true });
    await s().createLot({ name: 'Recente', date: addDays(today, -80), heads: 10, weightKg: 300, category: 'Recria', weighed: false });
    await s().addEvent(s().data!.lots.find((l) => l.name === 'Recente')!.id, { type: 'pesagem', date: addDays(today, -10), weightKg: 320 });
    open();
    const avisos = screen.getByRole('region', { name: 'Avisos' });
    expect(within(avisos).getByText(/nunca foi pesado/).closest('li')!.textContent).toMatch(/^Nunca nunca foi pesado/);
    expect(within(avisos).getByText(/foi pesado há 80 dias/).closest('li')!.textContent).toMatch(/^Antigo /);
    expect(avisos.textContent).not.toMatch(/Recente (nunca|foi pesado)/);
  });
});
