import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Actions, ErrorText, Field, Sheet, useAction } from '../components/ui';
import type { Module, ModuleCondition } from '../data/types';
import { paddockStatusText } from '../lib/farm/paddockStyle';
import { compositionVersions, CONDITION_LABEL, M_REF, MODULE_COLORS, type ModuleView } from '../lib/farm/modules';
import { nf, parseNum } from '../lib/format';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { useApp, useFarmView, type FarmScreenData } from '../state/AppContext';

export function Modulos() {
  const fv = useFarmView();
  const [editing, setEditing] = useState<ModuleView | 'novo' | null>(null);
  if (!fv) return null;

  const { view, modules, moduleOf } = fv;
  const loose = view.paddocks.filter((p) => p.paddock.isGrazing && !moduleOf.has(p.paddock.id));

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="big m-0 text-[30px] desk:text-[34px]">Módulos</h1>
          <p className="k m-0 max-w-[70ch]">Módulo é o grupo de piquetes por onde um lote roda, na ordem do rodízio.</p>
        </div>
        <button type="button" className="btn btn-pri" onClick={() => setEditing('novo')}>
          <Icon name="plus" />
          Novo módulo
        </button>
      </div>

      {!modules.length ? (
        <section className="card flex flex-col gap-2.5">
          <h2 className="h2">Nenhum módulo ainda</h2>
          <p className="k m-0 max-w-[62ch]">Crie um módulo, escolha os piquetes e ponha na ordem em que o gado roda. A ordem pode mudar depois: a composição antiga fica guardada com a data.</p>
        </section>
      ) : (
        <div className="grid gap-3 desk:grid-cols-2 desk:gap-4">
          {modules.map((m) => (
            <section key={m.module.id} className="card flex flex-col gap-3" aria-label={m.module.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="h2 flex items-center gap-2">
                    <i aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: m.module.color }} />
                    {m.module.name}
                  </h2>
                  <span className="k">
                    {m.paddocks.length} {m.paddocks.length === 1 ? 'piquete' : 'piquetes'} · {nf(m.areaHa, 1)} ha · {m.module.occupationDays} {m.module.occupationDays === 1 ? 'dia' : 'dias'} de ocupação
                  </span>
                  <span className="k">
                    {CONDITION_LABEL[m.module.condition]} · M de referência {nf(m.module.mRef, 0)}
                    {m.module.plannedLotId ? ` · lote planejado: ${fv.lotName(m.module.plannedLotId)}` : ''}
                  </span>
                </div>
                <button type="button" className="btn shrink-0 px-3.5 text-[13px]" onClick={() => setEditing(m)}>
                  Editar
                </button>
              </div>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {m.paddocks.map((p, i) => (
                  <li key={p.paddock.id} className={`flex items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-sm ${p.occupants.length ? 'bg-lime text-ink' : 'bg-bg'}`}>
                    <span className="min-w-0 truncate">
                      <span className={p.occupants.length ? '' : 'text-muted'}>{i + 1}. </span>
                      <b>{p.paddock.name}</b> · {nf(p.paddock.areaHa, 1)} ha
                    </span>
                    <span className={`shrink-0 text-[13px] ${p.occupants.length ? 'font-semibold' : 'text-muted'}`}>{paddockStatusText(p)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {loose.length ? (
        <section className="card flex flex-col gap-2" aria-label="Piquetes sem módulo">
          <h2 className="h2">Piquetes sem módulo ({loose.length})</h2>
          <p className="m-0 text-sm text-muted">{loose.map((p) => p.paddock.name).join(', ')}</p>
        </section>
      ) : null}

      {editing ? <ModuleSheet fv={fv} current={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ModuleSheet({ fv, current, onClose }: { fv: FarmScreenData; current: ModuleView | null; onClose: () => void }) {
  const farmId = useApp((s) => s.data?.farm.id ?? '');
  const compositions = useApp((s) => s.data?.compositions);
  const saveModule = useApp((s) => s.saveModule);
  const deleteModule = useApp((s) => s.deleteModule);
  const { view, modules, moduleOf } = fv;

  const [name, setName] = useState(current?.module.name ?? `Módulo ${String.fromCharCode(65 + (modules.length % 26))}`);
  const [color, setColor] = useState(current?.module.color ?? MODULE_COLORS[modules.length % MODULE_COLORS.length]);
  const [days, setDays] = useState(String(current?.module.occupationDays ?? 5));
  const [condition, setCondition] = useState<ModuleCondition>(current?.module.condition ?? 'extensiva');
  const [mRef, setMRef] = useState(String(current?.module.mRef ?? M_REF.extensiva));
  const [lot, setLot] = useState(current?.module.plannedLotId ?? '');
  const original = current?.paddocks.map((p) => p.paddock.id) ?? [];
  const [ids, setIds] = useState<string[]>(original);
  const [validFrom, setValidFrom] = useState(todayLocal());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAction();

  const changed = ids.length !== original.length || ids.some((id, i) => id !== original[i]);
  const available = view.paddocks.filter((p) => p.paddock.isGrazing && !ids.includes(p.paddock.id) && (!moduleOf.has(p.paddock.id) || moduleOf.get(p.paddock.id)!.id === current?.module.id));
  const area = ids.reduce((s, id) => s + (view.paddockById.get(id)?.paddock.areaHa ?? 0), 0);
  const versions = current && compositions ? compositionVersions(compositions, current.module.id) : [];

  const move = (i: number, dir: -1 | 1) =>
    setIds((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () => {
    const module: Module = {
      id: current?.module.id ?? crypto.randomUUID(),
      farmId,
      name,
      color,
      occupationDays: parseNum(days),
      plannedLotId: lot || null,
      condition,
      mRef: parseNum(mRef),
    };
    // A composição só é regravada quando mudou; senão o histórico ganharia versões iguais.
    void run(() => saveModule(module, changed || !current ? { validFrom, paddockIds: ids } : undefined), onClose);
  };

  return (
    <Sheet title={current ? `Editar ${current.module.name}` : 'Novo módulo'} onClose={onClose}>
      <Field label="Nome">{(id) => <input id={id} className="in" value={name} onChange={(e) => setName(e.target.value)} />}</Field>

      <div className="field">
        <span className="label">Cor</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Cor do módulo">
          {MODULE_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`h-[44px] w-[44px] cursor-pointer rounded-[12px] border-2 ${color === c ? 'border-text' : 'border-transparent'}`} style={{ background: c }} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Dias de ocupação" hint="Por piquete, no plano.">
          {(id) => <input id={id} className="in" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}
        </Field>
        <Field label="Lote planejado">
          {(id) => (
            <select id={id} className="in" value={lot} onChange={(e) => setLot(e.target.value)}>
              <option value="">Nenhum</option>
              {view.lots.map((l) => (
                <option key={l.lot.id} value={l.lot.id}>
                  {l.lot.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Condição">
          {(id) => (
            <select
              id={id}
              className="in"
              value={condition}
              onChange={(e) => {
                const c = e.target.value as ModuleCondition;
                setCondition(c);
                setMRef(String(M_REF[c]));
              }}
            >
              <option value="extensiva">Extensiva (M 40)</option>
              <option value="adubada">Adubada (M 105)</option>
            </select>
          )}
        </Field>
        <Field label="M de referência" hint="kg MS/ha/dia.">
          {(id) => <input id={id} className="in" inputMode="decimal" value={mRef} onChange={(e) => setMRef(e.target.value)} />}
        </Field>
      </div>

      <div className="field">
        <span className="label">
          Piquetes na ordem do rodízio ({ids.length}, {nf(area, 1)} ha)
        </span>
        {ids.length ? (
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {ids.map((id, i) => {
              const p = view.paddockById.get(id);
              return (
                <li key={id} className="flex items-center justify-between gap-2 rounded-[12px] bg-bg py-1 pl-3 pr-1 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{i + 1}. </span>
                    <b>{p?.paddock.name ?? 'piquete removido'}</b>
                    {p ? ` · ${nf(p.paddock.areaHa, 1)} ha` : ''}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className="btn h-[44px] w-[44px] !px-0" aria-label={`Subir ${p?.paddock.name}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" size={16} />
                    </button>
                    <button type="button" className="btn h-[44px] w-[44px] !px-0" aria-label={`Descer ${p?.paddock.name}`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" size={16} />
                    </button>
                    <button type="button" className="btn h-[44px] w-[44px] !px-0" aria-label={`Tirar ${p?.paddock.name}`} onClick={() => setIds((list) => list.filter((x) => x !== id))}>
                      <Icon name="close" size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="k m-0">Nenhum piquete escolhido.</p>
        )}
        {available.length ? (
          <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Piquetes disponíveis">
            {available.map((p) => (
              <button key={p.paddock.id} type="button" className="chip min-h-[44px] cursor-pointer bg-transparent" onClick={() => setIds((list) => [...list, p.paddock.id])}>
                <Icon name="plus" size={14} />
                {p.paddock.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="k m-0 text-xs">Todos os piquetes de pastejo já estão em algum módulo.</p>
        )}
      </div>

      {changed || !current ? (
        <Field label="A composição vale a partir de" hint="A composição anterior fica guardada como histórico.">
          {(id) => <input id={id} className="in" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />}
        </Field>
      ) : null}
      {versions.length > 1 ? <p className="k m-0 text-xs">Composições gravadas: {versions.map(formatBr).join(', ')}.</p> : null}

      <ErrorText>{error}</ErrorText>
      <Actions>
        <button type="button" className="btn btn-pri" disabled={busy} onClick={save}>
          {busy ? 'Gravando…' : 'Gravar módulo'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </Actions>

      {current ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3.5">
          {confirmDelete ? (
            <>
              <p className="m-0 text-sm">Excluir {current.module.name}? Os piquetes ficam sem módulo. O histórico de gado não muda.</p>
              <Actions>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => deleteModule(current.module.id), onClose)}>
                  Excluir módulo
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Não excluir
                </button>
              </Actions>
            </>
          ) : (
            <button type="button" className="btn btn-danger self-start" onClick={() => setConfirmDelete(true)}>
              Excluir módulo…
            </button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
