import { EmptyPage } from '../components/EmptyPage';

export default function Analise() {
  return (
    <EmptyPage title="Análise" lead="Histórico de lotação e projeção de capacidade de suporte.">
      <h2 className="h2">Sem histórico ainda</h2>
      <p className="k m-0 max-w-[62ch]">
        A lotação anual e a projeção dependem de meses de movimentação registrada. A projeção só calibra com seis
        meses ou mais de observação.
      </p>
    </EmptyPage>
  );
}
