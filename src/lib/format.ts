/** Número no padrão brasileiro: vírgula decimal e ponto de milhar. */
export function nf(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Lê número digitado com vírgula ou ponto decimal ("450", "450,5", "1.234,5"). NaN se não for número. */
export function parseNum(text: string): number {
  const t = text.trim();
  if (!t) return Number.NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

/** GMD com sinal e três casas; valor desprezível vira zero sem sinal. */
export function gmdText(kgDay: number): string {
  if (Math.abs(kgDay) < 0.0005) return '0,000';
  return `${kgDay > 0 ? '+' : '−'}${nf(Math.abs(kgDay), 3)}`;
}

/** Data e hora curtas de um instante ISO, no relógio do aparelho. */
export function dateTimeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}
