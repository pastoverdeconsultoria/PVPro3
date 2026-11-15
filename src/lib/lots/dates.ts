/** Data pura, sem horário, no formato 'AAAA-MM-DD'. Compara certo como texto. */
export type IsoDate = string;

const DAY_MS = 86_400_000;

export function isIsoDate(s: string): s is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  // A conferência de ida e volta recusa datas como 2026-02-31.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Dias inteiros de `from` até `to` (positivo quando `to` é depois). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 'AAAA-MM-DD' para 'DD/MM/AAAA', usado nas mensagens de erro. */
export function formatBr(d: IsoDate): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}
