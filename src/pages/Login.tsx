import { useState, type FormEvent } from 'react';
import { ErrorText, Field, useAction } from '../components/ui';
import { useApp } from '../state/AppContext';

type Mode = 'entrar' | 'criar' | 'esqueci';

export function Login() {
  const signIn = useApp((s) => s.signIn);
  const signUp = useApp((s) => s.signUp);
  const requestPasswordReset = useApp((s) => s.requestPasswordReset);
  const recovery = useApp((s) => s.passwordRecovery);
  const [mode, setMode] = useState<Mode>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { busy, error, setError, run } = useAction();

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setResetSent(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'esqueci') {
      void run(() => requestPasswordReset(email), () => setResetSent(true));
      return;
    }
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

      {recovery ? (
        <p className="note m-0" role="alert">
          O link de senha nova expirou ou já foi usado. Peça outro em "Esqueci a senha".
        </p>
      ) : null}

      <form className="card flex flex-col gap-3.5" onSubmit={submit} noValidate>
        {mode === 'esqueci' ? (
          <h2 className="h2">Esqueci a senha</h2>
        ) : (
          <div className="flex gap-2" role="group" aria-label="Entrar ou criar conta">
            <button type="button" className={`chip min-h-[44px] flex-1 justify-center ${mode === 'entrar' ? 'chip-on' : ''}`} aria-pressed={mode === 'entrar'} onClick={() => go('entrar')}>
              Entrar
            </button>
            <button type="button" className={`chip min-h-[44px] flex-1 justify-center ${mode === 'criar' ? 'chip-on' : ''}`} aria-pressed={mode === 'criar'} onClick={() => go('criar')}>
              Criar conta
            </button>
          </div>
        )}

        {mode === 'criar' ? (
          <p className="note m-0">Só cria conta quem recebeu convite. Use o mesmo e-mail que o consultor cadastrou.</p>
        ) : null}
        {mode === 'esqueci' ? <p className="k m-0 text-sm">Informe o e-mail da conta. Chega um link para escolher a senha nova.</p> : null}

        <Field label="E-mail">
          {(id) => (
            <input id={id} className="in" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        {mode !== 'esqueci' ? (
          <Field label="Senha" hint={mode === 'criar' ? 'Pelo menos 8 caracteres, com letras e números.' : undefined}>
            {(id) => (
              <input id={id} className="in" type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
        ) : null}

        <ErrorText>{error}</ErrorText>
        {confirmSent ? (
          <p className="note" role="status">
            Conta criada. Abra o e-mail que chegou, toque no link de confirmação e depois entre aqui.
          </p>
        ) : null}
        {resetSent ? (
          <p className="note" role="status">
            Se esse e-mail tem conta, o link chegou. Abra o e-mail neste aparelho e toque no link. Não chegou? Olhe o spam e espere alguns minutos antes de pedir de novo.
          </p>
        ) : null}

        <button type="submit" className="btn btn-pri" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : mode === 'criar' ? 'Criar conta' : 'Mandar o link'}
        </button>

        {mode === 'entrar' ? (
          <button type="button" className="min-h-[44px] cursor-pointer self-center border-0 bg-transparent p-0 text-sm text-muted underline" onClick={() => go('esqueci')}>
            Esqueci a senha
          </button>
        ) : mode === 'esqueci' ? (
          <button type="button" className="min-h-[44px] cursor-pointer self-center border-0 bg-transparent p-0 text-sm text-muted underline" onClick={() => go('entrar')}>
            ← Voltar para entrar
          </button>
        ) : null}
      </form>

      <p className="k m-0 text-xs">Depois de entrar uma vez, o app abre neste aparelho mesmo sem sinal.</p>
    </main>
  );
}

/** Volta do link do e-mail: a pessoa já está dentro da conta e escolhe a senha nova. */
export function NovaSenha() {
  const setNewPassword = useApp((s) => s.setNewPassword);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setError('As duas senhas não são iguais.');
      return;
    }
    void run(() => setNewPassword(password));
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col justify-center gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">PVPro3</span>
        <h1 className="big m-0 text-[32px]">Senha nova</h1>
      </div>
      <form className="card flex flex-col gap-3.5" aria-label="Senha nova" onSubmit={submit} noValidate>
        <Field label="Senha nova" hint="Pelo menos 8 caracteres, com letras e números.">
          {(id) => <input id={id} className="in" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Repita a senha nova">
          {(id) => <input id={id} className="in" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
        </Field>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn btn-pri" disabled={busy}>
          {busy ? 'Gravando…' : 'Gravar a senha nova'}
        </button>
      </form>
    </main>
  );
}
