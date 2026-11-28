import { useMemo, useState } from 'react';
import { nf } from '../lib/format';
import { formatBr, todayLocal } from '../lib/lots/dates';
import { herdTemplateCsv, parseHerdCsv, type HerdCsvResult } from '../lib/lots/herdCsv';
import { useApp } from '../state/AppContext';
import type { ImportLotsResult } from '../state/store';
import { Actions, ErrorText, Sheet } from './ui';

/**
 * Lê o arquivo como UTF-8 e, se não for, como Windows-1252: é assim que o Excel
 * em português salva o "CSV (separado por vírgulas)", e sem isso os acentos
 * viram lixo e o piquete "Várzea" não é encontrado.
 */
export async function readCsvFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Importa o rebanho de hoje por planilha: um lote por linha, com prévia antes de gravar. */
export function ImportHerdSheet({ onClose }: { onClose: () => void }) {
  const data = useApp((s) => s.data);
  const importLots = useApp((s) => s.importLots);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportLotsResult | null>(null);
  const today = todayLocal();

  const parsed: HerdCsvResult | null = useMemo(() => {
    if (text == null || !data) return null;
    return parseHerdCsv(text, {
      paddocks: data.paddocks,
      existingLotNames: data.lots.filter((l) => !l.deletedAt).map((l) => l.name),
      today,
    });
    // A conferência é feita uma vez por arquivo; depois de importar, os lotes novos
    // passariam a acusar "nome repetido" na própria prévia.
  }, [text]);

  if (!data) return null;
  const rows = parsed?.rows ?? [];
  const ready = rows.filter((r) => !r.errors.length);
  const withError = rows.length - ready.length;
  const heads = ready.reduce((s, r) => s + r.heads, 0);

  const pick = async (file: File | undefined) => {
    setDone(null);
    setReadError(null);
    if (!file) return;
    setFileName(file.name);
    if (/\.(xlsx?|ods)$/i.test(file.name)) {
      setText(null);
      setReadError('Esse arquivo é de planilha, não CSV. No Excel: Arquivo → Salvar como → "CSV (separado por vírgulas)".');
      return;
    }
    try {
      setText(await readCsvFile(file));
    } catch {
      setText(null);
      setReadError('Não deu para ler o arquivo.');
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setDone(await importLots(ready.map((r) => ({ line: r.line, name: r.name, heads: r.heads, weightKg: r.weightKg, category: r.category, paddockId: r.paddockId, date: r.date, weighed: r.weighed }))));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet title="Importar rebanho" onClose={onClose}>
        <p className="m-0 font-display text-[22px] font-bold text-lime">
          {done.imported} {done.imported === 1 ? 'lote importado' : 'lotes importados'}
        </p>
        {done.failed.length ? (
          <div className="flex flex-col gap-2">
            <p className="err m-0">
              {done.failed.length} {done.failed.length === 1 ? 'lote não entrou' : 'lotes não entraram'}:
            </p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
              {done.failed.map((f) => (
                <li key={f.line}>
                  Linha {f.line}, {f.name}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {withError ? <p className="k m-0 text-sm">As {withError} linhas com erro ficaram de fora. Corrija na planilha e importe de novo: os lotes que já entraram aparecem como "já existe" e são pulados.</p> : null}
        <Actions>
          <button type="button" className="btn btn-pri" onClick={onClose}>
            Fechar
          </button>
        </Actions>
      </Sheet>
    );
  }

  return (
    <Sheet title="Importar rebanho" onClose={onClose}>
      <p className="note m-0">
        Uma linha por lote, com o rebanho de hoje: nome, cabeças, peso médio, categoria, piquete onde está e a data. Cada linha vira um lote, igual ao cadastro à mão. Não é importação de histórico.
      </p>
      <button type="button" className="btn" onClick={() => downloadText('modelo-rebanho.csv', herdTemplateCsv(data.paddocks.filter((p) => p.isGrazing).map((p) => p.name), today))}>
        Baixar modelo
      </button>
      <p className="k m-0 text-xs">
        Preencha no Excel ou no Google Planilhas e salve como CSV. Peso vazio usa o padrão da categoria; data vazia usa hoje; piquete vazio deixa o lote fora de piquete. O nome do piquete tem de ser igual ao do app.
      </p>

      <label className="btn btn-pri cursor-pointer">
        {fileName ? 'Escolher outro arquivo' : 'Escolher arquivo CSV'}
        <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="Arquivo CSV" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {fileName ? <p className="k m-0 text-xs">Arquivo: {fileName}</p> : null}
      <ErrorText>{readError ?? parsed?.error ?? null}</ErrorText>

      {rows.length ? (
        <>
          <p className="m-0 text-sm" aria-live="polite">
            <strong className="text-lime">{ready.length} {ready.length === 1 ? 'lote pronto' : 'lotes prontos'}</strong>
            {ready.length ? ` (${nf(heads)} cabeças)` : ''}
            {withError ? <span className="text-warn"> · {withError} com erro, ficam de fora</span> : null}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Prévia da importação">
            {rows.map((r) => (
              <li key={r.line} className={`rounded-[14px] border p-3 ${r.errors.length ? 'border-warn' : 'border-line'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <strong className="min-w-0 truncate">{r.name || '(sem nome)'}</strong>
                  <span className="k shrink-0 text-xs">linha {r.line}</span>
                </div>
                {!r.errors.length ? (
                  <p className="k m-0 mt-1 text-sm">
                    {nf(r.heads)} cab. · {nf(r.weightKg, Number.isInteger(r.weightKg) ? 0 : 1)} kg · {r.category} · {r.paddockName ?? 'fora de piquete'} · {formatBr(r.date)}
                    {r.weighed ? ' · pesado' : ''}
                  </p>
                ) : null}
                {r.errors.map((e) => (
                  <p key={e} className="m-0 mt-1 text-sm text-warn">
                    {e}
                  </p>
                ))}
                {!r.errors.length
                  ? r.warnings.map((w) => (
                      <p key={w} className="k m-0 mt-1 text-xs">
                        {w}
                      </p>
                    ))
                  : null}
              </li>
            ))}
          </ul>
          <Actions>
            <button type="button" className="btn btn-pri" disabled={busy || !ready.length} onClick={() => void run()}>
              {busy ? 'Importando…' : `Importar ${ready.length} ${ready.length === 1 ? 'lote' : 'lotes'}`}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
          </Actions>
        </>
      ) : null}
    </Sheet>
  );
}
