import { useMemo, useState } from 'react';
import { FarmMap, type MapShape } from '../components/FarmMap';
import { MoveSheet } from '../components/LotSheets';
import { Actions, ErrorText, Field, Sheet, useAction } from '../components/ui';
import type { PaddockView } from '../lib/farm/farmView';
import { SPECIES } from '../lib/farm/newFarm';
import { MAP_LEGEND, paddockStatusText, paddockStyle } from '../lib/farm/paddockStyle';
import { nf } from '../lib/format';
import { formatBr, formatDayMonth, todayLocal } from '../lib/lots/dates';
import { useApp, useFarmView, type FarmScreenData } from '../state/AppContext';

export function Mapa() {
  const fv = useFarmView();
  const data = useApp((s) => s.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'editar' | 'mover' | null>(null);

  const shapes: MapShape[] = useMemo(
    () => (data ? data.paddocks.map((p) => ({ id: p.id, name: p.name, rings: p.geom.coordinates })) : []),
    [data?.paddocks],
  );
  if (!fv || !data) return null;

  const { view } = fv;
  const selected = selectedId ? view.paddockById.get(selectedId) ?? null : null;
  const hasLots = view.lots.some((l) => l.heads > 0);

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Mapa</h1>
        <p className="k m-0">
          {view.totals.occupied} {view.totals.occupied === 1 ? 'piquete ocupado' : 'piquetes ocupados'} · {view.totals.resting} em descanso · {nf(view.totals.grazingAreaHa, 1)} ha úteis
        </p>
      </div>

      <section className="card flex flex-col gap-3 !p-3 desk:!p-5" aria-label="Mapa dos piquetes">
        <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-xs text-muted" aria-label="Legenda">
          {MAP_LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <i aria-hidden="true" className="h-3 w-3 rounded-[4px]" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
          {data.waterPoints.length ? (
            <li className="flex items-center gap-1.5">
              <i aria-hidden="true" className="h-3 w-3 rounded-full bg-proj" />
              Bebedouro
            </li>
          ) : null}
        </ul>
        <FarmMap
          label="Piquetes da fazenda"
          shapes={shapes}
          points={data.waterPoints}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
          styleOf={(id) => {
            const p = view.paddockById.get(id);
            return p ? paddockStyle(p) : { fill: '#3A433E', text: '#EEF3EC' };
          }}
        />
        {!selected ? <p className="k m-0 text-xs">Toque num piquete para ver se está ocupado e as últimas informações.</p> : null}
      </section>

      {selected ? (
        <PaddockCard p={selected} fv={fv} canMove={hasLots} onEdit={() => setSheet('editar')} onMove={() => setSheet('mover')} />
      ) : null}

      <details className="card">
        <summary className="cursor-pointer font-display text-[17px] font-semibold">Lista de piquetes e áreas</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="k text-left text-xs">
                <th className="py-1.5 pr-3 font-medium">Piquete</th>
                <th className="py-1.5 pr-3 text-right font-medium">ha</th>
                <th className="py-1.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {view.paddocks.map((p) => (
                <tr key={p.paddock.id} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left text-text underline decoration-line2 underline-offset-4" onClick={() => setSelectedId(p.paddock.id)}>
                      {p.paddock.name}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right">{nf(p.paddock.areaHa, 2)}</td>
                  <td className="k py-2">{p.paddock.isGrazing || p.occupants.length ? paddockStatusText(p) : 'fora do pastejo'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line2 font-semibold">
                <td className="py-2 pr-3">Área útil</td>
                <td className="py-2 pr-3 text-right">{nf(view.totals.grazingAreaHa, 2)}</td>
                <td className="k py-2 font-normal">total do mapa: {nf(view.totals.totalAreaHa, 2)} ha</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>

      {sheet === 'editar' && selected ? <PaddockSheet p={selected} onClose={() => setSheet(null)} /> : null}
      {sheet === 'mover' && selected ? <MoveSheet paddockId={selected.paddock.id} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/**
 * Cartão do piquete tocado. Regra do Lucas: só diz se está ocupado e as últimas
 * informações. O acumulado do ano não entra aqui (fica na Análise).
 */
function PaddockCard({ p, fv, canMove, onEdit, onMove }: { p: PaddockView; fv: FarmScreenData; canMove: boolean; onEdit: () => void; onMove: () => void }) {
  const occupied = p.occupants.length > 0;
  const module = fv.moduleOf.get(p.paddock.id);
  const meta = [`${nf(p.paddock.areaHa, 2)} ha`, p.paddock.species ?? 'capim não informado', module?.name ?? (p.paddock.isGrazing ? 'sem módulo' : null)].filter(Boolean);

  return (
    <section className="card flex flex-col gap-3.5" aria-label={`Piquete ${p.paddock.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="h2">{p.paddock.name}</h2>
          <span className="k">{meta.join(' · ')}</span>
        </div>
        <span className={`chip ${occupied ? 'chip-on' : ''}`}>{occupied ? 'Ocupado' : p.paddock.isGrazing ? 'Vazio' : 'Fora do pastejo'}</span>
      </div>

      {occupied ? (
        <>
          <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="big text-[38px] text-lime">{nf(p.instantUaHa ?? 0, 2)}</span>
            <span className="font-display text-[17px] font-bold">UA/ha</span>
            <span className="k">lotação instantânea · dia {p.dayOfUse} de uso</span>
          </p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {p.occupants.map((o) => (
              <li key={o.lot.id}>
                <b>{o.lot.name}</b>: {nf(o.heads)} cabeças, {nf(o.ua, 0)} UA, desde {o.location.kind === 'no_piquete' ? formatBr(o.location.since) : ''}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-1.5 text-sm">
          {p.restDays != null && p.lastExit ? (
            <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="big text-[38px]">{p.restDays}</span>
              <span className="font-display text-[17px] font-bold">{p.restDays === 1 ? 'dia de descanso' : 'dias de descanso'}</span>
              <span className="k">
                última saída em {formatBr(p.lastExit.date)}
                {p.lastExit.source === 'abertura' ? ' (informada na abertura)' : ''}
              </span>
            </p>
          ) : (
            <p className="k m-0">Sem dado de saída: nenhuma movimentação registrada neste piquete.</p>
          )}
          {p.lastStay ? (
            <p className="k m-0">
              Último pastejo: {fv.lotName(p.lastStay.lotId)}, de {formatDayMonth(p.lastStay.start)} a {formatDayMonth(p.lastStay.end)} ({p.lastStay.days} {p.lastStay.days === 1 ? 'dia' : 'dias'}).
            </p>
          ) : null}
        </div>
      )}

      <Actions>
        {canMove ? (
          <button type="button" className="btn btn-pri" onClick={onMove}>
            Mover lote para cá
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onEdit}>
          Editar piquete
        </button>
      </Actions>
    </section>
  );
}

function PaddockSheet({ p, onClose }: { p: PaddockView; onClose: () => void }) {
  const updatePaddock = useApp((s) => s.updatePaddock);
  const [name, setName] = useState(p.paddock.name);
  const [species, setSpecies] = useState(p.paddock.species ?? '');
  const [grazing, setGrazing] = useState(p.paddock.isGrazing);
  const [lastExit, setLastExit] = useState(p.paddock.initialLastExit ?? '');
  const { busy, error, run } = useAction();
  const options = species && !(SPECIES as readonly string[]).includes(species) ? [species, ...SPECIES] : SPECIES;

  const save = () =>
    void run(
      () => updatePaddock(p.paddock.id, { name, species: species || null, isGrazing: grazing, initialLastExit: lastExit || null }),
      onClose,
    );

  return (
    <Sheet title={`Editar ${p.paddock.name}`} onClose={onClose}>
      <Field label="Nome">{(id) => <input id={id} className="in" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Capim">
        {(id) => (
          <select id={id} className="in" value={species} onChange={(e) => setSpecies(e.target.value)}>
            <option value="">Não informado</option>
            {options.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </Field>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-[#C6F24E]" checked={grazing} onChange={(e) => setGrazing(e.target.checked)} />
        Área de pastejo (entra na área útil)
      </label>
      <Field label="Última saída de gado antes do app (opcional)" hint="Só vale enquanto não houver saída registrada aqui. Serve para o descanso não começar sem dado.">
        {(id) => <input id={id} className="in" type="date" max={todayLocal()} value={lastExit} onChange={(e) => setLastExit(e.target.value)} />}
      </Field>
      <p className="k m-0 text-xs">A área ({nf(p.paddock.areaHa, 2)} ha) vem do mapa e não é editada aqui.</p>
      <ErrorText>{error}</ErrorText>
      <Actions>
        <button type="button" className="btn btn-pri" disabled={busy} onClick={save}>
          {busy ? 'Gravando…' : 'Gravar'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </Actions>
    </Sheet>
  );
}
