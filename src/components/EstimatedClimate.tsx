import { useEffect, useState } from 'react';
import { dayAt, HISTORY_YEARS } from '../lib/climate/openMeteo';
import { monthOffset } from '../lib/climate/water';
import { monthLabel, rainByMonth } from '../lib/farm/rain';
import { nf } from '../lib/format';
import { addDays, formatDayMonth, todayLocal } from '../lib/lots/dates';
import { useApp, useClimateModel } from '../state/AppContext';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/**
 * Clima estimado pelo centroide (Open-Meteo): previsão dos próximos dias e a
 * chuva estimada de cada mês ao lado da chuva real registrada e da normal.
 */
export function EstimatedClimate() {
  const cm = useClimateModel();
  const state = useApp((s) => s.climateState);
  const error = useApp((s) => s.climateError);
  const stale = useApp((s) => s.climateStale);
  const loadClimate = useApp((s) => s.loadClimate);
  const rain = useApp((s) => s.data?.rain);

  useEffect(() => {
    void loadClimate();
  }, [loadClimate]);

  if (!cm) {
    return (
      <section className="card flex flex-col items-start gap-3" aria-label="Clima estimado" role={state === 'error' ? 'alert' : 'status'}>
        <h2 className="h2">Clima estimado pelo centroide</h2>
        <p className="k m-0">{state === 'error' ? error : 'Buscando chuva e temperatura do centroide…'}</p>
        {state === 'error' ? (
          <button type="button" className="btn" onClick={() => void loadClimate(true)}>
            Tentar de novo
          </button>
        ) : null}
      </section>
    );
  }

  const { series, scenarios } = cm;
  const today = todayLocal();
  const forecast = Array.from({ length: 7 }, (_, i) => addDays(series.forecastFrom, i))
    .map((date) => ({ date, w: dayAt(series, date) }))
    .filter((d) => d.w);
  const forecastTotal = forecast.reduce((s, d) => s + d.w!.rain, 0);

  const real = new Map(rainByMonth(rain ?? []).map((m) => [m.month, m]));
  const months = Array.from({ length: 12 }, (_, i) => i - 11).map((k) => {
    const r = monthOffset(today, k);
    let estimated = 0;
    for (let d = r.a; d < r.b && d <= today; d = addDays(d, 1)) estimated += dayAt(series, d)?.rain ?? 0;
    const key = `${r.year}-${String(r.month + 1).padStart(2, '0')}`;
    return { key, estimated, real: real.get(key) ?? null, normal: scenarios.normalRain[r.month] };
  });
  const max = Math.max(...months.flatMap((m) => [m.estimated, m.real?.mm ?? 0, m.normal ?? 0]), 1);

  return (
    <>
      {stale ? <p className="note">Sem sinal: o clima estimado é a cópia guardada neste aparelho em {formatDayMonth(series.fetchedAt.slice(0, 10))}.</p> : null}

      <section className="card flex flex-col gap-3" aria-label="Previsão dos próximos dias">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="h2">Próximos {forecast.length} dias</h2>
          <span className="k text-xs">{nf(forecastTotal, 0)} mm previstos</span>
        </div>
        {forecast.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {forecast.map(({ date, w }) => (
              <li key={date} className="flex items-center justify-between gap-3 rounded-[12px] bg-bg px-3 py-2 text-sm">
                <span className="font-semibold">
                  {weekday(date)}, {formatDayMonth(date)}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className={w!.rain >= 0.1 ? 'font-semibold text-lime' : 'text-muted'}>{w!.rain >= 0.1 ? `${nf(w!.rain, 1)} mm` : 'sem chuva'}</span>
                  <span className="k text-xs">
                    {nf(w!.tmin, 0)}° / {nf(w!.tmax, 0)}°
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="k m-0">Sem previsão disponível.</p>
        )}
      </section>

      <section className="card flex flex-col gap-3" aria-label="Chuva por mês">
        <h2 className="h2">Chuva por mês, 12 meses</h2>
        <RainMonthsChart months={months} max={max} />
        <p className="k m-0 text-xs">
          Toque no mês para ver os números. Em mm. Estimada: ERA5 pelo centroide ({nf(series.lat, 2)}; {nf(series.lon, 2)}), pelo Open-Meteo. Registrada: o que foi lido no pluviômetro. Traço branco: a normal, média dos últimos {HISTORY_YEARS} anos. No cálculo, a chuva registrada entra no lugar da estimada, dia a dia; mês com poucos dias de leitura fica quase todo na estimada.
        </p>
      </section>
    </>
  );
}

type RainMonth = { key: string; estimated: number; real: { mm: number; days: number } | null; normal: number | null };

/**
 * Barras verticais, um mês por coluna: verde-escuro a estimada, verde-limão a
 * registrada, traço branco a normal. Tocar no mês mostra os números dele.
 */
function RainMonthsChart({ months, max }: { months: RainMonth[]; max: number }) {
  const [picked, setPicked] = useState(months.length - 1);
  const m = months[Math.min(picked, months.length - 1)];
  const h = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-ramp-3" />estimada</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-lime" />registrada</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 bg-text" />normal</span>
      </div>
      <ul className="m-0 flex h-[170px] list-none items-stretch gap-[3px] p-0">
        {months.map((x, i) => (
          <li key={x.key} className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-pressed={i === picked}
              onClick={() => setPicked(i)}
              className={`flex min-w-0 flex-1 cursor-pointer flex-col items-stretch gap-1 rounded-[8px] border-0 p-0 pb-0.5 text-text ${i === picked ? 'bg-line/60' : 'bg-transparent'}`}
            >
              <span className="sr-only">
                {monthLabel(x.key)}: estimada {nf(x.estimated, 0)} mm, registrada {x.real ? `${nf(x.real.mm, 0)} mm, ${x.real.days} ${x.real.days === 1 ? 'dia' : 'dias'} com leitura` : '—'}, normal {x.normal == null ? '—' : `${nf(x.normal, 0)} mm`}
              </span>
              <span className="relative flex flex-1 items-end justify-center gap-[2px] px-[1px]" aria-hidden="true">
                <i className="block w-1/2 max-w-[12px] rounded-t-[3px] bg-ramp-3" style={{ height: h(x.estimated) }} />
                <i className={`block w-1/2 max-w-[12px] rounded-t-[3px] ${x.real ? 'bg-lime' : ''}`} style={{ height: x.real ? h(x.real.mm) : 0 }} />
                {x.normal != null ? <i className="absolute inset-x-0 h-0.5 bg-text" style={{ bottom: h(x.normal) }} /> : null}
              </span>
              <span className={`text-center text-[10px] leading-3 ${i === picked ? 'font-semibold text-lime' : 'text-muted'}`} aria-hidden="true">
                {monthLabel(x.key).slice(0, 3)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-[12px] bg-bg px-3 py-2 text-sm" role="status">
        <b>{monthLabel(m.key)}</b>
        <span><span className="k text-xs">estimada </span>{nf(m.estimated, 0)} mm</span>
        <span className={m.real ? 'font-semibold text-lime' : 'text-unk'}><span className="k text-xs font-normal">registrada </span>{m.real ? `${nf(m.real.mm, 0)} mm` : '—'}</span>
        <span><span className="k text-xs">normal </span>{m.normal == null ? '—' : `${nf(m.normal, 0)} mm`}</span>
        {m.real ? <span className="k text-xs">{m.real.days} {m.real.days === 1 ? 'dia' : 'dias'} com leitura</span> : null}
      </p>
    </>
  );
}
