const TILES = [
  { label: 'Piquetes', unit: 'ocupados', foot: '— em descanso' },
  { label: 'Chuva no mês', unit: 'mm', foot: '— da normal' },
  { label: 'GMD do rebanho', unit: 'kg/dia', foot: 'última pesagem' },
];

export function Painel() {
  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-wrap gap-3 desk:gap-4">
        <section
          aria-label="Lotação global da fazenda"
          className="min-w-0 flex-[2_1_320px] rounded-card bg-lime p-6 text-ink"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Lotação global da fazenda</span>
          <p className="m-0 mt-3 flex items-baseline gap-3">
            <span className="big text-[52px] desk:text-[68px]">—</span>
            <span className="font-display text-[22px] font-bold">UA/ha</span>
          </p>
          <p className="m-0 mt-3 text-sm">UA totais ÷ área útil. Aparece quando houver fazenda aberta e lote no pasto.</p>
        </section>

        {TILES.map((t) => (
          <section key={t.label} aria-label={t.label} className="card flex flex-[1_1_100px] flex-col p-3.5 desk:p-5">
            {/* Em 360 px cada cartão tem ~76 px úteis: rótulo e rodapé reservam duas linhas
                para os três cartões alinharem, e a unidade desce para baixo do número. */}
            <span className="k min-h-[2.7em] text-xs desk:min-h-0 desk:text-[13px]">{t.label}</span>
            <p className="m-0 mt-auto flex flex-col gap-1 pt-3 desk:flex-row desk:items-baseline desk:gap-2 desk:pt-6">
              <span className="big text-[26px] text-unk desk:text-[42px]">—</span>
              <span className="k">{t.unit}</span>
            </p>
            <span className="k mt-3 min-h-[2.7em] text-xs desk:min-h-0 desk:text-[13px]">{t.foot}</span>
          </section>
        ))}
      </div>

      <section className="card flex flex-col gap-2.5">
        <h2 className="h2">Nenhuma fazenda aberta</h2>
        <p className="k m-0 max-w-[62ch]">
          O painel é calculado a partir das movimentações de gado registradas. Sem fazenda e sem lote não há o que
          mostrar, e nenhum número aqui é inventado. A abertura de fazenda por KML ainda não foi construída.
        </p>
      </section>
    </div>
  );
}
