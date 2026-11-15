import { Component, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';

/** Tempo máximo de espera por um chunk antes de oferecer "tentar de novo" (CLAUDE.md: 8 s). */
export const LAZY_TIMEOUT_MS = 8000;

type Loader = () => Promise<{ default: ComponentType }>;

/**
 * Tela de escritório carregada sob demanda. Sem sinal, o download do chunk pode
 * pendurar para sempre; depois de 8 s a tela para de girar e oferece nova tentativa.
 * Não usar em ação de campo (chuva, mudança de gado): essas vão no pacote principal.
 */
export function lazyScreen(loader: Loader): ComponentType {
  return function LazyScreen() {
    const [attempt, setAttempt] = useState(0);
    // Cada tentativa cria um lazy novo; o anterior guarda a promessa que falhou ou pendurou.
    const Screen = useMemo(() => lazy(loader), [attempt]);
    const retry = () => setAttempt((a) => a + 1);

    return (
      <ChunkBoundary key={attempt} onRetry={retry}>
        <Suspense fallback={<Waiting onRetry={retry} />}>
          <Screen />
        </Suspense>
      </ChunkBoundary>
    );
  };
}

function Waiting({ onRetry }: { onRetry: () => void }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), LAZY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  if (slow) return <RetryCard text="A tela demorou para carregar. Pode ser falta de sinal." onRetry={onRetry} />;
  return (
    <p className="k m-0" role="status">
      Carregando…
    </p>
  );
}

function RetryCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <section className="card flex flex-col items-start gap-3.5" role="alert">
      <p className="m-0 text-sm">{text}</p>
      <button type="button" className="btn btn-pri" onClick={onRetry}>
        Tentar de novo
      </button>
    </section>
  );
}

class ChunkBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <RetryCard text="Não deu para carregar esta tela." onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}
