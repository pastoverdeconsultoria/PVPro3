/**
 * Regra do suplemento. Escolhida em 16 nov 2026 por delegação do Lucas ("faça como
 * preferir"), entre as duas que ele tinha citado:
 *   - com limiar (esta): só o suplemento acima de 0,3% do PV substitui capim.
 *     A 1% do PV corta 28% do capim.
 *   - sem limiar: cada kg de suplemento tira 1 kg de capim. A 1% do PV corta 40%.
 * Para trocar pela segunda, basta pôr `thresholdPct: 0`. Nada mais muda no app.
 */
export const SUPPLEMENT_RULE = {
  /** Consumo total do animal, em % do peso vivo por dia. Igual para todas as categorias, por enquanto. */
  intakePct: 2.5,
  /** Suplemento até aqui (% do PV) não substitui capim. */
  thresholdPct: 0.3,
} as const;

/** Fração do capim substituída por um suplemento de `pctPv` % do peso vivo por dia. */
export function cutFraction(pctPv: number): number {
  const { intakePct, thresholdPct } = SUPPLEMENT_RULE;
  return Math.max(0, Math.min(pctPv, intakePct) - thresholdPct) / intakePct;
}

/** Fração do consumo que continua vindo do pasto. UA de pasto = UA × esta fração. */
export function pastureFraction(pctPv: number): number {
  return 1 - cutFraction(pctPv);
}
