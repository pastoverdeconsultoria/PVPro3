import { Navigate, Outlet, Route, Routes, useMatch } from 'react-router-dom';
import { Shell } from './components/Shell';
import { lazyScreen } from './lib/lazyScreen';
import { Caderno } from './pages/Caderno';
import { CadernoPublico } from './pages/CadernoPublico';
import { Clima } from './pages/Clima';
import { Fazendas } from './pages/Fazendas';
import { Login } from './pages/Login';
import { Mapa } from './pages/Mapa';
import { Modulos } from './pages/Modulos';
import { Painel } from './pages/Painel';
import { Rebanho } from './pages/Rebanho';
import { useApp } from './state/AppContext';

// Regra do CLAUDE.md: telas de campo (painel, mapa, módulos, rebanho, clima) nunca
// ficam em chunk sob demanda. Só telas de escritório podem ser lazy: a Análise e a
// abertura de fazenda por KML (que traz o leitor de KMZ).
const Analise = lazyScreen(() => import('./pages/Analise'));
const NovaFazenda = lazyScreen(() => import('./pages/NovaFazenda'));

export function App() {
  const phase = useApp((s) => s.phase);
  // O link do caderno abre sem login, esteja ou não alguém com conta neste aparelho.
  const notebook = useMatch('/c/:token');
  if (notebook?.params.token) return <CadernoPublico token={notebook.params.token} />;

  if (phase === 'starting') {
    return (
      <p className="k m-0 p-6" role="status">
        Abrindo…
      </p>
    );
  }
  if (phase === 'signedOut') return <Login />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="fazendas" element={<Fazendas />} />
        <Route path="fazendas/nova" element={<NovaFazenda />} />
        <Route element={<FarmGate />}>
          <Route index element={<Painel />} />
          <Route path="mapa" element={<Mapa />} />
          <Route path="modulos" element={<Modulos />} />
          <Route path="rebanho" element={<Rebanho />} />
          <Route path="clima" element={<Clima />} />
          <Route path="caderno" element={<Caderno />} />
          <Route path="analise" element={<Analise />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** As áreas do sistema só abrem com uma fazenda carregada. Sem fazenda, vai para a lista. */
function FarmGate() {
  const farmsReady = useApp((s) => s.farmsReady);
  const farmId = useApp((s) => s.farmId);
  const hasData = useApp((s) => !!s.data);
  const loadError = useApp((s) => s.loadError);
  const loading = useApp((s) => s.loading);
  const openFarm = useApp((s) => s.openFarm);

  if (!farmsReady) {
    return (
      <p className="k m-0" role="status">
        Carregando…
      </p>
    );
  }
  if (!farmId) return <Navigate to="/fazendas" replace />;
  if (hasData) return <Outlet />;
  if (loadError && !loading) {
    return (
      <section className="card flex flex-col items-start gap-3.5" role="alert">
        <p className="m-0 text-sm">{loadError}</p>
        <button type="button" className="btn btn-pri" onClick={() => void openFarm(farmId)}>
          Tentar de novo
        </button>
      </section>
    );
  }
  return (
    <p className="k m-0" role="status">
      Carregando a fazenda…
    </p>
  );
}
