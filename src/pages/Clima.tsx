import { EmptyPage } from '../components/EmptyPage';
import { nf } from '../lib/format';
import { useApp } from '../state/AppContext';

export function Clima() {
  const centroid = useApp((s) => s.data?.farm.centroid);
  return (
    <EmptyPage title="Clima" lead="Chuva e temperatura pelo centroide da fazenda, com o registro real do pluviômetro por cima.">
      <h2 className="h2">Ainda não construído</h2>
      <p className="k m-0 max-w-[62ch]">
        O clima entra numa próxima etapa: histórico de chuva e temperatura buscado pelo centroide, e o registro de chuva feito pela
        equipe no caderno. Nada é mostrado aqui até existir dado de verdade.
      </p>
      {centroid ? (
        <p className="m-0 text-sm">
          Centroide desta fazenda: {nf(centroid.lat, 4)}; {nf(centroid.lon, 4)}.
        </p>
      ) : null}
    </EmptyPage>
  );
}
