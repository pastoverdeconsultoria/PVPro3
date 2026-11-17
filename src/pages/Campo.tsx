import { useMemo, useState } from 'react';
import { Back, BigButton, Emoji, NumPad, Result, Step, WhenPicker, type When } from '../components/fieldUi';
import { FarmMap, type MapShape } from '../components/FarmMap';
import { pointInPolygon } from '../lib/geo';
import { nf } from '../lib/format';
import { rainOn } from '../lib/farm/rain';
import { addDays, formatDayMonth, todayLocal } from '../lib/lots/dates';
import { geoProblem, useGeolocation } from '../lib/useGeolocation';
import type { LotView } from '../lib/farm/farmView';
import { useApp, useAppStore, useFarmView } from '../state/AppContext';

type Screen = 'home' | 'cattle' | 'rain' | 'weigh' | 'done';
/** O que acabou de ser gravado, para poder desfazer na hora. */
type Done = { title: string; text: string; undo: { kind: 'event'; lotId: string; eventId: string } | { kind: 'rain'; rainId: string } | null };

/**
 * Caderno dentro do app: troca de gado, chuva e pesagem, com botão grande e
 * emoji, no jeito do caderno do vaqueiro. Grava direto no histórico (não é
 * relato para revisar). É a tela de quem tem acesso "leitura + campo".
 */
export function Campo() {
  const fv = useFarmView();
  const store = useAppStore();
  const storeRef = () => store.getState().data;
  const data = useApp((s) => s.data);
  const moveLot = useApp((s) => s.moveLot);
  const addEvent = useApp((s) => s.addEvent);
  const addRain = useApp((s) => s.addRain);
  const removeEvent = useApp((s) => s.removeEvent);
  const removeRain = useApp((s) => s.removeRain);

  const [screen, setScreen] = useState<Screen>('home');
  const [lotId, setLotId] = useState('');
  const [destId, setDestId] = useState('');
  const [value, setValue] = useState('');
  const [when, setWhen] = useState<When>('hoje');
  const [otherDay, setOtherDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [undone, setUndone] = useState(false);
  const [locating, setLocating] = useState(false);
  const gps = useGeolocation(locating && screen === 'cattle');

  const shapes: MapShape[] = useMemo(() => (data ? data.paddocks.map((p) => ({ id: p.id, name: p.name, rings: p.geom.coordinates })) : []), [data?.paddocks]);
  const herePaddock = useMemo(() => {
    if (!data || gps.lat == null || gps.lon == null) return null;
    return data.paddocks.find((p) => pointInPolygon([gps.lon!, gps.lat!], p.geom.coordinates)) ?? null;
  }, [data, gps.lat, gps.lon]);

  if (!fv || !data) return null;

  const today = todayLocal();
  const date = when === 'hoje' ? today : when === 'ontem' ? addDays(today, -1) : otherDay;
  const dateOk = !!date && date <= today;
  const lots = fv.view.lots.filter((l) => l.heads > 0);
  const lot = fv.view.lotById.get(lotId) ?? null;
  const here = lot?.location.kind === 'no_piquete' ? lot.location.paddockId : null;
  const num = Number(value.replace(',', '.'));

  const home = () => {
    setScreen('home');
    setLotId('');
    setDestId('');
    setValue('');
    setWhen('hoje');
    setOtherDay('');
    setError(null);
    setLocating(false);
    setDone(null);
    setUndone(false);
  };
  const open = (s: Screen) => {
    home();
    setScreen(s);
  };

  /** Grava e descobre o que entrou de novo, para o "desfazer". */
  const save = async (write: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => Done) => {
    setBusy(true);
    setError(null);
    const r = await write();
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDone(after());
    setScreen('done');
  };
  const lotButton = (l: LotView) => {
    const at = l.location.kind === 'no_piquete' ? fv.paddockName(l.location.paddockId) : null;
    const on = l.lot.id === lotId;
    return (
      <button
        key={l.lot.id}
        type="button"
        aria-pressed={on}
        onClick={() => {
          setLotId(l.lot.id);
          setDestId('');
        }}
        className={`flex cursor-pointer flex-col gap-0.5 rounded-[18px] border-2 px-4 py-3.5 text-left text-text ${on ? 'border-lime bg-lime/10' : 'border-line2 bg-card'}`}
      >
        <span className="text-[19px] font-bold">
          <Emoji inline>🐂</Emoji> {l.lot.name}
        </span>
        <span className="k text-sm">
          {at ? (
            <>
              está no <b className="text-text">{at}</b>
            </>
          ) : (
            'sem pasto marcado'
          )}
          {` · ${nf(l.heads)} cabeças · ${nf(l.weightKg, 0)} kg`}
        </span>
      </button>
    );
  };

  const errorBox = error ? (
    <p className="err text-center text-base" role="alert">
      ⚠️ {error}
    </p>
  ) : null;

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-4">
      {screen === 'home' ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="big m-0 text-[30px]">Campo</h1>
            <p className="k m-0">Registre o que aconteceu. Vai direto para o histórico da fazenda.</p>
          </div>
          <button type="button" aria-label="Mudei o gado" onClick={() => open('cattle')} className="flex cursor-pointer flex-col items-center gap-1 rounded-[28px] border-4 border-lime bg-lime/10 py-7 active:scale-[0.98]">
            <Emoji size="text-6xl">🐮</Emoji>
            <span className="font-display text-[28px] font-extrabold text-lime">MUDEI O GADO</span>
          </button>
          <button type="button" aria-label="Choveu" onClick={() => open('rain')} className="flex cursor-pointer flex-col items-center gap-1 rounded-[28px] border-4 border-proj bg-proj/10 py-7 active:scale-[0.98]">
            <Emoji size="text-6xl">🌧️</Emoji>
            <span className="font-display text-[28px] font-extrabold text-proj">CHOVEU</span>
          </button>
          <button type="button" aria-label="Pesei o gado" onClick={() => open('weigh')} className="flex cursor-pointer flex-col items-center gap-1 rounded-[28px] border-4 border-warn bg-warn/10 py-7 active:scale-[0.98]">
            <Emoji size="text-6xl">⚖️</Emoji>
            <span className="font-display text-[28px] font-extrabold text-warn">PESEI O GADO</span>
          </button>
        </>
      ) : null}

      {/* ── troca de gado ── */}
      {screen === 'cattle' ? (
        <>
          <Back onClick={home} />
          <h2 className="m-0 text-center font-display text-[26px] font-bold">🐮 Mudança de gado</h2>
          {!lots.length ? (
            <p className="note text-center">Nenhum lote com animais.</p>
          ) : (
            <>
              <Step n={1}>Qual lote mudou?</Step>
              <div className="flex flex-col gap-2" role="group" aria-label="Qual lote mudou?">
                {lots.map(lotButton)}
              </div>
            </>
          )}
          {lot ? (
            <>
              <Step n={2}>Pra qual pasto foi?</Step>
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
                    id === destId ? { fill: '#C6F24E', text: '#0B120E' } : id === here ? { fill: '#18211C', text: '#9DB0A3', dashed: true } : { fill: '#2F6B4A', text: '#EEF3EC' }
                  }
                />
              </div>
              {!locating ? (
                <button type="button" className="min-h-[54px] cursor-pointer rounded-[16px] border-2 border-proj bg-proj/10 px-3 text-[17px] font-bold text-proj" onClick={() => setLocating(true)}>
                  📍 Estou nesse pasto agora
                </button>
              ) : gps.status === 'buscando' ? (
                <p className="note text-center" role="status">
                  📍 Procurando o GPS…
                </p>
              ) : gps.status === 'ok' ? (
                herePaddock && herePaddock.id !== here ? (
                  <button type="button" className="min-h-[54px] cursor-pointer rounded-[16px] border-2 border-lime bg-lime/10 px-3 text-[17px] font-bold text-lime" onClick={() => setDestId(herePaddock.id)}>
                    📍 Você está no {herePaddock.name}. Tocar para escolher
                  </button>
                ) : (
                  <p className="note text-center" role="status">
                    📍 {herePaddock ? `Você está no ${herePaddock.name}, onde o lote já estava.` : 'Você está fora dos pastos do mapa.'}
                  </p>
                )
              ) : (
                <p className="err" role="alert">
                  {geoProblem(gps.status)}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Pra qual pasto foi?">
                {data.paddocks
                  .filter((p) => p.id !== here && p.isGrazing)
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
                {lot.lot.name} ➜ {fv.paddockName(destId)}
              </p>
              {errorBox}
              <BigButton
                disabled={!dateOk || busy}
                onClick={() => {
                  const before = new Set(data.events.map((e) => e.id));
                  const name = lot.lot.name;
                  const to = fv.paddockName(destId);
                  const id = lot.lot.id;
                  void save(
                    () => moveLot(id, destId, date),
                    () => ({ title: 'Gravado!', text: `${name} foi para o ${to} em ${formatDayMonth(date)}.`, undo: pick(before, 'piquete_entrada', id) }),
                  );
                }}
              >
                {busy ? 'GRAVANDO…' : 'CONFIRMAR ✓'}
              </BigButton>
            </>
          ) : null}
        </>
      ) : null}

      {/* ── chuva ── */}
      {screen === 'rain' ? (
        <>
          <Back onClick={home} />
          <h2 className="m-0 text-center font-display text-[26px] font-bold">🌧️ Quanto choveu?</h2>
          <div className="rounded-[24px] border-2 border-proj bg-proj/10 py-4 text-center" role="status" aria-label="Milímetros de chuva">
            <span className="big text-[60px] text-proj">{value || '0'}</span>
            <span className="ml-2 text-xl text-proj">mm</span>
          </div>
          <NumPad value={value} onChange={setValue} />
          <WhenPicker when={when} onWhen={setWhen} otherDay={otherDay} onOtherDay={setOtherDay} today={today} />
          {(() => {
            const already = dateOk ? rainOn(data.rain, date) : null;
            const ok = num >= 0 && value !== '' && num <= 500 && dateOk && !busy;
            const go = (mode: 'somar' | 'substituir') => {
              const before = new Set(data.rain.map((r) => r.id));
              const mm = num;
              const d = date;
              void save(
                () => addRain({ date: d, mm }, mode),
                () => ({ title: 'Gravado!', text: `${nf(mm, 1)} mm em ${formatDayMonth(d)}.`, undo: pickRain(before) }),
              );
            };
            return (
              <>
                {already != null ? <p className="note text-center">Já tem {nf(already, 1)} mm nesse dia.</p> : null}
                {errorBox}
                {already != null ? (
                  <div className="grid grid-cols-2 gap-2">
                    <BigButton tone="blue" disabled={!ok} onClick={() => go('somar')}>
                      SOMAR
                    </BigButton>
                    <BigButton disabled={!ok} onClick={() => go('substituir')}>
                      TROCAR
                    </BigButton>
                  </div>
                ) : (
                  <BigButton tone="blue" disabled={!ok} onClick={() => go('somar')}>
                    {busy ? 'GRAVANDO…' : 'GRAVAR ✓'}
                  </BigButton>
                )}
              </>
            );
          })()}
        </>
      ) : null}

      {/* ── pesagem ── */}
      {screen === 'weigh' ? (
        <>
          <Back onClick={home} />
          <h2 className="m-0 text-center font-display text-[26px] font-bold">⚖️ Pesagem</h2>
          {!lots.length ? (
            <p className="note text-center">Nenhum lote com animais.</p>
          ) : (
            <>
              <Step n={1}>Qual lote pesou?</Step>
              <div className="flex flex-col gap-2" role="group" aria-label="Qual lote pesou?">
                {lots.map(lotButton)}
              </div>
            </>
          )}
          {lot ? (
            <>
              <Step n={2}>Peso médio por cabeça</Step>
              <div className="rounded-[24px] border-2 border-warn bg-warn/10 py-4 text-center" role="status" aria-label="Peso médio em kg">
                <span className="big text-[60px] text-warn">{value || '0'}</span>
                <span className="ml-2 text-xl text-warn">kg</span>
              </div>
              <p className="k m-0 text-center text-sm">Antes: {nf(lot.weightKg, 0)} kg{lot.lastWeigh ? ` (pesado em ${formatDayMonth(lot.lastWeigh)})` : ' (do cadastro)'}</p>
              <NumPad value={value} onChange={setValue} maxInt={4} />
              <Step n={3}>Quando pesou?</Step>
              <WhenPicker when={when} onWhen={setWhen} otherDay={otherDay} onOtherDay={setOtherDay} today={today} />
              {errorBox}
              <BigButton
                disabled={!(num > 0) || !dateOk || busy}
                onClick={() => {
                  const before = new Set(data.events.map((e) => e.id));
                  const id = lot.lot.id;
                  const name = lot.lot.name;
                  const kg = num;
                  const d = date;
                  void save(
                    () => addEvent(id, { type: 'pesagem', date: d, weightKg: kg }),
                    () => ({ title: 'Gravado!', text: `${name}: ${nf(kg, 1)} kg em ${formatDayMonth(d)}.`, undo: pick(before, 'pesagem', id) }),
                  );
                }}
              >
                {busy ? 'GRAVANDO…' : 'GRAVAR ✓'}
              </BigButton>
            </>
          ) : null}
        </>
      ) : null}

      {/* ── resultado ── */}
      {screen === 'done' && done ? (
        <>
          <Result emoji={undone ? '↩️' : '✅'} title={undone ? 'Desfeito' : done.title} text={undone ? 'O registro foi apagado.' : done.text} onAgain={home} />
          {errorBox}
          {done.undo && !undone ? (
            <button
              type="button"
              className="min-h-[54px] cursor-pointer rounded-[16px] border-2 border-line2 bg-card px-3 text-[17px] font-bold text-text disabled:opacity-40"
              disabled={busy}
              onClick={async () => {
                const u = done.undo!;
                setBusy(true);
                setError(null);
                const r = u.kind === 'event' ? await removeEvent(u.lotId, u.eventId) : await removeRain(u.rainId);
                setBusy(false);
                if (r.ok) setUndone(true);
                else setError(r.error);
              }}
            >
              ↩️ Errei, desfazer
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );

  // O registro novo aparece no estado depois da gravação; procura pelo que não existia antes.
  function pick(before: Set<string>, type: string, lot: string): Done['undo'] {
    const now = storeRef();
    const e = now?.events.filter((x) => !before.has(x.id) && x.type === type && x.lotId === lot).pop();
    return e ? { kind: 'event', lotId: lot, eventId: e.id } : null;
  }
  function pickRain(before: Set<string>): Done['undo'] {
    const r = storeRef()?.rain.filter((x) => !before.has(x.id)).pop();
    return r ? { kind: 'rain', rainId: r.id } : null;
  }
}
