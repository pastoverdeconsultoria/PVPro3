import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MoveSheet } from '../components/LotSheets';
import { differs, locationText } from '../lib/farm/farmView';
import type { ModuleView } from '../lib/farm/modules';
import { gmdText, nf } from '../lib/format';
import { formatDayMonth } from '../lib/lots/dates';
import { useApp, useFarmView } from '../state/AppContext';

export function Painel() {
  const fv = useFarmView();
  const [moving, setMoving] = useState<string | null>(null);
  const newReports = useApp((s) => s.data?.reports.reduce((n, r) => n + (r.status === 'novo' ? 1 : 0), 0) ?? 0);
  if (!fv) return null;

  const { view, modules } = fv;
  const t = view.totals;
  const withAnimals = view.lots.filter((l) => l.heads > 0);
  const problems = view.lots.filter((l) => l.problem);
  const outside = withAnimals.filter((l) => l.location.kind !== 'no_piquete');
  const noHistory = view.paddocks.filter((p) => p.paddock.isGrazing && !p.occupants.length && p.restDays == null).length;

  const tiles = [
    {
      label: 'Piquetes',
      value: String(t.occupied),
      unit: t.occupied === 1 ? 'ocupado' : 'ocupados',
      foot: `${t.resting} em descanso`,
      empty: false,
    },
    {
      label: 'Rebanho',
      value: withAnimals.length ? nf(t.heads) : '—',
      unit: 'cabeças',
      foot: `${withAnimals.length} ${withAnimals.length === 1 ? 'lote' : 'lotes'}`,
      empty: !withAnimals.length,
    },
    {
      label: 'GMD do rebanho',
      value: t.gmdKgDay == null ? '—' : gmdText(t.gmdKgDay),
      unit: 'kg/dia',
      foot: t.gmdKgDay == null ? 'falta pesagem' : 'última pesagem',
      empty: t.gmdKgDay == null,
    },
  ];

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-wrap gap-3 desk:gap-4">
        <section aria-label="Lotação global da fazenda" className="min-w-0 flex-[2_1_320px] rounded-card bg-lime p-6 text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Lotação global da fazenda</span>
          <p className="m-0 mt-3 flex items-baseline gap-3">
            <span className="big text-[52px] desk:text-[68px]">{t.globalUaHa == null ? '—' : nf(t.globalUaHa, 2)}</span>
            <span className="font-display text-[22px] font-bold">UA/ha</span>
          </p>
          <p className="m-0 mt-3 text-sm">
            {t.globalUaHa == null
              ? `UA em pastejo ÷ área útil (${nf(t.grazingAreaHa, 1)} ha). Aparece quando houver lote cadastrado.`
              : `${nf(t.uaInPasture, 0)} UA em pastejo · ${nf(t.grazingAreaHa, 1)} ha úteis${t.uaOutside > 0.5 ? ` · ${nf(t.uaOutside, 0)} UA fora dos piquetes` : ''}`}
          </p>
          {t.globalUaHa != null && t.globalUapHa != null && differs(t.globalUaHa, t.globalUapHa) ? (
            <p className="m-0 mt-1.5 text-sm">
              <b>{nf(t.globalUapHa, 2)} UA/ha de pasto</b>, descontado o que o suplemento substitui.
            </p>
          ) : null}
        </section>

        {tiles.map((x) => (
          <section key={x.label} aria-label={x.label} className="card flex flex-[1_1_100px] flex-col p-3.5 desk:p-5">
            {/* Em 360 px cada cartão tem ~76 px úteis: rótulo e rodapé reservam duas linhas
                para os três cartões alinharem, e a unidade desce para baixo do número. */}
            <span className="k min-h-[2.7em] text-xs desk:min-h-0 desk:text-[13px]">{x.label}</span>
            <p className="m-0 mt-auto flex flex-col gap-1 pt-3 desk:flex-row desk:items-baseline desk:gap-2 desk:pt-6">
              <span className={`big text-[26px] desk:text-[42px] ${x.empty ? 'text-unk' : ''}`}>{x.value}</span>
              <span className="k">{x.unit}</span>
            </p>
            <span className="k mt-3 min-h-[2.7em] text-xs desk:min-h-0 desk:text-[13px]">{x.foot}</span>
          </section>
        ))}
      </div>

      <Link
        to="/caderno"
        aria-label="Caderno da equipe"
        className={`card flex items-center justify-between gap-3 !py-3.5 text-text no-underline ${newReports ? 'border-warn' : ''}`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-[17px] font-semibold">Caderno da equipe</span>
          <span className={`text-[13px] ${newReports ? 'text-warn' : 'text-muted'}`}>
            {newReports ? `${newReports} ${newReports === 1 ? 'relato novo esperando' : 'relatos novos esperando'} você lançar` : 'Nenhum relato novo. Link do vaqueiro e revisão.'}
          </span>
        </span>
        <Icon name="arrow" />
      </Link>

      {problems.length || outside.length ? (
        <section className="card flex flex-col gap-2 border-warn/60" aria-label="Avisos">
          <h2 className="h2 text-warn">Avisos</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {problems.map((l) => (
              <li key={`p-${l.lot.id}`}>{l.problem}</li>
            ))}
            {outside.map((l) => (
              <li key={`o-${l.lot.id}`}>
                <b>{l.lot.name}</b> tem {nf(l.heads)} cabeças e não está em piquete: não entra na lotação.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!view.lots.length ? (
        <section className="card flex flex-col items-start gap-3">
          <h2 className="h2">Falta cadastrar o gado</h2>
          <p className="k m-0 max-w-[62ch]">
            O painel é calculado das movimentações de gado registradas. Cadastre os lotes e diga em que piquete cada um está: nenhum número aqui é estimado.
          </p>
          <Link to="/rebanho" className="btn btn-pri">
            <Icon name="plus" />
            Cadastrar lote
          </Link>
        </section>
      ) : (
        <section className="card flex flex-col gap-3" aria-label="Onde está cada lote">
          <h2 className="h2">Onde está cada lote</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {view.lots.map((l) => {
              const inPaddock = l.location.kind === 'no_piquete';
              const p = l.location.kind === 'no_piquete' ? view.paddockById.get(l.location.paddockId) : null;
              return (
                <li key={l.lot.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[14px] bg-bg px-3.5 py-2.5">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-display text-[16px] font-semibold">
                      {l.lot.name}
                      <span className="k font-sans font-normal"> · {nf(l.heads)} cab. · {nf(l.ua, 0)} UA</span>
                    </span>
                    <span className={`text-[13px] ${inPaddock ? 'text-muted' : l.heads > 0 ? 'text-warn' : 'text-muted'}`}>
                      {locationText(l, fv.paddockName, formatDayMonth)}
                      {p?.instantUaHa != null ? ` · ${nf(p.instantUaHa, 2)} UA/ha · dia ${p.dayOfUse}` : ''}
                    </span>
                  </span>
                  {l.heads > 0 ? (
                    <button type="button" className="btn px-3.5 text-[13px]" onClick={() => setMoving(l.lot.id)}>
                      Mover
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {modules.length ? (
        <div className="grid gap-3 desk:grid-cols-3 desk:gap-4">
          {modules.map((m) => (
            <ModuleCard key={m.module.id} m={m} />
          ))}
        </div>
      ) : (
        <section className="card flex flex-col items-start gap-3">
          <h2 className="h2">Nenhum módulo montado</h2>
          <p className="k m-0 max-w-[62ch]">Módulo é o grupo de piquetes por onde um lote roda. Monte os seus para acompanhar a ordem do rodízio.</p>
          <Link to="/modulos" className="btn">
            Montar módulos
          </Link>
        </section>
      )}

      {noHistory ? (
        <p className="k m-0 text-xs">
          {noHistory} {noHistory === 1 ? 'piquete de pastejo está' : 'piquetes de pastejo estão'} sem dado de saída. O descanso começa a contar na primeira saída registrada, ou informe a última saída ao editar o piquete no mapa.
        </p>
      ) : null}

      {moving ? <MoveSheet lotId={moving} onClose={() => setMoving(null)} /> : null}
    </div>
  );
}

function ModuleCard({ m }: { m: ModuleView }) {
  const cur = m.current;
  const day = cur?.dayOfUse ?? 0;
  const total = m.module.occupationDays;
  return (
    <section className="card flex flex-col gap-2.5" aria-label={m.module.name}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="h2 flex items-center gap-2">
          <i aria-hidden="true" className="h-3.5 w-3.5 rounded-[4px]" style={{ background: m.module.color }} />
          {m.module.name}
        </h2>
        <span className="k text-xs">
          {m.paddocks.length} piq. · {nf(m.areaHa, 0)} ha
        </span>
      </div>
      <p className="m-0 flex items-baseline gap-2">
        <span className="big text-[30px]">{m.uaHa == null ? '—' : nf(m.uaHa, 2)}</span>
        <span className="k">UA/ha no módulo</span>
      </p>
      {cur ? (
        <>
          <p className={`m-0 text-sm ${day > total ? 'text-warn' : 'text-lime'}`}>
            <b>
              {cur.occupants.map((o) => o.lot.name).join(' e ')} em {cur.paddock.name}
            </b>
            <span className="text-text"> · dia {day} de {total}</span>
          </p>
          <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: Math.min(total, 30) }, (_, i) => (
              <i key={i} className={`h-1.5 flex-1 rounded-full ${i < day ? (day > total ? 'bg-warn' : 'bg-lime') : 'bg-line2'}`} />
            ))}
          </div>
          <p className="k m-0 text-xs">
            {day > total ? `Passou ${day - total} ${day - total === 1 ? 'dia' : 'dias'} do planejado. ` : ''}
            {m.next && m.next !== cur ? `Próximo: ${m.next.paddock.name}${m.next.restDays != null ? `, com ${m.next.restDays} d de descanso` : ''}.` : ''}
          </p>
        </>
      ) : (
        <p className="k m-0 text-sm">Nenhum piquete ocupado agora.</p>
      )}
    </section>
  );
}
