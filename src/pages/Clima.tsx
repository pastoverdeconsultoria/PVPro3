import { EmptyPage } from '../components/EmptyPage';

export function Clima() {
  return (
    <EmptyPage title="Clima" lead="Chuva estimada pelo centroide e chuva real registrada.">
      <h2 className="h2">Sem clima ainda</h2>
      <p className="k m-0 max-w-[62ch]">
        O histórico de chuva e temperatura é buscado pelo centroide da fazenda. A chuva registrada no pluviômetro ou
        pelo vaqueiro tem prioridade sobre a estimada do dia.
      </p>
    </EmptyPage>
  );
}
