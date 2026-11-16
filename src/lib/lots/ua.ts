/** Peso de uma unidade animal, em kg (definição do Lucas: UA = cabeças × peso médio ÷ 450). */
export const UA_KG = 450;

export function ua(heads: number, weightKg: number): number {
  return (heads * weightKg) / UA_KG;
}
