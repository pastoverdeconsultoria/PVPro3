import { EmptyPage } from '../components/EmptyPage';

export function Mapa() {
  return (
    <EmptyPage title="Mapa" lead="Piquetes coloridos por ocupação e dias de descanso.">
      <h2 className="h2">Sem mapa ainda</h2>
      <p className="k m-0 max-w-[62ch]">
        O mapa nasce do KML ou KMZ da fazenda. Ao tocar num piquete, o cartão mostra só se ele está ocupado e as
        últimas informações de lotação.
      </p>
    </EmptyPage>
  );
}
