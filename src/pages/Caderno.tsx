import { useEffect, useState } from 'react';
import { Actions, ErrorText, Field, Sheet, useAction } from '../components/ui';
import type { FieldReport } from '../data/types';
import { rainOn } from '../lib/farm/rain';
import { dateTimeText, nf, parseNum } from '../lib/format';
import { planMove } from '../lib/lots/changes';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { useApp, useFarmView, type FarmScreenData } from '../state/AppContext';

/** Endereço do caderno de uma fazenda. O token é o segredo: quem tem o link consegue relatar. */
export function notebookUrl(token: string): string {
  return `${window.location.origin}/c/${token}`;
}

/** Caixa de revisão do caderno: o consultor confere cada relato da equipe e lança ou descarta. */
export function Caderno() {
  const fv = useFarmView();
  const data = useApp((s) => s.data);
  const refreshReports = useApp((s) => s.refreshReports);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);

  if (!fv || !data) return null;
  const fresh = data.reports.filter((r) => r.status === 'novo');
  const done = data.reports.filter((r) => r.status !== 'novo').reverse().slice(0, 40);
  const current = editing ? data.reports.find((r) => r.id === editing && r.status === 'novo') : null;

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Caderno da equipe</h1>
        <p className="k m-0 max-w-[70ch]">O vaqueiro anota chuva e mudança de gado pelo link, sem login. Nada entra no cálculo até você conferir e lançar.</p>
      </div>

      <ShareLink token={data.farm.shareToken ?? null} farmName={data.farm.name} />

      <section className="card flex flex-col gap-3" aria-label="Relatos novos">
        <div className="flex items-center justify-between gap-3">
          <h2 className="h2">Novos ({fresh.length})</h2>
          <button type="button" className="btn px-3.5 text-[13px]" onClick={() => void refreshReports()}>
            Conferir agora
          </button>
        </div>
        {fresh.length ? (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {fresh.map((r) => (
              <ReportCard key={r.id} r={r} fv={fv} onEdit={() => setEditing(r.id)} />
            ))}
          </ul>
        ) : (
          <p className="k m-0">Nenhum relato esperando revisão.</p>
        )}
      </section>

      {done.length ? (
        <details className="card">
          <summary className="cursor-pointer font-display text-[17px] font-semibold">Já revisados ({done.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col p-0">
            {done.map((r) => (
              <DoneRow key={r.id} r={r} fv={fv} />
            ))}
          </ul>
        </details>
      ) : null}

      {current ? <EditSheet r={current} fv={fv} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function reportTitle(r: FieldReport, fv: FarmScreenData): string {
  if (r.kind === 'chuva') return `Chuva: ${nf(r.mm ?? 0, 1)} mm`;
  return `${r.lotId ? fv.lotName(r.lotId) : 'lote'} foi para ${r.toPaddockId ? fv.paddockName(r.toPaddockId) : 'piquete'}`;
}

const who = (r: FieldReport) => `${r.reporter ? `por ${r.reporter}` : 'sem nome'}, recebido em ${dateTimeText(r.createdAt)}`;

function ReportCard({ r, fv, onEdit }: { r: FieldReport; fv: FarmScreenData; onEdit: () => void }) {
  const data = useApp((s) => s.data);
  const launchMove = useApp((s) => s.launchMoveReport);
  const launchRain = useApp((s) => s.launchRainReport);
  const discard = useApp((s) => s.discardReport);
  const { busy, error, run } = useAction();
  if (!data) return null;

  // Antes de lançar, mostra o que vai ser gravado, ou por que não dá para gravar.
  let preview: string | null = null;
  let blocked: string | null = null;
  const already = r.kind === 'chuva' ? rainOn(data.rain, r.date) : null;
  if (r.kind === 'mudanca') {
    const lot = fv.view.lotById.get(r.lotId ?? '');
    if (!lot || !r.toPaddockId) blocked = 'O lote deste relato não existe mais. Edite ou descarte.';
    else {
      const plan = planMove({ events: lot.events, lotId: lot.lot.id, lotName: lot.lot.name, toPaddockId: r.toPaddockId, date: r.date, today: todayLocal(), newId: () => 'previa' });
      if (!plan.ok) blocked = plan.error;
      else if (plan.value.length === 2 && plan.value[0].type === 'piquete_saida') {
        preview = `Grava a saída de ${fv.paddockName(plan.value[0].paddockId)} e a entrada em ${fv.paddockName(r.toPaddockId)}.`;
      } else preview = `${lot.lot.name} não está em piquete: grava só a entrada em ${fv.paddockName(r.toPaddockId)}.`;
    }
  } else if (already != null) {
    preview = `Já há ${nf(already, 1)} mm registrados nesse dia.`;
  }

  return (
    <li className="flex flex-col gap-2.5 rounded-[14px] border border-line2 bg-bg p-3.5">
      <div className="flex flex-col gap-0.5">
        <span className="k text-xs">
          {r.kind === 'chuva' ? 'Chuva' : 'Mudança de gado'} · {formatBr(r.date)}
        </span>
        <span className="font-display text-[18px] font-semibold">{reportTitle(r, fv)}</span>
        <span className="k text-xs">{who(r)}</span>
        {r.note ? <span className="text-sm">“{r.note}”</span> : null}
      </div>
      {blocked ? <p className="err">{blocked}</p> : preview ? <p className="note">{preview}</p> : null}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        {r.kind === 'mudanca' ? (
          <button type="button" className="btn btn-pri" disabled={busy || !!blocked} onClick={() => void run(() => launchMove(r.id))}>
            Lançar
          </button>
        ) : already != null ? (
          <>
            <button type="button" className="btn btn-pri" disabled={busy} onClick={() => void run(() => launchRain(r.id, 'somar'))}>
              Somar ({nf(already + (r.mm ?? 0), 1)} mm)
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => launchRain(r.id, 'substituir'))}>
              Substituir
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-pri" disabled={busy} onClick={() => void run(() => launchRain(r.id, 'somar'))}>
            Lançar
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={onEdit}>
          Editar
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => discard(r.id))}>
          Descartar
        </button>
      </div>
    </li>
  );
}

function DoneRow({ r, fv }: { r: FieldReport; fv: FarmScreenData }) {
  const reopen = useApp((s) => s.reopenReport);
  const { busy, error, run } = useAction();
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="k text-xs">
            {formatBr(r.date)} · {r.status === 'lancado' ? 'lançado' : 'descartado'}
          </span>
          <span className={`text-sm ${r.status === 'descartado' ? 'text-muted line-through' : ''}`}>{reportTitle(r, fv)}</span>
        </span>
        {r.status === 'descartado' ? (
          <button type="button" className="btn shrink-0 px-3 text-[13px]" disabled={busy} onClick={() => void run(() => reopen(r.id))}>
            Voltar para novos
          </button>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </li>
  );
}

function EditSheet({ r, fv, onClose }: { r: FieldReport; fv: FarmScreenData; onClose: () => void }) {
  const updateReport = useApp((s) => s.updateReport);
  const [date, setDate] = useState(r.date);
  const [mm, setMm] = useState(r.mm == null ? '' : nf(r.mm, 1));
  const [lotId, setLotId] = useState(r.lotId ?? '');
  const [paddockId, setPaddockId] = useState(r.toPaddockId ?? '');
  const { busy, error, run } = useAction();

  const save = () =>
    void run(
      () => updateReport(r.id, r.kind === 'chuva' ? { date, mm: parseNum(mm) } : { date, lotId, toPaddockId: paddockId }),
      onClose,
    );

  return (
    <Sheet title="Corrigir relato" onClose={onClose}>
      <p className="note">Relato {who(r)}. Corrija o que veio errado antes de lançar.</p>
      <Field label="Data do fato">{(id) => <input id={id} className="in" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      {r.kind === 'chuva' ? (
        <Field label="Milímetros">{(id) => <input id={id} className="in" inputMode="decimal" value={mm} onChange={(e) => setMm(e.target.value)} />}</Field>
      ) : (
        <>
          <Field label="Lote">
            {(id) => (
              <select id={id} className="in" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Escolha…</option>
                {fv.view.lots.map((l) => (
                  <option key={l.lot.id} value={l.lot.id}>
                    {l.lot.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Foi para o piquete">
            {(id) => (
              <select id={id} className="in" value={paddockId} onChange={(e) => setPaddockId(e.target.value)}>
                <option value="">Escolha…</option>
                {fv.view.paddocks.map((p) => (
                  <option key={p.paddock.id} value={p.paddock.id}>
                    {p.paddock.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Actions>
        <button type="button" className="btn btn-pri" disabled={busy} onClick={save}>
          {busy ? 'Gravando…' : 'Gravar correção'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </Actions>
    </Sheet>
  );
}

function ShareLink({ token, farmName }: { token: string | null; farmName: string }) {
  const rotate = useApp((s) => s.rotateShareToken);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { busy, error, setError, run } = useAction();

  if (!token) {
    return (
      <section className="card" aria-label="Link da equipe">
        <p className="k m-0">O link do caderno aparece depois de atualizar a fazenda com sinal.</p>
      </section>
    );
  }
  const url = notebookUrl(token);
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Não deu para copiar. Toque no endereço e copie à mão.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Caderno da ${farmName}`, text: 'Anote aqui chuva e mudança de gado:', url });
    } catch {
      /* compartilhamento cancelado */
    }
  };

  return (
    <section className="card flex flex-col gap-3" aria-label="Link da equipe">
      <h2 className="h2">Link da equipe</h2>
      <p className="k m-0 max-w-[70ch]">Mande este link ao vaqueiro. Ele abre sem senha, e depois da primeira vez funciona sem sinal. Quem tiver o link consegue anotar, então não publique em grupo aberto.</p>
      <input className="in text-[13px]" readOnly aria-label="Endereço do caderno" value={url} onFocus={(e) => e.target.select()} />
      <ErrorText>{error}</ErrorText>
      <Actions>
        {canShare ? (
          <button type="button" className="btn btn-pri" onClick={() => void share()}>
            Compartilhar
          </button>
        ) : null}
        <button type="button" className={`btn ${canShare ? '' : 'btn-pri'}`} onClick={() => void copy()}>
          {copied ? 'Copiado' : 'Copiar link'}
        </button>
        {confirm ? null : (
          <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
            Trocar link…
          </button>
        )}
      </Actions>
      {confirm ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="m-0 text-sm">Trocar o link? O link atual para de funcionar na hora, e relato ainda não enviado por ele é recusado. Você precisa mandar o novo para a equipe.</p>
          <Actions>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => rotate(), () => setConfirm(false))}>
              Trocar link
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Não trocar
            </button>
          </Actions>
        </div>
      ) : null}
    </section>
  );
}
