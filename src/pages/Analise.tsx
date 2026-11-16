import { useMemo, useState } from 'react';
import { analyzeFarm, type PaddockPeriodStats } from '../lib/calc/analysis';
import { differs } from '../lib/farm/farmView';
import { monthLabel } from '../lib/farm/rain';
import { nf } from '../lib/format';
import { formatBr } from '../lib/lots/dates';
import { useFarmView } from '../state/AppContext';

/**
 * Análise: a lotação no período (anual, quando houver um ano de registro), por
 * mês, por módulo e por piquete. É o único lugar onde o acumulado aparece; o
 * cartão do piquete no mapa mostra só a situação atual. Tela de escritório.
 */
export default function Analise() {
  const fv = useFarmView();
  const [scope, setScope] = useState<'modulo' | 'fazenda'>('modulo');
  const a = useMemo(() => (fv ? analyzeFarm(fv.view) : null), [fv]);
  if (!fv || !a) return null;

  if (a.empty) {
    return (
      <div className="flex flex-col gap-5">
        <Header lead="Lotação no período, por mês e por piquete." />
        <section className="card flex flex-col gap-2.5">
          <h2 className="h2">Sem histórico ainda</h2>
          <p className="k m-0 max-w-[62ch]">A análise nasce das movimentações de gado. Ela aparece depois da primeira entrada de um lote num piquete.</p>
        </section>
      </div>
    );
  }

  // Com suplemento em algum momento, a comparação entre piquetes é pela lotação de pasto.
  const pasture = differs(a.uaDays, a.uapDays);
  const value = (p: { uaHa: number; uapHa: number }) => (pasture ? p.uapHa : p.uaHa);
  const unit = pasture ? 'UA/ha de pasto' : 'UA/ha';
  const farmAvg = pasture ? a.uapHa ?? 0 : a.uaHa ?? 0;
  const monthMax = Math.max(...a.months.map((m) => (m.uaHa == null ? 0 : pasture ? m.uapHa ?? 0 : m.uaHa)), 0.0001);

  const statsOf = new Map(a.paddocks.map((p) => [p.paddockId, p]));
  const modules = fv.modules
    .map((m) => {
      const list = m.paddocks.map((p) => statsOf.get(p.paddock.id)).filter((p): p is PaddockPeriodStats => !!p);
      const area = list.reduce((s, p) => s + p.areaHa, 0);
      const uaDays = list.reduce((s, p) => s + p.uaDays, 0);
      const uapDays = list.reduce((s, p) => s + p.uapDays, 0);
      return { module: m.module, list, area, uaHa: area ? uaDays / area / a.days : 0, uapHa: area ? uapDays / area / a.days : 0 };
    })
    .filter((m) => m.list.length);
  const inModule = new Set(modules.flatMap((m) => m.list.map((p) => p.paddockId)));
  const loose = a.paddocks.filter((p) => !inModule.has(p.paddockId));
  const moduleMax = Math.max(...modules.map(value), 0.0001);

  const groups: { title: string; color?: string; avg: number; rows: PaddockPeriodStats[] }[] =
    scope === 'fazenda'
      ? [{ title: 'Fazenda toda', avg: farmAvg, rows: a.paddocks }]
      : [
          ...modules.map((m) => ({ title: m.module.name, color: m.module.color, avg: value(m), rows: m.list })),
          ...(loose.length ? [{ title: 'Sem módulo', avg: farmAvg, rows: loose }] : []),
        ];
  const rowMax = Math.max(...a.paddocks.map(value), 0.0001);

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <Header lead={`${formatBr(a.from)} a ${formatBr(a.to)} · ${a.days} ${a.days === 1 ? 'dia' : 'dias'} · lotação = UA-dia ÷ área ÷ dias do período`} />

      <section aria-label="Lotação global no período" className="rounded-card bg-lime p-6 text-ink">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{a.partial ? 'Lotação global no período' : 'Lotação global anual'}</span>
        <p className="m-0 mt-3 flex items-baseline gap-3">
          <span className="big text-[52px] desk:text-[68px]">{nf(a.uaHa ?? 0, 2)}</span>
          <span className="font-display text-[22px] font-bold">UA/ha</span>
        </p>
        <p className="m-0 mt-3 text-sm">
          {nf(a.uaDays, 0)} UA-dia em {nf(a.areaHa, 1)} ha úteis.
        </p>
        {pasture ? (
          <p className="m-0 mt-1.5 text-sm">
            <b>{nf(a.uapHa ?? 0, 2)} UA/ha de pasto</b>, descontado o que o suplemento substitui.
          </p>
        ) : null}
      </section>

      {a.partial ? (
        <p className="note">
          O registro tem {a.days} {a.days === 1 ? 'dia' : 'dias'}. A lotação anual só fecha com um ano de movimentações; até lá, o número acima é a lotação do período registrado, que começa na primeira entrada de gado.
        </p>
      ) : null}

      <section className="card flex flex-col gap-3" aria-label="Lotação global por mês">
        <h2 className="h2">Lotação global por mês</h2>
        <div className="flex h-[150px] items-end gap-1" role="img" aria-label={a.months.map((m) => `${monthLabel(m.month)}: ${m.uaHa == null ? 'sem registro' : nf(pasture ? m.uapHa ?? 0 : m.uaHa, 2)}`).join('; ')}>
          {a.months.map((m) => {
            const v = m.uaHa == null ? null : pasture ? m.uapHa ?? 0 : m.uaHa;
            return (
              <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className={`text-[10px] font-semibold leading-none ${v == null ? 'text-unk' : ''}`}>{v == null ? '—' : nf(v, 1)}</span>
                <i
                  className={`w-full rounded-[4px] ${v == null ? 'bg-line' : v >= farmAvg ? 'bg-lime' : 'bg-ramp-3'}`}
                  style={{ height: v == null ? 3 : `${Math.max(3, (v / monthMax) * 100)}%`, maxHeight: 'calc(100% - 16px)' }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {a.months.map((m) => (
            <span key={m.month} className="k min-w-0 flex-1 text-center text-[10px]">
              {monthLabel(m.month).slice(0, 3)}
            </span>
          ))}
        </div>
        <p className="k m-0 text-xs">
          Em {unit}. Verde-limão: mês igual ou acima da média do período ({nf(farmAvg, 2)}). Traço: mês sem registro. O mês corrente vai só até hoje.
        </p>
      </section>

      {modules.length ? (
        <section className="card flex flex-col gap-3" aria-label="Módulos no período">
          <h2 className="h2">Módulos</h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {[...modules].sort((x, y) => value(y) - value(x)).map((m) => (
              <li key={m.module.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-display text-[16px] font-semibold">
                    <i aria-hidden="true" className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: m.module.color }} />
                    <span className="truncate">{m.module.name}</span>
                  </span>
                  <span className="big text-[20px]">{nf(value(m), 2)}</span>
                </div>
                <Bar fraction={value(m) / moduleMax} tone="lime" />
                <span className="k text-xs">
                  {m.list.length} {m.list.length === 1 ? 'piquete' : 'piquetes'} · {nf(m.area, 1)} ha · composição de hoje
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card flex flex-col gap-3.5" aria-label="Ranking dos piquetes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2">Ranking dos piquetes</h2>
          <div className="flex gap-2" role="group" aria-label="Agrupar ranking">
            {(['modulo', 'fazenda'] as const).map((s) => (
              <button key={s} type="button" className={`chip min-h-[44px] cursor-pointer ${scope === s ? 'chip-on' : 'bg-transparent'}`} aria-pressed={scope === s} onClick={() => setScope(s)}>
                {s === 'modulo' ? 'Dentro do módulo' : 'Fazenda toda'}
              </button>
            ))}
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 flex items-center gap-2 font-display text-[16px] font-semibold">
                {g.color ? <i aria-hidden="true" className="h-3 w-3 rounded-[4px]" style={{ background: g.color }} /> : null}
                {g.title}
              </h3>
              <span className="k text-xs">média {nf(g.avg, 2)}</span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {[...g.rows].sort((x, y) => value(y) - value(x)).map((p, i) => {
                const v = value(p);
                const occurred = pasture ? p.occurredUapHa : p.occurredUaHa;
                return (
                  <li key={p.paddockId} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        <span className="text-muted">{i + 1}. </span>
                        <b>{fv.paddockName(p.paddockId)}</b>
                      </span>
                      <span className={`big text-[17px] ${v < g.avg * 0.8 && g.rows.length > 1 ? 'text-warn' : ''}`}>{nf(v, 2)}</span>
                    </div>
                    <Bar fraction={v / rowMax} tone={v >= g.avg ? 'lime' : v < g.avg * 0.8 && g.rows.length > 1 ? 'warn' : 'ramp'} mark={g.avg / rowMax} />
                    <span className="k text-xs">
                      {nf(p.areaHa, 1)} ha · {p.grazedDays} d de pastejo · {p.periods} {p.periods === 1 ? 'período' : 'períodos'}
                      {occurred != null ? ` · ocorrida média ${nf(occurred, 2)}` : ' · não pastejado'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}

        <p className="k m-0 text-xs">
          Valor: lotação no período, em {unit} (o descanso entra na conta). Traço branco: média do grupo. Laranja: mais de 20% abaixo da média. Dentro do módulo a comparação é entre piquetes do mesmo rodízio; na fazenda toda, capim e categoria se misturam.
          {pasture ? ' Como houve suplemento, o ranking usa a lotação de pasto.' : ''}
        </p>
      </section>

      <section className="card flex flex-col gap-2" aria-label="Projeção">
        <h2 className="h2">Projeção de capacidade de suporte</h2>
        <p className="k m-0 max-w-[62ch]">Ainda não construída. Ela depende da chuva e da temperatura pelo centroide da fazenda, que entram na próxima etapa.</p>
      </section>
    </div>
  );
}

function Header({ lead }: { lead: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="big m-0 text-[30px] desk:text-[34px]">Análise</h1>
      <p className="k m-0">{lead}</p>
    </div>
  );
}

function Bar({ fraction, tone, mark }: { fraction: number; tone: 'lime' | 'ramp' | 'warn'; mark?: number }) {
  const color = tone === 'lime' ? 'bg-lime' : tone === 'warn' ? 'bg-warn' : 'bg-ramp-3';
  return (
    <div className="relative h-2 rounded-full bg-line" aria-hidden="true">
      <i className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
      {mark != null ? <i className="absolute -inset-y-0.5 w-0.5 bg-text" style={{ left: `${Math.min(100, Math.max(0, mark * 100))}%` }} /> : null}
    </div>
  );
}
