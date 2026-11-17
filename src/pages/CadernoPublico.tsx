import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FarmMap, type MapShape } from '../components/FarmMap';
import type { NotebookContext, NotebookReport } from '../data/types';
import { nf } from '../lib/format';
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
import { pointInPolygon } from '../lib/geo';
import { geoProblem, useGeolocation } from '../lib/useGeolocation';
import { useOnline } from '../lib/useOnline';
import { useNotebookApi } from '../state/AppContext';
import { Back, BigButton, Emoji, Message, NumPad, Result, Step, WhenPicker, type When } from '../components/fieldUi';

/** Intervalo entre tentativas de envio com a página aberta (CLAUDE.md: a cada 2 min). */
export const SYNC_INTERVAL_MS = 120_000;
/** A lista de pastos e lotes traz o mapinha; não precisa ser baixada a cada tentativa de envio. */
const CONTEXT_MAX_AGE_MS = 15 * 60_000;

type Screen = 'name' | 'home' | 'rain' | 'cattle' | 'sending' | 'sent' | 'saved' | 'rejected';

/** Um relato em uma frase curta. */
function reportText(r: NotebookReport, ctx: NotebookContext | null): string {
  if (r.kind === 'chuva') return `🌧️ ${nf(r.mm ?? 0, 1)} mm`;
  const lot = ctx?.lots.find((l) => l.id === r.lotId)?.name ?? 'lote';
  const paddock = ctx?.paddocks.find((p) => p.id === r.toPaddockId)?.name ?? 'pasto';
  return `🐮 ${lot} ➜ ${paddock}`;
}

/**
 * Caderno da fazenda: a página que o vaqueiro abre pelo link, sem login. Feita
 * para quem lê pouco: duas ações com figura grande (choveu, mudei o gado), um
 * passo por vez, números num teclado grande e o pasto escolhido tocando no mapa.
 * Mesmo desenho do caderno do PV Pro, a pedido do Lucas (16 nov 2026).
 *
 * É ação de campo: vai no pacote principal e funciona sem sinal. O relato é
 * guardado no aparelho antes de qualquer tentativa de envio.
 */
export function CadernoPublico({ token }: { token: string }) {
  const api = useNotebookApi();
  const online = useOnline();
  const [state, setState] = useState<NotebookState>(() => localNotebookStorage.load(token));
  const [invalid, setInvalid] = useState(false);
  const [checked, setChecked] = useState(false);
  const [notReady, setNotReady] = useState(false);
  const stateRef = useRef(state);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const contextAt = useRef(0);

  const commit = useCallback(
    (next: NotebookState) => {
      stateRef.current = next;
      setState(next);
      localNotebookStorage.save(token, next);
    },
    [token],
  );

  /** Envia o que está na fila e, se preciso, atualiza a lista de pastos e lotes. */
  const sync = useCallback(
    (refresh: boolean): Promise<void> => {
      if (running.current) {
        again.current = true;
        return running.current;
      }
      const loop = (async () => {
        let wantContext = refresh;
        do {
          again.current = false;
          const before = stateRef.current;
          const after = await syncQueue(before, api, token);
          // Relato feito enquanto o envio rodava entra no fim da fila, sem se perder.
          const added = stateRef.current.queue.filter((q) => !before.queue.some((b) => b.report.id === q.report.id));
          commit({ ...stateRef.current, queue: [...after.queue, ...added], sent: after.sent });
          const delivered = after.sent.length !== before.sent.length || after.sent[0]?.id !== before.sent[0]?.id;

          const stale = Date.now() - contextAt.current > CONTEXT_MAX_AGE_MS;
          if (wantContext || delivered || stale || !stateRef.current.context) {
            const ctx = await refreshContext(stateRef.current, api, token);
            setNotReady(!!ctx.notReady);
            if (ctx.invalid) setInvalid(true);
            else if (ctx.notReady) {
              /* o banco ainda não tem o caderno */
            } else if (!ctx.offline) {
              setInvalid(false);
              contextAt.current = Date.now();
              commit({ ...stateRef.current, context: ctx.state.context });
            }
            wantContext = false;
          }
          setChecked(true);
        } while (again.current);
      })().finally(() => {
        running.current = null;
      });
      running.current = loop;
      return loop;
    },
    [api, token, commit],
  );

  // Envia ao abrir, quando o sinal volta, quando a página volta para a frente e a cada 2 min.
  useEffect(() => {
    void sync(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync(false);
    };
    const onOnline = () => void sync(true);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void sync(false), SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [sync]);

  const [screen, setScreen] = useState<Screen>(state.reporter ? 'home' : 'name');
  const [name, setName] = useState(state.reporter);
  const [mm, setMm] = useState('');
  const [when, setWhen] = useState<When>('hoje');
  const [otherDay, setOtherDay] = useState('');
  const [lotId, setLotId] = useState('');
  const [destId, setDestId] = useState('');
  const [refusal, setRefusal] = useState('');

  const ctx = state.context;
  const pending = pendingCount(state);
  const rejected = state.queue.filter((q) => q.state === 'recusado');
  const today = todayLocal();
  const date = when === 'hoje' ? today : when === 'ontem' ? addDays(today, -1) : otherDay;
  const dateOk = !!date && date <= today;

  /** Onde o lote está: o que este aparelho anotou e ainda não enviou vale mais que a lista recebida. */
  const whereIs = useCallback(
    (id: string): string | null => {
      const mine = [...state.queue].reverse().find((q) => q.state === 'pendente' && q.report.kind === 'mudanca' && q.report.lotId === id);
      return mine?.report.toPaddockId ?? ctx?.lots.find((l) => l.id === id)?.paddockId ?? null;
    },
    [state.queue, ctx],
  );
  const paddockName = (id: string | null | undefined) => ctx?.paddocks.find((p) => p.id === id)?.name;
  const lot = ctx?.lots.find((l) => l.id === lotId);
  const here = lotId ? whereIs(lotId) : null;

  const shapes: MapShape[] = useMemo(
    () => (ctx?.paddocks ?? []).filter((p) => (p.outline?.length ?? 0) >= 3).map((p) => ({ id: p.id, name: p.name, rings: [p.outline!] })),
    [ctx?.paddocks],
  );

  // GPS: no passo "pra qual pasto foi", o aparelho pode dizer em que pasto a pessoa está.
  const [locating, setLocating] = useState(false);
  const gps = useGeolocation(locating && screen === 'cattle');
  const herePaddock = useMemo(() => {
    if (!ctx || gps.lat == null || gps.lon == null) return null;
    return ctx.paddocks.find((p) => (p.outline?.length ?? 0) >= 3 && pointInPolygon([gps.lon!, gps.lat!], [p.outline!])) ?? null;
  }, [ctx, gps.lat, gps.lon]);

  const home = () => {
    setLocating(false);
    setScreen('home');
    setMm('');
    setLotId('');
    setDestId('');
    setWhen('hoje');
    setOtherDay('');
  };

  const send = async (report: NotebookReport) => {
    // Primeiro guarda no aparelho; só depois tenta enviar.
    commit(enqueue(stateRef.current, report));
    if (!navigator.onLine) {
      setScreen('saved');
      void sync(false);
      return;
    }
    setScreen('sending');
    await sync(false);
    const left = stateRef.current.queue.find((q) => q.report.id === report.id);
    if (!left) setScreen('sent');
    else if (left.state === 'recusado') {
      setRefusal(left.error ?? 'O relato não foi aceito.');
      commit(dropQueued(stateRef.current, report.id));
      setScreen('rejected');
    } else setScreen('saved');
  };

  const base = () => ({
    id: crypto.randomUUID(),
    date,
    deviceCreatedAt: new Date().toISOString(),
    ...(state.reporter ? { reporter: state.reporter } : {}),
  });
  const rain = Number(mm.replace(',', '.'));
  const rainOk = rain > 0 && rain <= 500 && dateOk;

  // ── telas que não dependem da lista da fazenda ──
  if (invalid) {
    return (
      <Frame farm="" online={online} pending={pending}>
        <Message emoji="🔗" title="Link não funciona" text="Peça o link novo pro responsável." />
      </Frame>
    );
  }
  if (!ctx) {
    return (
      <Frame farm="" online={online} pending={pending}>
        {notReady ? (
          <Message emoji="🛠️" title="Caderno ainda não ligado" text="Avise o responsável: falta ligar o caderno no sistema." />
        ) : checked ? (
          <Message emoji="📵" title="Sem sinal" text="Abra esta página uma vez com internet. Depois ela funciona sem sinal." />
        ) : (
          <p className="k m-0 py-16 text-center text-lg" role="status">
            Carregando…
          </p>
        )}
      </Frame>
    );
  }

  return (
    <Frame farm={ctx.farmName} online={online} pending={pending}>
      {/* ── nome (só na primeira vez) ── */}
      {screen === 'name' ? (
        <div className="flex flex-col gap-4 pt-6">
          <Emoji size="text-6xl">👋</Emoji>
          <div className="text-center">
            <h2 className="m-0 font-display text-[26px] font-bold">Qual seu nome?</h2>
            <p className="k m-0 mt-1">Só precisa uma vez.</p>
          </div>
          <input
            className="in min-h-[60px] text-center text-[22px]"
            aria-label="Seu nome"
            placeholder="Ex: João"
            autoComplete="given-name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <BigButton
            disabled={!name.trim()}
            onClick={() => {
              commit({ ...stateRef.current, reporter: name.trim() });
              setScreen('home');
            }}
          >
            PRONTO ✓
          </BigButton>
        </div>
      ) : null}

      {/* ── início: duas ações com figura grande ── */}
      {screen === 'home' ? (
        <div className="flex flex-col gap-4">
          <h2 className="m-0 text-center font-display text-[22px] font-bold">O que aconteceu?</h2>
          <button type="button" aria-label="Choveu" onClick={() => setScreen('rain')} className="flex cursor-pointer flex-col items-center gap-1 rounded-[28px] border-4 border-proj bg-proj/10 py-8 active:scale-[0.98]">
            <Emoji size="text-7xl">🌧️</Emoji>
            <span className="font-display text-[30px] font-extrabold text-proj">CHOVEU</span>
          </button>
          <button type="button" aria-label="Mudei o gado" onClick={() => setScreen('cattle')} className="flex cursor-pointer flex-col items-center gap-1 rounded-[28px] border-4 border-lime bg-lime/10 py-8 active:scale-[0.98]">
            <Emoji size="text-7xl">🐮</Emoji>
            <span className="font-display text-[30px] font-extrabold text-lime">MUDEI O GADO</span>
          </button>
          <p className="k m-0 text-center">
            {state.reporter} ·{' '}
            <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-muted underline" onClick={() => setScreen('name')}>
              trocar nome
            </button>
          </p>

          {rejected.length ? (
            <section className="card flex flex-col gap-2 border-warn/60" aria-label="Não aceitos">
              <h3 className="m-0 font-display text-[17px] font-bold text-warn">⚠️ Não foi aceito ({rejected.length})</h3>
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

          {pending ? (
            <section className="card flex flex-col gap-2 border-warn/60" aria-label="Esperando sinal">
              <h3 className="m-0 font-display text-[17px] font-bold">📥 Esperando sinal ({pending})</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {state.queue
                  .filter((q) => q.state === 'pendente')
                  .map((q) => (
                    <li key={q.report.id}>
                      {formatDayMonth(q.report.date)} · {reportText(q.report, ctx)}
                    </li>
                  ))}
              </ul>
              <button type="button" className="btn self-start" onClick={() => void sync(false)}>
                Tentar enviar agora
              </button>
            </section>
          ) : null}

          {state.sent.length ? (
            <section className="card flex flex-col gap-2" aria-label="Enviados">
              <h3 className="m-0 font-display text-[17px] font-bold">✅ Já enviados</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-muted">
                {state.sent.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    {formatDayMonth(r.date)} · {reportText(r, ctx)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ── chuva ── */}
      {screen === 'rain' ? (
        <div className="flex flex-col gap-4">
          <Back onClick={home} />
          <h2 className="m-0 text-center font-display text-[26px] font-bold">🌧️ Quanto choveu?</h2>
          <div className="rounded-[24px] border-2 border-proj bg-proj/10 py-4 text-center" role="status" aria-label="Milímetros de chuva">
            <span className="big text-[60px] text-proj">{mm || '0'}</span>
            <span className="ml-2 text-xl text-proj">mm</span>
          </div>
          <NumPad value={mm} onChange={setMm} />
          <WhenPicker when={when} onWhen={setWhen} otherDay={otherDay} onOtherDay={setOtherDay} today={today} />
          <BigButton tone="blue" disabled={!rainOk} onClick={() => void send({ ...base(), kind: 'chuva', mm: rain })}>
            ENVIAR ✓
          </BigButton>
        </div>
      ) : null}

      {/* ── gado ── */}
      {screen === 'cattle' ? (
        <div className="flex flex-col gap-3.5">
          <Back onClick={home} />
          <h2 className="m-0 text-center font-display text-[26px] font-bold">🐮 Mudança de gado</h2>

          {!ctx.lots.length ? (
            <Message emoji="🐂" title="Sem lote cadastrado" text="Avise o responsável." />
          ) : (
            <>
              <Step n={1}>Qual lote mudou?</Step>
              <div className="flex flex-col gap-2" role="group" aria-label="Qual lote mudou?">
                {ctx.lots.map((l) => {
                  const on = l.id === lotId;
                  const at = paddockName(whereIs(l.id));
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setLotId(l.id);
                        setDestId('');
                      }}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-[18px] border-2 px-4 py-3.5 text-left text-text ${on ? 'border-lime bg-lime/10' : 'border-line2 bg-card'}`}
                    >
                      <span className="text-[19px] font-bold">
                        <Emoji inline>🐂</Emoji> {l.name}
                      </span>
                      <span className="k text-sm">
                        {at ? (
                          <>
                            está no <b className="text-text">{at}</b>
                          </>
                        ) : (
                          'sem pasto marcado'
                        )}
                        {l.heads ? ` · ${nf(l.heads)} cabeças` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {lot ? (
            <>
              <Step n={2}>Pra qual pasto foi?</Step>
              {shapes.length ? (
                <div className="rounded-[18px] border border-line bg-card p-2">
                  <FarmMap
                    label="Toque no pasto"
                    shapes={shapes}
                    selectedId={destId || null}
                    me={gps.status === 'ok' && gps.lat != null && gps.lon != null ? { lat: gps.lat, lon: gps.lon } : null}
                    onSelect={(id) => {
                      if (id !== here) setDestId(id);
                    }}
                    styleOf={(id) =>
                      id === destId
                        ? { fill: '#C6F24E', text: '#0B120E' }
                        : id === here
                          ? { fill: '#18211C', text: '#9DB0A3', dashed: true }
                          : { fill: '#2F6B4A', text: '#EEF3EC' }
                    }
                  />
                </div>
              ) : null}
              {shapes.length ? (
                <div className="flex flex-col gap-2">
                  {!locating ? (
                    <button type="button" className="min-h-[54px] cursor-pointer rounded-[16px] border-2 border-proj bg-proj/10 px-3 text-[17px] font-bold text-proj" onClick={() => setLocating(true)}>
                      📍 Estou nesse pasto agora
                    </button>
                  ) : gps.status === 'buscando' ? (
                    <p className="note text-center" role="status">📍 Procurando o GPS…</p>
                  ) : gps.status === 'ok' ? (
                    herePaddock && herePaddock.id !== here ? (
                      <button type="button" className="min-h-[54px] cursor-pointer rounded-[16px] border-2 border-lime bg-lime/10 px-3 text-[17px] font-bold text-lime" onClick={() => setDestId(herePaddock.id)}>
                        📍 Você está no {herePaddock.name}. Tocar para escolher
                      </button>
                    ) : (
                      <p className="note text-center" role="status">
                        📍 {herePaddock ? `Você está no ${herePaddock.name}, onde o lote já estava.` : 'Você está fora dos pastos do mapa. Escolha no mapa ou nos botões.'}
                      </p>
                    )
                  ) : (
                    <p className="err" role="alert">{geoProblem(gps.status)}</p>
                  )}
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Pra qual pasto foi?">
                {ctx.paddocks
                  .filter((p) => p.id !== here)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={p.id === destId}
                      onClick={() => setDestId(p.id)}
                      className={`min-h-[52px] cursor-pointer rounded-[14px] border-2 px-1 text-[16px] font-bold ${p.id === destId ? 'border-lime bg-lime text-ink' : 'border-line2 bg-card text-text'}`}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </>
          ) : null}

          {lot && destId ? (
            <>
              <Step n={3}>Quando foi?</Step>
              <WhenPicker when={when} onWhen={setWhen} otherDay={otherDay} onOtherDay={setOtherDay} today={today} />
              <p className="m-0 mt-1 text-center font-display text-[22px] font-bold" role="status">
                {lot.name} ➜ {paddockName(destId)}
              </p>
              <BigButton disabled={!dateOk} onClick={() => void send({ ...base(), kind: 'mudanca', lotId: lot.id, toPaddockId: destId })}>
                CONFIRMAR ✓
              </BigButton>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── resultado ── */}
      {screen === 'sending' ? (
        <p className="k m-0 py-16 text-center text-lg" role="status">
          Enviando…
        </p>
      ) : null}
      {screen === 'sent' ? (
        <Result emoji="✅" title="Enviado!" text="Informações enviadas. Obrigado!" onAgain={home} />
      ) : null}
      {screen === 'saved' ? (
        <Result emoji="📥" title="Guardado!" text="Sem sinal agora. Vai enviar sozinho quando pegar internet. Pode fechar." onAgain={home} />
      ) : null}
      {screen === 'rejected' ? <Result emoji="⚠️" title="Não deu certo" text={refusal} onAgain={home} /> : null}
    </Frame>
  );
}

function Frame({ farm, online, pending, children }: { farm: string; online: boolean; pending: number; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh]">
      <header className="border-b-4 border-lime bg-card px-4 pb-3.5 pt-4">
        <div className="mx-auto flex max-w-[480px] items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="eyebrow">Caderno da fazenda</span>
            {farm ? <h1 className="big m-0 truncate text-[26px]">{farm}</h1> : null}
          </div>
          <span role="status" className={`mt-1 inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${online ? 'border-line text-muted' : 'border-warn text-warn'}`}>
            <i aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-ramp-3' : 'bg-warn'}`} />
            {online ? 'Online' : 'Sem sinal'}
          </span>
        </div>
        {pending ? (
          <div className="mx-auto mt-2 max-w-[480px]">
            <span className="inline-block rounded-full bg-warn px-3 py-1 text-[13px] font-bold text-ink">📥 {pending} esperando sinal pra enviar</span>
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-[480px] px-4 pb-10 pt-5">{children}</main>
    </div>
  );
}

