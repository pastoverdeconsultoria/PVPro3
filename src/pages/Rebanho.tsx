import { EmptyPage } from '../components/EmptyPage';

export function Rebanho() {
  return (
    <EmptyPage title="Rebanho" lead="Lotes, pesagens, GMD e suplemento.">
      <h2 className="h2">Nenhum lote cadastrado</h2>
      <p className="k m-0 max-w-[62ch]">
        Cada lote guarda um histórico de registros com data. Cabeças, peso, categoria e o piquete onde o lote está
        são sempre calculados a partir desse histórico.
      </p>
    </EmptyPage>
  );
}
