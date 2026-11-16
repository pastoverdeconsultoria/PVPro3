import { useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FarmMap, type MapShape } from '../components/FarmMap';
import { ErrorText, Field, useAction } from '../components/ui';
import { buildNewFarm, draftsFromImport, draftTotals, SPECIES, type PaddockDraft } from '../lib/farm/newFarm';
import { nf } from '../lib/format';
import { grazingCentroid, KmlError, type KmlImport } from '../lib/kml/parseKml';
import { readKml } from '../lib/kml/readKml';
import { useApp } from '../state/AppContext';

/** Lê os bytes do arquivo escolhido. FileReader funciona em todo navegador de celular. */
function readBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

/** Abertura de fazenda pelo KML ou KMZ. Tela de escritório: é carregada sob demanda. */
export default function NovaFazenda() {
  const createFarm = useApp((s) => s.createFarm);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [imp, setImp] = useState<KmlImport | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [drafts, setDrafts] = useState<PaddockDraft[]>([]);
  const { busy, error, setError, run } = useAction();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReading(true);
    setFileError(null);
    setError(null);
    try {
      const result = await readKml(await readBytes(file));
      setImp(result);
      setDrafts(draftsFromImport(result));
      setFileName(file.name);
    } catch (err) {
      setImp(null);
      setDrafts([]);
      setFileName('');
      setFileError(err instanceof KmlError ? err.message : 'Não deu para ler o arquivo.');
    } finally {
      setReading(false);
    }
  };

  const patch = (i: number, p: Partial<PaddockDraft>) => setDrafts((list) => list.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const totals = draftTotals(drafts);
  const centroid = useMemo(() => grazingCentroid(drafts.map((d) => ({ outer: d.source.outer, grazing: d.grazing }))), [drafts]);
  const shapes: MapShape[] = useMemo(
    () => (imp ? imp.paddocks.map((p, i) => ({ id: String(i), name: p.name, rings: [p.outer, ...p.holes] })) : []),
    [imp],
  );
  const points = useMemo(() => (imp ? imp.waterPoints.map((w) => ({ lat: w.position[1], lon: w.position[0] })) : []), [imp]);

  const submit = () => {
    const built = buildNewFarm({ name, municipality, drafts, waterPoints: imp?.waterPoints ?? [] });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    void run(
      () => createFarm(built.value),
      () => navigate('/mapa'),
    );
  };

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Abrir fazenda</h1>
        <p className="k m-0">A fazenda nasce do mapa: cada polígono do arquivo vira um piquete.</p>
      </div>

      <section className="card flex flex-col gap-3.5" aria-label="Dados da fazenda">
        <h2 className="h2">1. Dados</h2>
        <div className="grid gap-3.5 desk:grid-cols-2">
          <Field label="Nome da fazenda">{(id) => <input id={id} className="in" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Município (opcional)">
            {(id) => <input id={id} className="in" value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="Cidade, UF" />}
          </Field>
        </div>
      </section>

      <section className="card flex flex-col gap-3.5" aria-label="Arquivo do mapa">
        <h2 className="h2">2. Mapa</h2>
        <Field label="Arquivo KML ou KMZ" hint="Exportado do Google Earth, com os piquetes desenhados como polígono.">
          {(id) => (
            <input
              id={id}
              className="in py-2.5 file:mr-3 file:rounded-full file:border-0 file:bg-lime file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
              type="file"
              accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
              onChange={(e) => void onFile(e)}
            />
          )}
        </Field>
        {reading ? (
          <p className="k m-0" role="status">
            Lendo o arquivo…
          </p>
        ) : null}
        <ErrorText>{fileError}</ErrorText>

        {imp ? (
          <>
            <p className="m-0 text-sm" role="status">
              <b>{fileName}</b>: {totals.count} {totals.count === 1 ? 'polígono' : 'polígonos'}, {nf(totals.totalHa, 2)} ha no total
              {imp.waterPoints.length ? `, ${imp.waterPoints.length} ${imp.waterPoints.length === 1 ? 'bebedouro' : 'bebedouros'}` : ''}.
            </p>
            {imp.ignored.lines ? (
              <p className="note">
                {imp.ignored.lines === 1 ? 'Um caminho foi ignorado' : `${imp.ignored.lines} caminhos foram ignorados`}. No Google Earth, piquete precisa ser desenhado como polígono, não como caminho.
              </p>
            ) : null}
            {imp.ignored.invalidPolygons ? (
              <p className="note">
                {imp.ignored.invalidPolygons === 1 ? 'Um polígono sem área foi ignorado' : `${imp.ignored.invalidPolygons} polígonos sem área foram ignorados`}.
              </p>
            ) : null}
            <div className="rounded-[14px] border border-line bg-bg p-2">
              <FarmMap
                label="Prévia do mapa"
                shapes={shapes}
                points={points}
                styleOf={(id) =>
                  drafts[Number(id)]?.grazing
                    ? { fill: '#2F6B4A', text: '#EEF3EC' }
                    : { fill: '#18211C', text: '#9DB0A3', dashed: true }
                }
              />
            </div>
          </>
        ) : null}
      </section>

      {imp ? (
        <section className="card flex flex-col gap-3.5" aria-label="Piquetes">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="h2">3. Piquetes</h2>
              <p className="k m-0 max-w-[62ch]">
                Confira as áreas com as que você conhece. Desmarque o que não é pasto (reserva, sede, represa). Dá para corrigir nome e capim depois.
              </p>
            </div>
            <Field label="Capim de todos">
              {(id) => (
                <select
                  id={id}
                  className="in"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setDrafts((list) => list.map((d) => ({ ...d, species: e.target.value })));
                  }}
                >
                  <option value="">Aplicar a todos…</option>
                  {SPECIES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {drafts.map((d, i) => (
              <li key={i} className={`flex flex-col gap-2.5 rounded-[14px] border bg-bg p-3 ${d.grazing ? 'border-line2' : 'border-line opacity-80'}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="k text-xs">{d.source.folder ?? 'Sem pasta'}</span>
                  <span className="font-display text-[17px] font-bold">{nf(d.source.areaHa, 2)} ha</span>
                </div>
                <div className="grid grid-cols-[1fr_1fr] gap-2.5">
                  <input className="in" aria-label={`Nome do piquete ${i + 1}`} value={d.name} onChange={(e) => patch(i, { name: e.target.value })} />
                  <select className="in" aria-label={`Capim de ${d.name}`} value={d.species ?? ''} onChange={(e) => patch(i, { species: e.target.value || null })}>
                    <option value="">Capim não informado</option>
                    {SPECIES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-[#C6F24E]" checked={d.grazing} onChange={(e) => patch(i, { grazing: e.target.checked })} />
                  Área de pastejo
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card flex flex-col gap-3.5" aria-label="Conferir e abrir">
        {imp ? (
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 desk:grid-cols-4">
            <div>
              <dt className="k text-xs">Área útil (pastejo)</dt>
              <dd className="big m-0 mt-1 text-[24px] text-lime">{nf(totals.grazingHa, 2)} ha</dd>
            </div>
            <div>
              <dt className="k text-xs">Área total do arquivo</dt>
              <dd className="big m-0 mt-1 text-[24px]">{nf(totals.totalHa, 2)} ha</dd>
            </div>
            <div>
              <dt className="k text-xs">Piquetes de pastejo</dt>
              <dd className="big m-0 mt-1 text-[24px]">
                {totals.grazingCount} de {totals.count}
              </dd>
            </div>
            <div>
              <dt className="k text-xs">Centroide (clima)</dt>
              <dd className="m-0 mt-1 text-sm">{centroid ? `${nf(centroid.lat, 4)}; ${nf(centroid.lon, 4)}` : '—'}</dd>
            </div>
          </dl>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" className="btn btn-pri" disabled={busy || reading} onClick={submit}>
            {busy ? 'Abrindo…' : 'Abrir fazenda'}
          </button>
          <Link to="/fazendas" className="btn">
            Cancelar
          </Link>
        </div>
      </section>
    </div>
  );
}
