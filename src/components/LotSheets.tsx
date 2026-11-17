import { useState } from 'react';
import type { LotView } from '../lib/farm/farmView';
import { paddockStatusText } from '../lib/farm/paddockStyle';
import { nf, parseNum } from '../lib/format';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { orderEvents } from '../lib/lots/deriveLot';
import { CATEGORIES, describeEvent, ENTRY_REASONS, EXIT_REASONS } from '../lib/lots/describe';
import type { LotEvent } from '../lib/lots/types';
import { useApp, useFarmView } from '../state/AppContext';
import { Actions, ErrorText, Field, Sheet, useAction } from './ui';

// Formulários de campo. Ficam no pacote principal, nunca em chunk sob demanda.

function DateField({ value, onChange, label = 'Data' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint="Pode ser data passada: tudo é recalculado.">
      {(id) => <input id={id} className="in" type="date" max={todayLocal()} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function Buttons({ busy, onClose, label = 'Gravar' }: { busy: boolean; onClose: () => void; label?: string }) {
  return (
    <Actions>
      <button type="submit" className="btn btn-pri" disabled={busy}>
        {busy ? 'Gravando…' : label}
      </button>
      <button type="button" className="btn" onClick={onClose}>
        Cancelar
      </button>
    </Actions>
  );
}

/** Mudança de piquete. Vem com o lote já escolhido (do Rebanho) ou com o destino já escolhido (do Mapa). */
export function MoveSheet({ lotId, paddockId, suggestedPaddockId, onClose }: { lotId?: string; paddockId?: string; /** Destino já escolhido, que ainda pode ser trocado. */ suggestedPaddockId?: string; onClose: () => void }) {
  const fv = useFarmView();
  const moveLot = useApp((s) => s.moveLot);
  const lots = fv?.view.lots.filter((l) => l.heads > 0) ?? [];
  const [lot, setLot] = useState(lotId ?? (lots.length === 1 ? lots[0].lot.id : ''));
  const [dest, setDest] = useState(paddockId ?? suggestedPaddockId ?? '');
  const [date, setDate] = useState(todayLocal());
  const { busy, error, setError, run } = useAction();
  if (!fv) return null;

  const current = fv.view.lotById.get(lot);
  const here = current?.location.kind === 'no_piquete' ? current.location.paddockId : null;
  const paddocks = fv.view.paddocks;
  const title = lotId && current ? `Mover ${current.lot.name}` : paddockId ? `Mover para ${fv.paddockName(paddockId)}` : 'Mover lote';

  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!lot) return setError('Escolha o lote.');
          if (!dest) return setError('Escolha o piquete de destino.');
          void run(() => moveLot(lot, dest, date), onClose);
        }}
      >
        {lotId ? null : (
          <Field label="Lote">
            {(id) => (
              <select id={id} className="in" value={lot} onChange={(e) => setLot(e.target.value)}>
                <option value="">Escolha…</option>
                {lots.map((l) => (
                  <option key={l.lot.id} value={l.lot.id}>
                    {l.lot.name} ({nf(l.heads)} cab.)
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {current ? (
          <p className="note">
            {here ? `Está em ${fv.paddockName(here)}. A saída de lá e a entrada no destino são gravadas juntas.` : 'Não está em piquete: será gravada só a entrada.'}
          </p>
        ) : null}
        {paddockId ? null : (
          <Field label="Piquete de destino">
            {(id) => (
              <select id={id} className="in" value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="">Escolha…</option>
                {paddocks
                  .filter((p) => p.paddock.id !== here)
                  .map((p) => (
                    <option key={p.paddock.id} value={p.paddock.id}>
                      {p.paddock.name} · {p.paddock.isGrazing || p.occupants.length ? paddockStatusText(p) : 'fora do pastejo'}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        )}
        <DateField label="Data da mudança" value={date} onChange={setDate} />
        <ErrorText>{error}</ErrorText>
        <Buttons busy={busy} onClose={onClose} label="Gravar mudança" />
      </form>
    </Sheet>
  );
}

export function NewLotSheet({ onClose }: { onClose: () => void }) {
  const createLot = useApp((s) => s.createLot);
  const count = useApp((s) => s.data?.lots.filter((l) => !l.deletedAt).length ?? 0);
  const [name, setName] = useState(`Lote ${count + 1}`);
  const [category, setCategory] = useState<string>(CATEGORIES[1][0]);
  const [heads, setHeads] = useState('');
  const [weight, setWeight] = useState(String(CATEGORIES[1][1]));
  const [weighed, setWeighed] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const { busy, error, run } = useAction();

  return (
    <Sheet title="Novo lote" onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => createLot({ name, category, heads: parseNum(heads), weightKg: parseNum(weight), weighed, date }), onClose);
        }}
      >
        <Field label="Nome">{(id) => <input id={id} className="in" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Categoria">
          {(id) => (
            <select
              id={id}
              className="in"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                // Enquanto o peso não foi pesado, acompanha o padrão da categoria.
                const std = CATEGORIES.find(([c]) => c === e.target.value)?.[1];
                if (std && !weighed) setWeight(String(std));
              }}
            >
              {CATEGORIES.map(([c]) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cabeças">{(id) => <input id={id} className="in" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value)} />}</Field>
          <Field label="Peso médio (kg)">{(id) => <input id={id} className="in" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#C6F24E]" checked={weighed} onChange={(e) => setWeighed(e.target.checked)} />
          Esse peso é de balança (conta como primeira pesagem)
        </label>
        <DateField label="Formado em" value={date} onChange={setDate} />
        <ErrorText>{error}</ErrorText>
        <Buttons busy={busy} onClose={onClose} label="Criar lote" />
      </form>
    </Sheet>
  );
}

export function WeighSheet({ lot, onClose }: { lot: LotView; onClose: () => void }) {
  const addEvent = useApp((s) => s.addEvent);
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(todayLocal());
  const { busy, error, run } = useAction();

  return (
    <Sheet title={`Pesar ${lot.lot.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => addEvent(lot.lot.id, { type: 'pesagem', date, weightKg: parseNum(weight) }), onClose);
        }}
      >
        <p className="note">
          Peso atual: {nf(lot.weightKg, 1)} kg{lot.lastWeigh ? `, pesado em ${formatBr(lot.lastWeigh)}` : ' (peso do cadastro, sem pesagem)'}.
        </p>
        <Field label="Peso médio do lote (kg)">{(id) => <input id={id} className="in" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
        <DateField label="Data da pesagem" value={date} onChange={setDate} />
        <ErrorText>{error}</ErrorText>
        <Buttons busy={busy} onClose={onClose} label="Gravar pesagem" />
      </form>
    </Sheet>
  );
}

type ChangeKind = 'entrada' | 'saida' | 'transferir' | 'categoria' | 'suplemento';
const CHANGE_LABEL: Record<ChangeKind, string> = { entrada: 'Entrada', saida: 'Saída', transferir: 'Transferir', categoria: 'Categoria', suplemento: 'Suplemento' };

/** Alteração do lote: animais que entram ou saem, troca de categoria e suplemento. */
export function ChangeSheet({ lot, onClose }: { lot: LotView; onClose: () => void }) {
  const addEvent = useApp((s) => s.addEvent);
  const transferAnimals = useApp((s) => s.transferAnimals);
  const fv = useFarmView();
  const others = fv?.view.lots.filter((l) => l.lot.id !== lot.lot.id) ?? [];
  const [toLot, setToLot] = useState('');
  const [kind, setKind] = useState<ChangeKind>('entrada');
  const [heads, setHeads] = useState('');
  const [weight, setWeight] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState(lot.category || CATEGORIES[0][0]);
  const [pct, setPct] = useState(lot.supplPct ? nf(lot.supplPct, 2) : '');
  const [date, setDate] = useState(todayLocal());
  const { busy, error, setError, run } = useAction();

  const pctNum = parseNum(pct);
  const submit = () => {
    switch (kind) {
      case 'entrada': {
        const w = weight.trim() ? parseNum(weight) : undefined;
        return run(() => addEvent(lot.lot.id, { type: 'animais_entrada', date, heads: parseNum(heads), ...(w === undefined ? {} : { weightKg: w }), ...(reason ? { reason } : {}) }), onClose);
      }
      case 'saida':
        return run(() => addEvent(lot.lot.id, { type: 'animais_saida', date, heads: parseNum(heads), ...(reason ? { reason } : {}) }), onClose);
      case 'transferir':
        return run(() => transferAnimals(lot.lot.id, toLot, parseNum(heads), date), onClose);
      case 'categoria':
        return run(() => addEvent(lot.lot.id, { type: 'categoria', date, category }), onClose);
      case 'suplemento':
        return run(() => addEvent(lot.lot.id, { type: 'suplemento', date, pctPv: pctNum }), onClose);
    }
  };

  return (
    <Sheet title={`Alterar ${lot.lot.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de alteração">
          {(Object.keys(CHANGE_LABEL) as ChangeKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip min-h-[44px] ${kind === k ? 'chip-on' : ''}`}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setReason('');
                setError(null);
              }}
            >
              {CHANGE_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="note">
          Hoje: {nf(lot.heads)} cabeças, {nf(lot.weightKg, 1)} kg, {lot.category}.
        </p>

        {kind === 'entrada' || kind === 'saida' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === 'entrada' ? 'Cabeças que entram' : 'Cabeças que saem'}>
                {(id) => <input id={id} className="in" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value)} />}
              </Field>
              {kind === 'entrada' ? (
                <Field label="Peso médio delas (kg)" hint="Em branco: entram com o peso médio do lote.">
                  {(id) => <input id={id} className="in" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}
                </Field>
              ) : null}
            </div>
            <Field label="Motivo">
              {(id) => (
                <select id={id} className="in" value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Não informado</option>
                  {(kind === 'entrada' ? ENTRY_REASONS : EXIT_REASONS).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              )}
            </Field>
          </>
        ) : null}

        {kind === 'transferir' ? (
          <>
            <Field label="Para o lote">
              {(id) => (
                <select id={id} className="in" value={toLot} onChange={(e) => setToLot(e.target.value)}>
                  <option value="">Escolha…</option>
                  {others.map((l) => (
                    <option key={l.lot.id} value={l.lot.id}>
                      {l.lot.name} ({nf(l.heads)} cab.)
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Cabeças transferidas" hint="Saem deste lote e entram no outro com o peso médio deste, no mesmo registro.">
              {(id) => <input id={id} className="in" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value)} />}
            </Field>
            {!others.length ? <p className="note">Não há outro lote para receber os animais.</p> : null}
          </>
        ) : null}

        {kind === 'categoria' ? (
          <Field label="Nova categoria">
            {(id) => (
              <select id={id} className="in" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([c]) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {kind === 'suplemento' ? (
          <Field
            label="Suplemento (% do peso vivo por dia)"
            hint={
              Number.isFinite(pctNum) && pctNum > 0
                ? `${nf((pctNum / 100) * lot.weightKg, 2)} kg por cabeça por dia, com o peso atual. Use 0 para suspender.`
                : 'Ex.: 0,3 para proteinado, 1 para semiconfinamento. Use 0 para suspender.'
            }
          >
            {(id) => <input id={id} className="in" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}
          </Field>
        ) : null}

        <DateField value={date} onChange={setDate} />
        <ErrorText>{error}</ErrorText>
        <Buttons busy={busy} onClose={onClose} />
      </form>
    </Sheet>
  );
}

/** Histórico do lote: cada registro pode ser apagado (suave) e a exclusão pode ser desfeita. */
export function HistorySheet({ lot, onClose }: { lot: LotView; onClose: () => void }) {
  const fv = useFarmView();
  const removeEvent = useApp((s) => s.removeEvent);
  const restoreEvent = useApp((s) => s.restoreEvent);
  const deleteLot = useApp((s) => s.deleteLot);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!fv) return null;

  const live = orderEvents(lot.events).reverse();
  const deleted = lot.events.filter((e) => e.deletedAt).sort((a, b) => (a.date < b.date ? 1 : -1));
  const text = (e: LotEvent) => describeEvent(e, fv.paddockName);

  return (
    <Sheet title={`Histórico de ${lot.lot.name}`} onClose={onClose}>
      {lot.problem ? <p className="err">{lot.problem}</p> : null}
      <ErrorText>{error}</ErrorText>

      <ul className="m-0 flex list-none flex-col p-0" aria-label="Registros">
        {live.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
            <span className="flex min-w-0 flex-col">
              <span className="k text-xs">{formatBr(e.date)}</span>
              <span className="text-sm">{text(e)}</span>
            </span>
            {e.type === 'inicio' ? null : confirm === e.id ? (
              <span className="flex shrink-0 gap-1.5">
                <button type="button" className="btn btn-danger min-h-[44px] px-3 text-[13px]" disabled={busy} onClick={() => void run(() => removeEvent(lot.lot.id, e.id), () => setConfirm(null))}>
                  Apagar
                </button>
                <button type="button" className="btn min-h-[44px] px-3 text-[13px]" onClick={() => setConfirm(null)}>
                  Não
                </button>
              </span>
            ) : (
              <button type="button" className="btn min-h-[44px] shrink-0 px-3 text-[13px]" aria-label={`Apagar registro: ${text(e)}`} onClick={() => setConfirm(e.id)}>
                Apagar
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="k m-0 text-xs">Apagar uma mudança de piquete leva a saída e a entrada juntas. Nada some de vez: dá para desfazer abaixo.</p>

      {deleted.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Apagados ({deleted.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col p-0" aria-label="Registros apagados">
            {deleted.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="flex min-w-0 flex-col text-muted">
                  <span className="text-xs">{formatBr(e.date)}</span>
                  <span className="text-sm line-through">{text(e)}</span>
                </span>
                <button type="button" className="btn min-h-[44px] shrink-0 px-3 text-[13px]" disabled={busy} aria-label={`Desfazer exclusão: ${text(e)}`} onClick={() => void run(() => restoreEvent(lot.lot.id, e.id))}>
                  Desfazer
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3.5">
        {confirm === 'lote' ? (
          <>
            <p className="m-0 text-sm">Excluir {lot.lot.name}? O lote sai das telas e o piquete fica livre. Dá para restaurar depois, em Rebanho.</p>
            <Actions>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => deleteLot(lot.lot.id), onClose)}>
                Excluir lote
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Não excluir
              </button>
            </Actions>
          </>
        ) : (
          <button type="button" className="btn btn-danger self-start" onClick={() => setConfirm('lote')}>
            Excluir lote…
          </button>
        )}
      </div>
    </Sheet>
  );
}
