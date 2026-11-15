import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { lazyScreen } from './lib/lazyScreen';
import { Painel } from './pages/Painel';
import { Mapa } from './pages/Mapa';
import { Rebanho } from './pages/Rebanho';
import { Clima } from './pages/Clima';

// Regra do CLAUDE.md: telas de campo (painel, mapa, rebanho, clima) nunca ficam
// em chunk sob demanda. Só a Análise, que é tela de escritório, pode ser lazy.
const Analise = lazyScreen(() => import('./pages/Analise'));

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Painel />} />
        <Route path="mapa" element={<Mapa />} />
        <Route path="rebanho" element={<Rebanho />} />
        <Route path="clima" element={<Clima />} />
        <Route path="analise" element={<Analise />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
