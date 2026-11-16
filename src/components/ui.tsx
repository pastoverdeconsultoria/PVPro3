import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Result } from '../lib/lots/changes';
import { Icon } from './Icon';

/** Campo de formulário com rótulo ligado ao controle. `children` recebe o id. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <span className="k text-xs">{hint}</span> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="err" role="alert">
      {children}
    </p>
  );
}

/**
 * Folha que sobe de baixo no celular e vira caixa central no desktop. Fecha com
 * Esc, no X ou tocando fora. Fica acima da navegação.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 desk:items-center desk:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[92dvh] w-full max-w-[560px] flex-col rounded-t-[22px] border border-line bg-card desk:rounded-[22px]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="h2">{title}</h2>
          <button type="button" className="btn h-[44px] w-[44px] !px-0" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex flex-col gap-3.5 overflow-y-auto px-4 pb-6 pt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Estado de uma gravação: ocupado e mensagem de erro. `run` chama a ação e, se
 * deu certo, `onOk`. Enquanto grava, o botão fica travado para não gravar duas vezes.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(action: () => Promise<Result<T>>, onOk?: (value: T) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (r.ok) onOk?.(r.value);
      else setError(r.error);
    } catch {
      setError('Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, run };
}

/** Linha de botões no pé de um formulário. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex flex-wrap gap-2.5">{children}</div>;
}

/** Rótulo e valor empilhados, para os números dos cartões. */
export function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'lime' | 'warn' | 'unk' }) {
  const color = tone === 'lime' ? 'text-lime' : tone === 'warn' ? 'text-warn' : tone === 'unk' ? 'text-unk' : '';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={`big text-[22px] ${color}`}>{value}</span>
      <span className="k text-xs">
        {unit ? `${unit} · ` : ''}
        {label}
      </span>
    </div>
  );
}
