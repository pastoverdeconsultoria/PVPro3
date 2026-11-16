import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './index.css';
import { App } from './App';
import { supabaseConfig } from './data/env';
import { createSupabaseAuth, createSupabaseClient, createSupabaseRepo } from './data/supabaseRepo';
import { AppProvider } from './state/AppContext';
import { createAppStore, type AppStore } from './state/store';

// As fontes vão no pacote (sem CDN) para o app abrir igual sem sinal.
registerSW({ immediate: true });

async function start(): Promise<AppStore | null> {
  // Demonstração com dados inventados: só existe no `npm run dev`.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    return (await import('./data/demo')).demoBackend();
  }
  const config = supabaseConfig();
  if (!config) return null;
  const client = createSupabaseClient(config.url, config.key);
  const store = createAppStore({ repo: createSupabaseRepo(client), auth: createSupabaseAuth(client) });
  void store.getState().init();
  return store;
}

function ConfigMissing() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[520px] flex-col justify-center gap-4 px-4 py-8">
      <h1 className="big m-0 text-[34px]">PVPro3</h1>
      <section className="card flex flex-col gap-2.5" role="alert">
        <h2 className="h2">Falta ligar o banco de dados</h2>
        <p className="k m-0">
          Este app foi publicado sem o endereço e a chave pública do Supabase. Na Vercel, em Settings → Environment Variables, crie
          VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e publique de novo.
        </p>
      </section>
    </main>
  );
}

void start().then((store) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {store ? (
        <AppProvider store={store}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppProvider>
      ) : (
        <ConfigMissing />
      )}
    </React.StrictMode>,
  );
});
