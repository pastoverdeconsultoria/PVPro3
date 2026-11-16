import { useState, type FormEvent } from 'react';
import { ErrorText, Field, useAction } from '../components/ui';
import { monthLabel, rainByDay, rainByMonth, rainOn } from '../lib/farm/rain';
import { nf, parseNum } from '../lib/format';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { useApp } from '../state/AppContext';
import type { RainMode } from '../state/store';

/**
 * Chuva real registrada (pluviômetro, pelo consultor ou pelo caderno da equipe).
 * A chuva e a temperatura estimadas pelo centroide entram numa etapa seguinte.
 */
export function Clima() {
  const rain = useApp((s) => s.data?.rain);
  const ready = useApp((s) => s.data?.notebookReady !== false);
  const centroid = useApp((s) => s.data?.farm.centroid);
  const addRain = useApp((s) => s.addRain);
  const removeRain = useApp((s) => s.removeRain);
  const [date, setDate] = useState(todayLocal());
  const [mm, setMm] = useState('');
  const add = useAction();
  const del = useAction();
  if (!rain) return null;

  const days = rainByDay(rain);
  const months = rainByMonth(rain);
  const thisMonth = months.find((m) => m.month === todayLocal().slice(0, 7));
  const already = rainOn(rain, date);

  const submit = (mode: RainMode) => (e?: FormEvent) => {
    e?.preventDefault();
    void add.run(() => addRain({ date, mm: parseNum(mm) }, mode), () => setMm(''));
  };

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Clima</h1>
        <p className="k m-0 max-w-[70ch]">Chuva real, lida no pluviômetro. Dia sem leitura não vira 0 mm: para dia sem chuva, registre 0.</p>
      </div>

      {ready ? null : (
        <section className="card flex flex-col gap-2 border-warn/60" role="alert">
          <h2 className="h2 text-warn">Falta preparar o banco para a chuva</h2>
          <p className="k m-0 max-w-[70ch]">
            No Supabase, abra o SQL Editor, cole o arquivo <b>supabase/migrations/20261116120000_caderno.sql</b> e rode uma vez. Depois atualize esta tela.
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-3 desk:gap-4">
        <section aria-label="Chuva registrada no mês" className="min-w-0 flex-[2_1_280px] rounded-card bg-lime p-5 text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Chuva registrada em {monthLabel(todayLocal().slice(0, 7))}</span>
          <p className="m-0 mt-2.5 flex items-baseline gap-2.5">
            <span className="big text-[48px] desk:text-[60px]">{thisMonth ? nf(thisMonth.mm, 1) : '—'}</span>
            <span className="font-display text-[20px] font-bold">mm</span>
          </p>
          <p className="m-0 mt-2.5 text-sm">
            {thisMonth ? `${thisMonth.days} ${thisMonth.days === 1 ? 'dia com leitura' : 'dias com leitura'} no mês.` : 'Nenhuma leitura neste mês.'}
          </p>
        </section>

        <form className="card flex flex-[1_1_260px] flex-col gap-3" aria-label="Registrar chuva" onSubmit={submit('somar')} noValidate>
          <h2 className="h2">Registrar chuva</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia">{(id) => <input id={id} className="in" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Milímetros">{(id) => <input id={id} className="in" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} />}</Field>
          </div>
          {already != null ? <p className="note">Já há {nf(already, 1)} mm registrados nesse dia.</p> : null}
          <ErrorText>{add.error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-pri" disabled={add.busy}>
              {already != null ? 'Somar ao dia' : 'Registrar'}
            </button>
            {already != null ? (
              <button type="button" className="btn" disabled={add.busy} onClick={() => submit('substituir')()}>
                Substituir o dia
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <section className="card flex flex-col gap-3" aria-label="Leituras por dia">
        <h2 className="h2">Leituras por dia</h2>
        <ErrorText>{del.error}</ErrorText>
        {days.length ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {days.slice(0, 60).map((d) => (
              <li key={d.date} className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{formatBr(d.date)}</span>
                  <span className="font-display text-[17px] font-bold">{nf(d.mm, 1)} mm</span>
                </div>
                {d.records.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3">
                    <span className="k min-w-0 truncate text-xs">
                      {d.records.length > 1 ? `${nf(r.mm, 1)} mm · ` : ''}
                      {r.note ?? 'registro do consultor'}
                    </span>
                    <button type="button" className="btn min-h-[36px] shrink-0 px-3 text-[12px]" disabled={del.busy} aria-label={`Apagar leitura de ${nf(r.mm, 1)} mm em ${formatBr(d.date)}`} onClick={() => void del.run(() => removeRain(r.id))}>
                      Apagar
                    </button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="k m-0">Nenhuma leitura registrada. A equipe pode anotar pelo caderno, e você lança de lá.</p>
        )}
      </section>

      {months.length > 1 ? (
        <section className="card flex flex-col gap-2" aria-label="Total por mês">
          <h2 className="h2">Total registrado por mês</h2>
          <ul className="m-0 flex list-none flex-col p-0 text-sm">
            {months.map((m) => (
              <li key={m.month} className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
                <span>
                  {monthLabel(m.month)} <span className="k text-xs">· {m.days} {m.days === 1 ? 'dia' : 'dias'} com leitura</span>
                </span>
                <b>{nf(m.mm, 1)} mm</b>
              </li>
            ))}
          </ul>
          <p className="k m-0 text-xs">Mês com poucos dias de leitura subestima a chuva real.</p>
        </section>
      ) : null}

      <p className="k m-0 text-xs">
        Ainda não construído: chuva e temperatura estimadas pelo centroide{centroid ? ` (${nf(centroid.lat, 4)}; ${nf(centroid.lon, 4)})` : ''}, comparação com a normal e previsão.
      </p>
    </div>
  );
}
