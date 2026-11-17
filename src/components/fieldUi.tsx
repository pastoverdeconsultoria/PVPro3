import type { ReactNode } from 'react';

// Peças de tela do caderno: botões grandes, emoji explicativo e teclado numérico,
// pensados para quem lê pouco e usa o celular no campo. Usadas no link público
// do vaqueiro e na tela Campo do app.

export function Emoji({ children, size = '', inline = false }: { children: string; size?: string; inline?: boolean }) {
  return (
    <span aria-hidden="true" className={`${inline ? '' : 'block text-center'} leading-none ${size}`}>
      {children}
    </span>
  );
}

export function Message({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <section className="card mt-6 flex flex-col gap-2 text-center" role="alert">
      <Emoji size="text-5xl">{emoji}</Emoji>
      <h2 className="m-0 font-display text-[22px] font-bold">{title}</h2>
      <p className="k m-0 text-base">{text}</p>
    </section>
  );
}

export function Result({ emoji, title, text, onAgain }: { emoji: string; title: string; text: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4 pt-8 text-center" role="status">
      <Emoji size="text-7xl">{emoji}</Emoji>
      <h2 className="m-0 font-display text-[28px] font-bold">{title}</h2>
      <p className="m-0 px-2 text-base text-muted">{text}</p>
      <BigButton onClick={onAgain}>REGISTRAR OUTRA COISA</BigButton>
    </div>
  );
}

export function BigButton({ children, onClick, disabled, tone = 'lime' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'lime' | 'blue' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`mt-1 min-h-[62px] w-full cursor-pointer rounded-[20px] border-0 font-display text-[22px] font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-40 ${tone === 'blue' ? 'bg-proj' : 'bg-lime'}`}
    >
      {children}
    </button>
  );
}

export function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[44px] cursor-pointer self-start border-0 bg-transparent p-0 text-base font-medium text-muted">
      ← Voltar
    </button>
  );
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h3 className="m-0 mt-1 text-[18px] font-bold">
      {n}. {children}
    </h3>
  );
}

export type When = 'hoje' | 'ontem' | 'outro';

/** Hoje, ontem ou outro dia: o vaqueiro costuma avisar depois, então a data é sempre perguntada. */
export function WhenPicker({ when, onWhen, otherDay, onOtherDay, today }: { when: When; onWhen: (w: When) => void; otherDay: string; onOtherDay: (d: string) => void; today: string }) {
  const label: Record<When, string> = { hoje: '☀️ Hoje', ontem: '🌙 Ontem', outro: '📅 Outro' };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Quando foi">
        {(['hoje', 'ontem', 'outro'] as const).map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={when === w}
            onClick={() => onWhen(w)}
            className={`min-h-[54px] cursor-pointer rounded-[16px] border-2 px-1 text-[16px] font-bold ${when === w ? 'border-lime bg-lime text-ink' : 'border-line2 bg-card text-text'}`}
          >
            {label[w]}
          </button>
        ))}
      </div>
      {when === 'outro' ? (
        <input className="in min-h-[54px] text-center text-[18px]" type="date" aria-label="Data" max={today} value={otherDay} onChange={(e) => onOtherDay(e.target.value)} />
      ) : null}
    </div>
  );
}

/** Teclado numérico grande, sem abrir o teclado do celular. */
export function NumPad({ value, onChange, maxInt = 3, decimals = 1 }: { value: string; onChange: (v: string) => void; maxInt?: number; decimals?: number }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? ',' : '', '0', '⌫'];
  const press = (k: string) => {
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === ',') {
      if (!decimals || value.includes(',') || value === '') return;
      return onChange(`${value},`);
    }
    // Padrão: até três algarismos antes da vírgula e um depois (0,1 a 500 mm).
    const [int, dec] = value.split(',');
    if (dec !== undefined ? dec.length >= decimals : int.length >= maxInt) return;
    onChange(value + k);
  };
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Teclado numérico">
      {keys.map((k, i) =>
        k === '' ? (
          <span key={`vazio-${i}`} />
        ) : (
          <button
            key={k}
            type="button"
            aria-label={k === '⌫' ? 'Apagar' : k === ',' ? 'Vírgula' : k}
            onClick={() => press(k)}
            className="min-h-[58px] cursor-pointer rounded-[16px] border border-line2 bg-card font-display text-[26px] font-bold text-text active:bg-line"
          >
            {k}
          </button>
        ),
      )}
    </div>
  );
}
