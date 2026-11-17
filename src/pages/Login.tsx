import { useState, type FormEvent } from 'react';
import { ErrorText, Field, useAction } from '../components/ui';
import { useApp } from '../state/AppContext';

export function Login() {
  const signIn = useApp((s) => s.signIn);
  const signUp = useApp((s) => s.signUp);
  const [mode, setMode] = useState<'entrar' | 'criar'>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.');
      return;
    }
    if (mode === 'entrar') void run(() => signIn(email, password));
    else void run(() => signUp(email, password), (r) => setConfirmSent(r.needsConfirmation));
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col justify-center gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Gestão de pastagem</span>
        <h1 className="big m-0 text-[38px]">PVPro3</h1>
        <p className="k m-0">Lotação ocorrida, calculada das movimentações de gado.</p>
      </div>

      <form className="card flex flex-col gap-3.5" onSubmit={submit} noValidate>
        <div className="flex gap-2" role="group" aria-label="Entrar ou criar conta">
          <button type="button" className={`chip min-h-[44px] flex-1 justify-center ${mode === 'entrar' ? 'chip-on' : ''}`} aria-pressed={mode === 'entrar'} onClick={() => { setMode('entrar'); setError(null); }}>
            Entrar
          </button>
          <button type="button" className={`chip min-h-[44px] flex-1 justify-center ${mode === 'criar' ? 'chip-on' : ''}`} aria-pressed={mode === 'criar'} onClick={() => { setMode('criar'); setError(null); }}>
            Criar conta
          </button>
        </div>

        <Field label="E-mail">
          {(id) => (
            <input id={id} className="in" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        {mode === 'criar' ? (
          <p className="note m-0">Só cria conta quem recebeu convite. Use o mesmo e-mail que o consultor cadastrou.</p>
        ) : null}
        <Field label="Senha" hint={mode === 'criar' ? 'Pelo menos 8 caracteres, com letras e números.' : undefined}>
          {(id) => (
            <input id={id} className="in" type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>

        <ErrorText>{error}</ErrorText>
        {confirmSent ? (
          <p className="note" role="status">
            Conta criada. Abra o e-mail que chegou, toque no link de confirmação e depois entre aqui.
          </p>
        ) : null}

        <button type="submit" className="btn btn-pri" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>

      <p className="k m-0 text-xs">Depois de entrar uma vez, o app abre neste aparelho mesmo sem sinal.</p>
    </main>
  );
}
