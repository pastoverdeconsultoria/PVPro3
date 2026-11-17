import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../state/AppContext';
import { Actions, ErrorText, Field, useAction } from './ui';

/** Dados da fazenda aberta e quem tem acesso a ela. Fica na tela Fazendas. */
export function FarmSettings() {
  const farm = useApp((s) => s.data?.farm);
  const ready = useApp((s) => s.data?.fertilizationReady !== false);
  if (!farm) return null;
  return (
    <>
      <RenameFarm key={farm.id} name={farm.name} municipality={farm.municipality ?? ''} />
      {ready ? (
        <Members />
      ) : (
        <section className="card flex flex-col gap-2 border-warn/60" aria-label="Quem tem acesso" role="alert">
          <h2 className="h2 text-warn">Falta preparar o banco para dar acesso a outras contas</h2>
          <p className="k m-0 max-w-[70ch]">
            No Supabase, abra o SQL Editor, cole o arquivo <b>supabase/migrations/20261117120000_adubacao_membros.sql</b> e rode uma vez. Depois atualize esta tela.
          </p>
        </section>
      )}
    </>
  );
}

function RenameFarm({ name: current, municipality: currentCity }: { name: string; municipality: string }) {
  const renameFarm = useApp((s) => s.renameFarm);
  const [name, setName] = useState(current);
  const [municipality, setMunicipality] = useState(currentCity);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const changed = name.trim() !== current || municipality.trim() !== currentCity;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void run(() => renameFarm({ name, municipality }), () => setSaved(true));
  };

  return (
    <form className="card flex flex-col gap-3" aria-label="Dados da fazenda aberta" onSubmit={submit} noValidate>
      <h2 className="h2">Dados da fazenda aberta</h2>
      <div className="grid gap-3 desk:grid-cols-2">
        <Field label="Nome">{(id) => <input id={id} className="in" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Município">{(id) => <input id={id} className="in" value={municipality} placeholder="Cidade, UF" onChange={(e) => setMunicipality(e.target.value)} />}</Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <Actions>
        <button type="submit" className="btn" disabled={busy || !changed}>
          {busy ? 'Gravando…' : 'Gravar'}
        </button>
        {saved && !changed ? (
          <span className="k self-center text-sm" role="status">
            Gravado.
          </span>
        ) : null}
      </Actions>
      <p className="k m-0 text-xs">O mapa não é alterado aqui. Redesenhar piquete ou reimportar o KML ainda não existe.</p>
    </form>
  );
}

function Members() {
  const members = useApp((s) => s.members);
  const invites = useApp((s) => s.invites);
  const me = useApp((s) => s.user?.id);
  const loadMembers = useApp((s) => s.loadMembers);
  const addMember = useApp((s) => s.addMember);
  const removeMember = useApp((s) => s.removeMember);
  const cancelInvite = useApp((s) => s.cancelInvite);
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ email: string; kind: 'member' | 'invited' } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = useAction();
  const add = useAction();
  const remove = useAction();

  useEffect(() => {
    void load.run(() => loadMembers());
    // Só ao abrir a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMembers]);

  const owner = members?.find((m) => m.userId === me)?.role === 'owner';

  return (
    <section className="card flex flex-col gap-3" aria-label="Quem tem acesso">
      <h2 className="h2">Quem tem acesso</h2>
      <ErrorText>{load.error}</ErrorText>
      {members ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{m.email || 'conta sem e-mail'}</span>
                <span className="k text-xs">
                  {m.role === 'owner' ? 'dono' : 'acesso completo'}
                  {m.userId === me ? ' · você' : ''}
                </span>
              </span>
              {owner && m.userId !== me ? (
                confirm === m.userId ? (
                  <span className="flex shrink-0 gap-1.5">
                    <button type="button" className="btn btn-danger px-3 text-[13px]" disabled={remove.busy} onClick={() => void remove.run(() => removeMember(m.userId), () => setConfirm(null))}>
                      Tirar acesso
                    </button>
                    <button type="button" className="btn px-3 text-[13px]" onClick={() => setConfirm(null)}>
                      Não
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn shrink-0 px-3 text-[13px]" aria-label={`Tirar o acesso de ${m.email}`} onClick={() => setConfirm(m.userId)}>
                    Tirar
                  </button>
                )
              ) : null}
            </li>
          ))}
          {owner
            ? invites?.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 border-t border-line py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{i.email}</span>
                    <span className="text-xs text-warn">convidado · ainda não criou a conta</span>
                  </span>
                  {confirm === i.id ? (
                    <span className="flex shrink-0 gap-1.5">
                      <button type="button" className="btn btn-danger px-3 text-[13px]" disabled={remove.busy} onClick={() => void remove.run(() => cancelInvite(i.id), () => setConfirm(null))}>
                        Cancelar convite
                      </button>
                      <button type="button" className="btn px-3 text-[13px]" onClick={() => setConfirm(null)}>
                        Não
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn shrink-0 px-3 text-[13px]" aria-label={`Cancelar o convite de ${i.email}`} onClick={() => setConfirm(i.id)}>
                      Cancelar
                    </button>
                  )}
                </li>
              ))
            : null}
        </ul>
      ) : !load.error ? (
        <p className="k m-0" role="status">
          Carregando…
        </p>
      ) : null}
      <ErrorText>{remove.error}</ErrorText>

      {owner ? (
        <form
          className="flex flex-col gap-3 border-t border-line pt-3"
          aria-label="Dar acesso a outra conta"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            const sent = email.trim();
            void add.run(
              () => addMember(sent),
              (kind) => {
                setEmail('');
                setDone({ email: sent, kind });
              },
            );
          }}
        >
          <Field label="Dar acesso pelo e-mail" hint="A pessoa vê e grava tudo desta fazenda, e só desta. Se ela ainda não tem conta, fica convidada: só e-mail convidado consegue criar conta no app.">
            {(id) => <input id={id} className="in" type="email" inputMode="email" autoCapitalize="none" placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <ErrorText>{add.error}</ErrorText>
          {done ? (
            <p className="note m-0" role="status">
              {done.kind === 'member' ? (
                <>
                  <b>{done.email}</b> já tinha conta e agora tem acesso a esta fazenda.
                </>
              ) : (
                <>
                  Convite criado. Mande para <b>{done.email}</b> o endereço <b>{window.location.origin}</b> e peça para tocar em <b>Criar conta</b> com esse mesmo e-mail. A fazenda aparece sozinha quando ela entrar.
                </>
              )}
            </p>
          ) : null}
          <button type="submit" className="btn btn-pri self-start" disabled={add.busy}>
            {add.busy ? 'Aguarde…' : 'Dar acesso'}
          </button>
        </form>
      ) : members ? (
        <p className="k m-0 text-xs">Só o dono da fazenda dá ou tira acesso.</p>
      ) : null}
    </section>
  );
}
