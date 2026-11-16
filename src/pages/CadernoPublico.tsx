import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorText, Field } from '../components/ui';
import type { NotebookContext, NotebookReport, ReportKind } from '../data/types';
import { nf, parseNum } from '../lib/format';
import { addDays, formatDayMonth, todayLocal } from '../lib/lots/dates';
import {
  dropQueued,
  enqueue,
  localNotebookStorage,
  pendingCount,
  refreshContext,
  syncQueue,
  type NotebookState,
} from '../lib/notebook/queue';
import { useOnline } from '../lib/useOnline';
import { useNotebookApi } from '../state/AppContext';

/** Intervalo entre tentativas de envio com a página aberta (CLAUDE.md: a cada 2 min). */
export const SYNC_INTERVAL_MS = 120_000;

type DateMode = 'hoje' | 'ontem' | 'outra';

/** Um relato em uma frase, para as listas de pendentes e enviados. */
function reportText(r: NotebookReport, ctx: NotebookContext | null): string {
  if (r.kind === 'chuva') return `Chuva: ${nf(r.mm ?? 0, 1)} mm`;
  const lot = ctx?.lots.find((l) => l.id === r.lotId)?.name ?? 'lote';
  const paddock = ctx?.paddocks.find((p) => p.id === r.toPaddockId)?.name ?? 'piquete';
  return `${lot} foi para ${paddock}`;
}

/**
 * Caderno da equipe: a página que o vaqueiro abre pelo link, sem login. Só chuva
 * e mudança de gado. É ação de campo: vai no pacote principal e funciona sem
 * sinal, guardando o relato no aparelho até conseguir enviar.
 */
export function CadernoPublico({ token }: { token: string }) {
  const api = useNotebookApi();
  const online = useOnline();
  const [state, setState] = useState<NotebookState>(() => localNotebookStorage.load(token));
  const [invalid, setInvalid] = useState(false);
  const [checked, setChecked] = useState(false);
  const stateRef = useRef(state);
  const running = useRef(false);
  const again = useRef(false);

  const commit = useCallback(
    (next: NotebookState) => {
      stateRef.current = next;
      setState(next);
      localNotebookStorage.save(token, next);
    },
    [token],
  );

  /** Atualiza a lista de piquetes e lotes e tenta enviar o que está na fila. */
  const sync = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const ctx = await refreshContext(stateRef.current, api, token);
        if (ctx.invalid) setInvalid(true);
        else if (!ctx.offline) {
          setInvalid(false);
          commit({ ...stateRef.current, context: ctx.state.context });
        }
        setChecked(true);

        const before = stateRef.current;
        const after = await syncQueue(before, api, token);
        // Relato feito enquanto o envio rodava entra no fim da fila, sem se perder.
        const added = stateRef.current.queue.filter((q) => !before.queue.some((b) => b.report.id === q.report.id));
        commit({ ...stateRef.current, queue: [...after.queue, ...added], sent: after.sent });
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [api, token, commit]);

  // Envia ao abrir, quando o sinal volta, quando a página volta para a frente e a cada 2 min.
  useEffect(() => {
    void sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [sync]);

  const [kind, setKind] = useState<ReportKind>('mudanca');
  const [dateMode, setDateMode] = useState<DateMode>('hoje');
  const [customDate, setCustomDate] = useState('');
  const [mm, setMm] = useState('');
  const [lotId, setLotId] = useState('');
  const [paddockId, setPaddockId] = useState('');
  const [note, setNote] = useState('');
  const [reporter, setReporter] = useState(state.reporter);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ctx = state.context;
  const pending = pendingCount(state);
  const rejected = state.queue.filter((q) => q.state === 'recusado');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    const today = todayLocal();
    const date = dateMode === 'hoje' ? today : dateMode === 'ontem' ? addDays(today, -1) : customDate;
    if (!date) return setError('Escolha a data.');
    if (date > today) return setError('A data não pode ser depois de hoje.');

    const base = {
      id: crypto.randomUUID(),
      date,
      deviceCreatedAt: new Date().toISOString(),
      ...(reporter.trim() ? { reporter: reporter.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    let report: NotebookReport;
    if (kind === 'chuva') {
      const value = parseNum(mm);
      if (!(value >= 0) || value > 500) return setError('Informe quantos milímetros choveu (0 a 500).');
      report = { ...base, kind: 'chuva', mm: value };
    } else {
      if (!lotId) return setError('Escolha o lote.');
      if (!paddockId) return setError('Escolha o piquete para onde o lote foi.');
      report = { ...base, kind: 'mudanca', lotId, toPaddockId: paddockId };
    }

    setError(null);
    // Primeiro guarda no aparelho; só depois tenta enviar.
    commit(enqueue(stateRef.current, report));
    setMm('');
    setLotId('');
    setPaddockId('');
    setNote('');
    setDateMode('hoje');
    setDone(`Anotado: ${reportText(report, ctx)}, em ${formatDayMonth(date)}.`);
    void sync();
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[520px] flex-col gap-4 px-3.5 pb-10 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="eyebrow">Caderno da equipe</span>
          <h1 className="big m-0 truncate text-[26px]">{ctx?.farmName ?? 'Fazenda'}</h1>
        </div>
        <span
          role="status"
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
            online ? 'border-line text-muted' : 'border-warn text-warn'
          }`}
        >
          <i aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-ramp-3' : 'bg-warn'}`} />
          {online ? 'Online' : 'Sem sinal'}
        </span>
      </header>

      {invalid ? (
        <section className="card flex flex-col gap-2" role="alert">
          <h2 className="h2">Este link não vale mais</h2>
          <p className="k m-0">O link do caderno foi trocado. Peça o link novo ao consultor.</p>
        </section>
      ) : !ctx ? (
        <section className="card flex flex-col gap-2" role="status">
          {checked ? (
            <>
              <h2 className="h2">Sem sinal</h2>
              <p className="k m-0">Este aparelho ainda não guardou a lista de piquetes e lotes. Abra esta página uma vez com internet; depois ela funciona sem sinal.</p>
            </>
          ) : (
            <p className="k m-0">Abrindo o caderno…</p>
          )}
        </section>
      ) : (
        <form className="card flex flex-col gap-3.5" onSubmit={submit} noValidate>
          <div className="flex gap-2" role="group" aria-label="O que aconteceu">
            {(['mudanca', 'chuva'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip min-h-[48px] flex-1 justify-center text-[15px] ${kind === k ? 'chip-on' : ''}`}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setError(null);
                }}
              >
                {k === 'mudanca' ? 'Mudança de gado' : 'Chuva'}
              </button>
            ))}
          </div>

          <div className="field">
            <span className="label">Quando foi</span>
            <div className="flex gap-2" role="group" aria-label="Quando foi">
              {(['hoje', 'ontem', 'outra'] as const).map((m) => (
                <button key={m} type="button" className={`chip min-h-[44px] flex-1 justify-center ${dateMode === m ? 'chip-on' : ''}`} aria-pressed={dateMode === m} onClick={() => setDateMode(m)}>
                  {m === 'hoje' ? 'Hoje' : m === 'ontem' ? 'Ontem' : 'Outro dia'}
                </button>
              ))}
            </div>
            {dateMode === 'outra' ? (
              <input className="in" type="date" aria-label="Data" max={todayLocal()} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
            ) : null}
          </div>

          {kind === 'chuva' ? (
            <Field label="Quantos milímetros choveu" hint="Leitura do pluviômetro. Se olhou e não choveu, ponha 0.">
              {(id) => <input id={id} className="in" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} />}
            </Field>
          ) : (
            <>
              <Field label="Lote">
                {(id) => (
                  <select id={id} className="in" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                    <option value="">Escolha…</option>
                    {ctx.lots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Foi para o piquete">
                {(id) => (
                  <select id={id} className="in" value={paddockId} onChange={(e) => setPaddockId(e.target.value)}>
                    <option value="">Escolha…</option>
                    {ctx.paddocks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {!ctx.lots.length ? <p className="note">Ainda não há lote cadastrado nesta fazenda. Avise o consultor.</p> : null}
            </>
          )}

          <Field label="Observação (opcional)">{(id) => <input id={id} className="in" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Field label="Seu nome (opcional)">{(id) => <input id={id} className="in" value={reporter} maxLength={60} autoComplete="name" onChange={(e) => setReporter(e.target.value)} />}</Field>

          <ErrorText>{error}</ErrorText>
          <button type="submit" className="btn btn-pri min-h-[52px] text-[16px]">
            Anotar
          </button>
          {done ? (
            <p className="note" role="status">
              {done} {pending ? 'Vai ser enviado quando houver sinal.' : 'Enviado ao consultor.'}
            </p>
          ) : null}
        </form>
      )}

      {pending ? (
        <section className="card flex flex-col gap-2 border-warn/60" aria-label="Aguardando sinal">
          <h2 className="h2">Aguardando sinal ({pending})</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {state.queue
              .filter((q) => q.state === 'pendente')
              .map((q) => (
                <li key={q.report.id}>
                  {formatDayMonth(q.report.date)} · {reportText(q.report, ctx)}
                </li>
              ))}
          </ul>
          <p className="k m-0 text-xs">Está guardado neste aparelho e vai sozinho quando o sinal voltar. Pode fechar a página.</p>
          <button type="button" className="btn self-start" onClick={() => void sync()}>
            Tentar enviar agora
          </button>
        </section>
      ) : null}

      {rejected.length ? (
        <section className="card flex flex-col gap-2 border-warn/60" aria-label="Não aceitos">
          <h2 className="h2 text-warn">Não aceitos ({rejected.length})</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {rejected.map((q) => (
              <li key={q.report.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="flex min-w-0 flex-col text-sm">
                  <span>
                    {formatDayMonth(q.report.date)} · {reportText(q.report, ctx)}
                  </span>
                  <span className="text-warn">{q.error}</span>
                </span>
                <button type="button" className="btn shrink-0 px-3 text-[13px]" onClick={() => commit(dropQueued(stateRef.current, q.report.id))}>
                  Apagar
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.sent.length ? (
        <section className="card flex flex-col gap-2" aria-label="Enviados">
          <h2 className="h2">Enviados</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-muted">
            {state.sent.map((r) => (
              <li key={r.id}>
                {formatDayMonth(r.date)} · {reportText(r, ctx)}
              </li>
            ))}
          </ul>
          <p className="k m-0 text-xs">O consultor confere e lança. Se anotou errado, avise ele.</p>
        </section>
      ) : null}
    </main>
  );
}
