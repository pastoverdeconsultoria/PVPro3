import { useEffect } from 'react';
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
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {months.map((m) => (
            <li key={m.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">{monthLabel(m.key)}</span>
                <span className="flex items-baseline gap-3">
                  <span>
                    <span className="k text-xs">estimada </span>
                    {nf(m.estimated, 0)}
                  </span>
                  <span className={m.real ? 'font-semibold text-lime' : 'text-unk'}>
                    <span className="k text-xs font-normal">registrada </span>
                    {m.real ? nf(m.real.mm, 0) : '—'}
                  </span>
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-line" aria-hidden="true">
                <i className="absolute inset-y-0 left-0 rounded-full bg-ramp-3" style={{ width: `${(m.estimated / max) * 100}%` }} />
                {m.real ? <i className="absolute inset-y-0 left-0 rounded-full bg-lime/90" style={{ width: `${(m.real.mm / max) * 100}%`, height: '50%' }} /> : null}
                {m.normal != null ? <i className="absolute -inset-y-0.5 w-0.5 bg-text" style={{ left: `${Math.min(100, (m.normal / max) * 100)}%` }} /> : null}
              </div>
              <span className="k text-xs">
                normal {m.normal == null ? '—' : `${nf(m.normal, 0)} mm`}
                {m.real ? ` · ${m.real.days} ${m.real.days === 1 ? 'dia' : 'dias'} com leitura` : ''}
              </span>
            </li>
          ))}
        </ul>
        <p className="k m-0 text-xs">
          Em mm. Estimada: ERA5 pelo centroide ({nf(series.lat, 2)}; {nf(series.lon, 2)}), pelo Open-Meteo. Registrada: o que foi lido no pluviômetro. Traço branco: a normal, média dos últimos {HISTORY_YEARS} anos. No cálculo, a chuva registrada entra no lugar da estimada, dia a dia; mês com poucos dias de leitura fica quase todo na estimada.
        </p>
      </section>
    </>
  );
}
