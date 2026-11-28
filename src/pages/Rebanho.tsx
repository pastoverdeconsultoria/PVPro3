import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { ImportHerdSheet } from '../components/ImportHerdSheet';
import { ChangeSheet, HistorySheet, MoveSheet, NewLotSheet, WeighSheet } from '../components/LotSheets';
import { ErrorText, useAction } from '../components/ui';
import { differs, locationText, type LotView } from '../lib/farm/farmView';
import { gmdText, nf } from '../lib/format';
import { formatBr, formatDayMonth } from '../lib/lots/dates';
import { useApp, useCanEdit, useFarmView } from '../state/AppContext';

type Open = { kind: 'novo' } | { kind: 'importar' } | { kind: 'mover' | 'pesar' | 'alterar' | 'historico'; lotId: string } | null;

export function Rebanho() {
  const fv = useFarmView();
  const canEdit = useCanEdit();
  // O seletor devolve a lista como está no estado; filtrar dentro dele criaria uma lista nova a cada leitura.
  const allLots = useApp((s) => s.data?.lots);
  const deletedLots = allLots?.filter((l) => l.deletedAt) ?? [];
  const restoreLot = useApp((s) => s.restoreLot);
  const [open, setOpen] = useState<Open>(null);
  const restore = useAction();
  if (!fv) return null;

  const { view } = fv;
  const t = view.totals;
  const current = open && open.kind !== 'novo' && open.kind !== 'importar' ? view.lotById.get(open.lotId) ?? null : null;
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="big m-0 text-[30px] desk:text-[34px]">Rebanho</h1>
          <p className="k m-0 max-w-[70ch]">UA = cabeças × peso médio ÷ 450. Vale a última pesagem; sem pesagem, o peso do cadastro.</p>
        </div>
        <Link to="/campo" className="btn">
          <Icon name="field" />
          Campo
        </Link>
        {canEdit ? (
          <button type="button" className="btn" onClick={() => setOpen({ kind: 'importar' })}>
            Importar
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className="btn btn-pri" onClick={() => setOpen({ kind: 'novo' })}>
            <Icon name="plus" />
            Novo lote
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3 desk:gap-4">
        <section aria-label="Rebanho no app" className="min-w-0 flex-[2_1_300px] rounded-card bg-lime p-5 text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Rebanho no app</span>
          <p className="m-0 mt-2.5 flex items-baseline gap-2.5">
            <span className="big text-[48px] desk:text-[60px]">{view.lots.length ? nf(t.uaTotal, 0) : '—'}</span>
            <span className="font-display text-[20px] font-bold">UA</span>
          </p>
          <p className="m-0 mt-2.5 text-sm">
            {view.lots.length
              ? `${nf(t.heads)} cabeças · ${view.lots.length} ${view.lots.length === 1 ? 'lote' : 'lotes'}${t.uaOutside > 0.5 ? ` · ${nf(t.uaOutside, 0)} UA fora de piquete de pastejo` : ''}`
              : 'Nenhum lote cadastrado.'}
          </p>
        </section>
        <section aria-label="GMD médio" className="card flex flex-[1_1_140px] flex-col gap-1">
          <span className="k">GMD médio</span>
          <p className="m-0 mt-auto flex items-baseline gap-2 pt-3">
            <span className={`big text-[34px] ${t.gmdKgDay == null ? 'text-unk' : ''}`}>{t.gmdKgDay == null ? '—' : gmdText(t.gmdKgDay)}</span>
            <span className="k">kg/dia</span>
          </p>
          <span className="k text-xs">{t.gmdKgDay == null ? 'precisa de duas pesagens em dias diferentes' : 'ponderado por cabeças'}</span>
        </section>
      </div>

      {!view.lots.length ? (
        <section className="card flex flex-col gap-2.5">
          <h2 className="h2">Cadastre o primeiro lote</h2>
          <p className="k m-0 max-w-[62ch]">
            O lote nasce com cabeças, peso médio e categoria. Depois é só registrar as mudanças de piquete: a lotação sai delas.
          </p>
          {canEdit ? <p className="k m-0 max-w-[62ch] text-sm">Com muitos lotes, use "Importar": uma linha por lote, já com o piquete onde está.</p> : null}
        </section>
      ) : (
        <div className="grid gap-3 desk:grid-cols-2 desk:gap-4 min-[1200px]:grid-cols-3">
          {view.lots.map((l) => (
            <LotCard key={l.lot.id} l={l} canEdit={canEdit} where={locationText(l, fv.paddockName, formatBr)} onOpen={(kind) => setOpen({ kind, lotId: l.lot.id })} />
          ))}
        </div>
      )}

      {deletedLots.length && canEdit ? (
        <details className="card">
          <summary className="cursor-pointer font-display text-[17px] font-semibold">Lotes excluídos ({deletedLots.length})</summary>
          <ErrorText>{restore.error}</ErrorText>
          <ul className="m-0 mt-2 flex list-none flex-col p-0">
            {deletedLots.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="text-sm text-muted">{l.name}</span>
                <button type="button" className="btn px-3 text-[13px]" disabled={restore.busy} onClick={() => void restore.run(() => restoreLot(l.id))}>
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {open?.kind === 'novo' ? <NewLotSheet onClose={close} /> : null}
      {open?.kind === 'importar' ? <ImportHerdSheet onClose={close} /> : null}
      {open?.kind === 'mover' && current ? <MoveSheet lotId={current.lot.id} onClose={close} /> : null}
      {open?.kind === 'pesar' && current ? <WeighSheet lot={current} onClose={close} /> : null}
      {open?.kind === 'alterar' && current ? <ChangeSheet lot={current} onClose={close} /> : null}
      {open?.kind === 'historico' && current ? <HistorySheet lot={current} onClose={close} /> : null}
    </div>
  );
}

function LotCard({ l, where, canEdit, onOpen }: { l: LotView; where: string; canEdit: boolean; onOpen: (kind: 'mover' | 'pesar' | 'alterar' | 'historico') => void }) {
  const inPaddock = l.location.kind === 'no_piquete';
  const empty = l.heads <= 0;
  const supplKg = l.supplPct > 0 ? (l.supplPct / 100) * l.weightKg : 0;

  return (
    <section className="card flex flex-col gap-3" aria-label={l.lot.name}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="h2">{l.lot.name}</h2>
          <span className="k">{l.category || 'sem categoria'}</span>
        </div>
        <span className={`chip shrink-0 ${inPaddock ? 'chip-on' : empty ? '' : 'border-warn text-warn'}`}>
          {inPaddock ? 'no pasto' : empty ? 'sem animais' : 'fora de piquete'}
        </span>
      </div>

      <p className={`m-0 text-sm ${inPaddock || empty ? '' : 'text-warn'}`}>{where}</p>
      {l.problem ? <p className="err">{l.problem}</p> : null}

      <dl className="m-0 grid grid-cols-4 gap-2">
        <div className="flex min-w-0 flex-col">
          <dd className="big m-0 text-[21px]">{nf(l.heads)}</dd>
          <dt className="k text-xs">cabeças</dt>
        </div>
        <div className="flex min-w-0 flex-col">
          <dd className="big m-0 text-[21px]">{nf(l.weightKg, 0)}</dd>
          <dt className="k text-xs">kg{l.lastWeigh ? ` · ${formatDayMonth(l.lastWeigh)}` : ' · cadastro'}</dt>
        </div>
        <div className="flex min-w-0 flex-col">
          <dd className="big m-0 text-[21px]">{nf(l.ua, 0)}</dd>
          <dt className="k text-xs">UA</dt>
        </div>
        <div className="flex min-w-0 flex-col">
          <dd className={`big m-0 text-[21px] ${l.gmd == null ? 'text-unk' : l.gmd.kgDay < 0 ? 'text-warn' : 'text-lime'}`}>{l.gmd == null ? '—' : gmdText(l.gmd.kgDay)}</dd>
          <dt className="k text-xs">GMD kg/dia</dt>
        </div>
      </dl>
      {supplKg > 0 ? (
        <p className="k m-0 text-xs">
          Suplemento: {nf(supplKg, 2)} kg por cabeça por dia{differs(l.ua, l.uap) ? ` · ${nf(l.uap, 0)} UA de pasto` : ''}.
        </p>
      ) : null}

      <div className={`mt-auto grid gap-2 pt-1 ${canEdit ? 'grid-cols-2 min-[400px]:grid-cols-4' : 'grid-cols-3'}`}>
        <button type="button" className="btn btn-pri px-2" disabled={empty} onClick={() => onOpen('mover')}>
          Mover
        </button>
        <button type="button" className="btn px-2" disabled={empty} onClick={() => onOpen('pesar')}>
          Pesar
        </button>
        {canEdit ? (
          <button type="button" className="btn px-2" onClick={() => onOpen('alterar')}>
            Alterar
          </button>
        ) : null}
        <button type="button" className="btn px-2" onClick={() => onOpen('historico')}>
          Histórico
        </button>
      </div>
    </section>
  );
}
