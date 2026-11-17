import { useEffect, useState } from 'react';
import { Actions, ErrorText, Field, Sheet, useAction } from '../components/ui';
import { capacityOf, nitrogenPlan, PROJECTION, projectScope, type ProjScope } from '../lib/calc/projection';
import { HISTORY_YEARS } from '../lib/climate/openMeteo';
import { CAD_MM } from '../lib/climate/water';
import { monthLabel } from '../lib/farm/rain';
import { nf, parseNum } from '../lib/format';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { useApp, useClimateModel, useFarmView, type FarmScreenData } from '../state/AppContext';

const monthKey = (m: { year: number; month: number }) => `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
/** 'nov' no ano corrente, 'jan/27' nos outros. */
const shortMonth = (m: { year: number; month: number }, currentYear: number) =>
  `${monthLabel(monthKey(m)).slice(0, 3)}${m.year === currentYear ? '' : `/${String(m.year).slice(2)}`}`;

/**
 * Projeção de capacidade de suporte e conta inversa de N. Tela de escritório.
 * Tudo aqui é hipótese ainda não validada com fazenda real, e a tela diz isso.
 */
export function Projecao() {
  const fv = useFarmView();
  const cm = useClimateModel();
  const state = useApp((s) => s.climateState);
  const error = useApp((s) => s.climateError);
  const stale = useApp((s) => s.climateStale);
  const loadClimate = useApp((s) => s.loadClimate);
  const useCalibrated = useApp((s) => s.useCalibratedM);
  const setUseCalibrated = useApp((s) => s.setUseCalibratedM);
  const [scope, setScope] = useState('farm');
  const [target, setTarget] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadClimate();
  }, [loadClimate]);

  if (!fv) return null;
  if (!cm) {
    return (
      <section className="card flex flex-col items-start gap-3" role={state === 'error' ? 'alert' : 'status'}>
        <h2 className="h2">Projeção</h2>
        <p className="k m-0">{state === 'error' ? error : 'Buscando o clima do centroide da fazenda…'}</p>
        {state === 'error' ? (
          <button type="button" className="btn btn-pri" onClick={() => void loadClimate(true)}>
            Tentar de novo
          </button>
        ) : null}
      </section>
    );
  }

  const { model, scenarios } = cm;
  const sc = projectScope(model, scope) ?? projectScope(model, 'farm');
  if (!sc) {
    return (
      <section className="card flex flex-col gap-2">
        <h2 className="h2">Projeção</h2>
        <p className="k m-0">Não há piquete de pastejo para projetar.</p>
      </section>
    );
  }

  const now = sc.months.get(0)!;
  const year = now.year;
  const cap0 = sc.capacity[1].get(0) ?? 0;
  const over = cap0 > 0 ? sc.current / cap0 - 1 : 0;
  const future = Array.from({ length: 13 }, (_, k) => k);
  const worst = future.reduce((a, k) => ((sc.capacity[1].get(k) ?? 0) < (sc.capacity[1].get(a) ?? 0) ? k : a), 0);
  const worstCap = sc.capacity[1].get(worst) ?? 0;
  const excessUa = Math.max(0, (sc.current - worstCap) * sc.areaHa);
  const noScenario = scenarios.analog[1].every((y) => y == null);
  const anyCalibrated = model.units.some((u) => u.mCalibrated != null);

  const targetValue = target.trim() ? parseNum(target) : sc.current;
  const plan = targetValue > 0 ? nitrogenPlan(model, sc.units.length === model.units.length ? 'farm' : scope, targetValue) : [];
  const totalKg = plan.reduce((s, r) => s + r.kgN, 0);
  const totalHa = plan.reduce((s, r) => s + r.kgNHa, 0);

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Projeção</h1>
        <p className="k m-0">Lotação de pasto sustentável: P = M × PPR × FH + N × RN, convertida em UA/ha.</p>
      </div>

      <p className="note border-warn/50 text-text" role="note">
        <b className="text-warn">Hipótese, ainda não validada com fazenda real.</b> O M de cada módulo, a eficiência de pastejo de {PROJECTION.efficiency * 100}%, a água do solo de {CAD_MM} mm e o consumo de 2,5% do PV são pontos de partida. Use como referência para planejar, não como garantia.
      </p>
      {stale ? <p className="note">Sem sinal: o clima é a cópia guardada neste aparelho em {formatBr(cm.series.fetchedAt.slice(0, 10))}.</p> : null}
      {noScenario ? <p className="err">O histórico de clima veio curto demais para montar os cenários de chuva. Os meses à frente ficam sem projeção.</p> : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Projetar o quê">
        <button type="button" className={`chip min-h-[44px] cursor-pointer ${sc.name === 'Fazenda' ? 'chip-on' : 'bg-transparent'}`} aria-pressed={sc.name === 'Fazenda'} onClick={() => setScope('farm')}>
          Fazenda
        </button>
        {model.units.map((u) => (
          <button key={u.id} type="button" className={`chip min-h-[44px] cursor-pointer ${scope === u.id ? 'chip-on' : 'bg-transparent'}`} aria-pressed={scope === u.id} onClick={() => setScope(u.id)}>
            {u.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 desk:gap-4">
        <section aria-label="Capacidade sustentável do mês" className="min-w-0 flex-[2_1_300px] rounded-card bg-lime p-5 text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            Sustentável em {shortMonth(now, year)} · {sc.name}
          </span>
          <p className="m-0 mt-2.5 flex items-baseline gap-2.5">
            <span className="big text-[48px] desk:text-[60px]">{nf(cap0, 2)}</span>
            <span className="font-display text-[20px] font-bold">UA/ha</span>
          </p>
          <p className="m-0 mt-2.5 text-sm">
            lotação de pasto hoje: <b>{nf(sc.current, 2)} UA/ha</b>
          </p>
        </section>
        <section aria-label="Situação hoje" className="card flex flex-[1_1_130px] flex-col gap-1">
          <span className="k">Situação hoje</span>
          <span className={`big mt-auto pt-3 text-[28px] ${over > 0.05 ? 'text-warn' : ''}`}>
            {sc.current <= 0 ? '—' : `${nf(Math.abs(over) * 100, 0)}% ${over >= 0 ? 'acima' : 'abaixo'}`}
          </span>
          <span className="k text-xs">da capacidade do mês, cenário normal</span>
        </section>
        <section aria-label="Pior mês" className="card flex flex-[1_1_130px] flex-col gap-1">
          <span className="k">Pior mês</span>
          <span className="big mt-auto pt-3 text-[28px]">
            {shortMonth(sc.months.get(worst)!, year)} <span className="text-[18px]">{nf(worstCap, 2)}</span>
          </span>
          <span className="k text-xs">{excessUa > 0.5 ? `${nf(excessUa, 0)} UA a mais que o pasto sustenta` : 'a lotação de hoje cabe'}</span>
        </section>
      </div>

      {sc.current > 0 && excessUa > 0.5 ? (
        <p className="err" role="alert">
          <b>Mantida a lotação de hoje, o pasto não sustenta em {shortMonth(sc.months.get(worst)!, year)}.</b> Sobram {nf(excessUa, 0)} UA: vender, suplementar, diferir ou adubar.
        </p>
      ) : null}

      <section className="card flex flex-col gap-3" aria-label="Ocorrido e projetado">
        <h2 className="h2">Ocorrido e projetado</h2>
        <Chart sc={sc} year={year} />
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
          <li className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-lime" />Lotação de pasto ocorrida</li>
          <li className="flex items-center gap-1.5"><i aria-hidden="true" className="h-0.5 w-4 bg-proj" />Capacidade (normal)</li>
          <li className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-proj/30" />Seco a chuvoso</li>
          <li className="flex items-center gap-1.5"><i aria-hidden="true" className="h-0.5 w-4 border-t-2 border-dashed border-warn" />Lotação de hoje</li>
        </ul>
      </section>

      <section className="card flex flex-col gap-3" aria-label="Mês a mês">
        <h2 className="h2">Mês a mês</h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {future.map((k) => {
            const m = sc.months.get(k)!;
            const cap = sc.capacity[1].get(k) ?? 0;
            const balance = cap - sc.current;
            return (
              <li key={k} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="flex min-w-0 flex-col">
                  <span className="font-display text-[16px] font-semibold">{shortMonth(m, year)}</span>
                  <span className="k text-xs">
                    {nf(m.rain, 0)} mm · {Number.isNaN(m.T) ? '—' : `${nf(m.T, 1)}°`} · PPR {nf(sc.ppr.get(k) ?? 0, 2)} · FH {nf(m.FH, 2)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="flex items-baseline gap-2">
                    <span className="big text-[19px]">{nf(cap, 2)}</span>
                    {sc.current > 0 ? <span className={`text-[13px] font-semibold ${balance < 0 ? 'text-warn' : 'text-lime'}`}>{balance < 0 ? '−' : '+'}{nf(Math.abs(balance), 2)}</span> : null}
                  </span>
                  <span className="k text-xs">
                    seco {nf(sc.capacity[0].get(k) ?? 0, 2)} · chuvoso {nf(sc.capacity[2].get(k) ?? 0, 2)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="k m-0 text-xs">
          Capacidade em UA/ha de pasto, cenário normal. O número colorido é o saldo sobre a lotação de pasto de hoje. Chuva e temperatura: previsão nos próximos dias; depois, para cada mês, o ano seco (quantil 20%), o mediano e o chuvoso (80%) dos últimos {HISTORY_YEARS} anos no centroide.
        </p>
      </section>

      <section className="card flex flex-col gap-3" aria-label="Meta de lotação e dose de N">
        <h2 className="h2">Meta de lotação → dose de N</h2>
        <Field label={`Meta de lotação de pasto (UA/ha) · ${sc.name}`} hint="Em branco: a lotação de pasto de hoje.">
          {(id) => <input id={id} className="in max-w-[220px]" inputMode="decimal" placeholder={nf(sc.current, 2)} value={target} onChange={(e) => setTarget(e.target.value)} />}
        </Field>
        {!(targetValue > 0) ? (
          <p className="k m-0">Informe uma meta para calcular a dose.</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col p-0">
              {plan.map((r) => {
                const lack = Math.max(0, targetValue - r.capacity);
                return (
                  <li key={r.k} className="flex items-start justify-between gap-3 border-t border-line py-2 first:border-t-0">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-display text-[16px] font-semibold">{shortMonth(r.month, year)}</span>
                      <span className="k text-xs">
                        sustenta {nf(r.capacity, 2)}
                        {lack > 0.005 ? <span className="text-warn"> · falta {nf(lack, 2)}</span> : ' · cabe'}
                      </span>
                      {r.blocked && lack > 0.005 ? <span className="text-xs text-warn">déficit hídrico: N não responde · {nf(r.deficitUa, 0)} UA por outra via</span> : null}
                      {r.ceiling ? <span className="text-xs text-warn">meta acima do teto físico do pasto (M {PROJECTION.mCeiling})</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className={`big text-[19px] ${r.kgNHa > 0 ? '' : 'text-unk'}`}>{r.kgNHa > 0 ? nf(r.kgNHa, 0) : '—'}</span>
                      <span className="k text-xs">kg N/ha</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="m-0 grid grid-cols-3 gap-2 rounded-[14px] bg-bg p-3">
              <div>
                <dd className="big m-0 text-[20px] text-lime">{nf(totalKg / 1000, 1)} t</dd>
                <dt className="k text-xs">N em 12 meses</dt>
              </div>
              <div>
                <dd className="big m-0 text-[20px]">{nf(totalHa, 0)}</dd>
                <dt className="k text-xs">kg N/ha no ano</dt>
              </div>
              <div>
                <dd className="big m-0 text-[20px]">{nf(totalKg / 0.45 / 1000, 1)} t</dd>
                <dt className="k text-xs">em ureia (45% N)</dt>
              </div>
            </dl>
            <p className="k m-0 text-xs">
              Conta inversa: produção que a meta exige (meta × 11,25 kg MS ÷ {PROJECTION.efficiency * 100}% de eficiência) menos o que o pasto dá sem adubo, dividida pela resposta ao N ({PROJECTION.rn} kg MS/kg N × FH). Com ETR/ETM abaixo de 0,5 a dose não é calculada.
            </p>
          </>
        )}
      </section>

      <section className="card flex flex-col gap-3" aria-label="Parâmetros">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2">Parâmetros</h2>
          <div className="flex gap-2" role="group" aria-label="Qual M usar">
            <button type="button" className={`chip min-h-[44px] cursor-pointer ${useCalibrated ? 'chip-on' : 'bg-transparent'}`} aria-pressed={useCalibrated} disabled={!anyCalibrated} onClick={() => setUseCalibrated(true)}>
              M calibrado
            </button>
            <button type="button" className={`chip min-h-[44px] cursor-pointer ${!useCalibrated || !anyCalibrated ? 'chip-on' : 'bg-transparent'}`} aria-pressed={!useCalibrated || !anyCalibrated} onClick={() => setUseCalibrated(false)}>
              M de referência
            </button>
          </div>
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          {model.units.map((u) => (
            <li key={u.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0">
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 font-display text-[16px] font-semibold">
                  <i aria-hidden="true" className="h-3 w-3 rounded-[4px]" style={{ background: u.color }} />
                  {u.name}
                </span>
                <span className="k text-xs">
                  {nf(u.areaHa, 0)} ha · Tb {nf(u.tb, 1)}°
                </span>
              </span>
              <span className="text-sm">
                M em uso: <b>{nf(u.m, 0)}</b> kg MS/ha/dia ({u.calibrationUsed ? 'calibrado' : 'referência'}) · teto sem limitação: {nf(capacityOf(u.m), 2)} UA/ha
              </span>
              <span className="k text-xs">
                {u.mCalibrated != null
                  ? `M calibrado no histórico: ${nf(u.mCalibrated, 0)} (${u.observedMonths} meses, erro médio ${u.error == null ? '—' : `${nf(u.error * 100, 0)}%`}). M de referência: ${nf(u.mRef, 0)}.`
                  : `Sem calibração: precisa de 6 meses de lotação registrada, tem ${u.observedMonths}. Vale o M de referência do módulo.`}
              </span>
            </li>
          ))}
        </ul>
        <p className="k m-0 text-xs">
          O M calibrado é ajustado à lotação que foi praticada, então mede o manejo, não o limite do pasto: fazenda sublotada sai com M baixo. O M de referência vem da condição do módulo (extensiva 40, adubada 105) e é editado em Módulos. Tótima {PROJECTION.tOpt} °C · eficiência {PROJECTION.efficiency * 100}% · água do solo {CAD_MM} mm · resposta ao N {PROJECTION.rn} kg MS/kg · teto de M {PROJECTION.mCeiling}.
        </p>
      </section>

      <Fertilizations fv={fv} onAdd={() => setAdding(true)} />
      {adding ? <FertilizationSheet fv={fv} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/** Barras da lotação ocorrida (12 meses) e linha da capacidade (24 meses), com a faixa seco a chuvoso à frente. */
function Chart({ sc, year }: { sc: ProjScope; year: number }) {
  const ks = Array.from({ length: 24 }, (_, i) => i - 11);
  const W = 480;
  const H = 170;
  const top = 8;
  const bottom = 22;
  const slot = W / ks.length;
  const all = [sc.current, ...ks.flatMap((k) => [sc.observed.get(k) ?? 0, sc.capacity[2].get(k) ?? 0, sc.capacity[1].get(k) ?? 0])];
  const max = Math.max(...all, 0.1) * 1.08;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const x = (k: number) => (k + 11) * slot + slot / 2;
  const line = ks.map((k) => `${x(k).toFixed(1)},${y(sc.capacity[1].get(k) ?? 0).toFixed(1)}`).join(' ');
  const ahead = ks.filter((k) => k >= 0);
  const band = [...ahead.map((k) => `${x(k).toFixed(1)},${y(sc.capacity[2].get(k) ?? 0).toFixed(1)}`), ...[...ahead].reverse().map((k) => `${x(k).toFixed(1)},${y(sc.capacity[0].get(k) ?? 0).toFixed(1)}`)].join(' ');
  const summary = `Lotação de pasto ocorrida e capacidade projetada de ${sc.name}. Hoje ${nf(sc.current, 2)} UA/ha; capacidade do mês ${nf(sc.capacity[1].get(0) ?? 0, 2)}.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={summary}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={y((max / 1.08) * f)} y2={y((max / 1.08) * f)} stroke="#223028" strokeWidth={1} />
      ))}
      <polygon points={band} fill="#6FA8FF" opacity={0.25} />
      {ks.filter((k) => k <= 0).map((k) => {
        const v = sc.observed.get(k) ?? 0;
        return v > 0 ? <rect key={k} x={x(k) - slot * 0.32} width={slot * 0.64} y={y(v)} height={H - bottom - y(v)} rx={2} fill="#C6F24E" opacity={k === 0 ? 0.6 : 1} /> : null;
      })}
      <line x1={x(0) + slot / 2} x2={x(0) + slot / 2} y1={top} y2={H - bottom} stroke="#9DB0A3" strokeWidth={1} />
      {sc.current > 0 ? <line x1={x(0)} x2={W} y1={y(sc.current)} y2={y(sc.current)} stroke="#FF8A3D" strokeWidth={2} strokeDasharray="6 5" /> : null}
      <polyline points={line} fill="none" stroke="#6FA8FF" strokeWidth={2.5} strokeLinejoin="round" />
      {ks.map((k) =>
        (k + 11) % 2 === 1 ? (
          <text key={k} x={x(k)} y={H - 6} textAnchor="middle" fontSize={11} fill={k === 0 ? '#EEF3EC' : '#9DB0A3'} fontWeight={k === 0 ? 700 : 400}>
            {shortMonth(sc.months.get(k)!, year).slice(0, 3)}
          </text>
        ) : null,
      )}
      <text x={4} y={top + 10} fontSize={11} fill="#9DB0A3">
        {nf(max / 1.08, 1)} UA/ha
      </text>
    </svg>
  );
}

function Fertilizations({ fv, onAdd }: { fv: FarmScreenData; onAdd: () => void }) {
  const list = useApp((s) => s.data?.fertilizations);
  const ready = useApp((s) => s.data?.fertilizationReady !== false);
  const remove = useApp((s) => s.removeFertilization);
  const { busy, error, run } = useAction();
  const sorted = [...(list ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <section className="card flex flex-col gap-3" aria-label="Adubações nitrogenadas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">Adubações nitrogenadas</h2>
        {ready ? (
          <button type="button" className="btn btn-pri" onClick={onAdd}>
            Registrar adubação
          </button>
        ) : null}
      </div>
      {!ready ? (
        <p className="err" role="alert">
          Falta preparar o banco para a adubação. No Supabase, abra o SQL Editor, cole o arquivo <b>supabase/migrations/20261117120000_adubacao_membros.sql</b> e rode uma vez.
        </p>
      ) : sorted.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {sorted.map((f) => {
            const p = fv.view.paddockById.get(f.paddockId);
            return (
              <li key={f.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="flex min-w-0 flex-col">
                  <span className="k text-xs">{formatBr(f.date)}</span>
                  <span className="text-sm">
                    <b>{fv.paddockName(f.paddockId)}</b> · {nf(f.nKgHa, 0)} kg N/ha{p ? ` · ${nf(f.nKgHa * p.paddock.areaHa, 0)} kg N` : ''}
                  </span>
                </span>
                <button type="button" className="btn shrink-0 px-3 text-[13px]" disabled={busy} aria-label={`Apagar adubação de ${fv.paddockName(f.paddockId)} em ${formatBr(f.date)}`} onClick={() => void run(() => remove(f.id))}>
                  Apagar
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="k m-0">Nenhuma adubação registrada.</p>
      )}
      <ErrorText>{error}</ErrorText>
      <p className="k m-0 text-xs">A resposta ao N entra distribuída nos {PROJECTION.nDays} dias seguintes à aplicação e é reduzida pelo fator hídrico do mês.</p>
    </section>
  );
}

function FertilizationSheet({ fv, onClose }: { fv: FarmScreenData; onClose: () => void }) {
  const add = useApp((s) => s.addFertilization);
  const [paddockId, setPaddockId] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [dose, setDose] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Sheet title="Registrar adubação" onClose={onClose}>
      <Field label="Piquete">
        {(id) => (
          <select id={id} className="in" value={paddockId} onChange={(e) => setPaddockId(e.target.value)}>
            <option value="">Escolha…</option>
            {fv.view.paddocks
              .filter((p) => p.paddock.isGrazing)
              .map((p) => (
                <option key={p.paddock.id} value={p.paddock.id}>
                  {p.paddock.name} · {nf(p.paddock.areaHa, 1)} ha
                </option>
              ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">{(id) => <input id={id} className="in" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Dose (kg N/ha)" hint="De nitrogênio, não de ureia.">
          {(id) => <input id={id} className="in" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />}
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <Actions>
        <button type="button" className="btn btn-pri" disabled={busy} onClick={() => void run(() => add({ paddockId, date, nKgHa: parseNum(dose) }), onClose)}>
          {busy ? 'Gravando…' : 'Gravar adubação'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </Actions>
    </Sheet>
  );
}
