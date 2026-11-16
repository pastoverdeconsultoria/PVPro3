import { nf } from '../format';
import type { LotEvent } from './types';

/** Categorias e o peso padrão de cada uma (kg), como no simulador. */
export const CATEGORIES: readonly (readonly [name: string, defaultKg: number])[] = [
  ['Bezerros', 180],
  ['Recria', 280],
  ['Novilhas', 330],
  ['Engorda', 440],
  ['Vacas', 450],
  ['Touros', 650],
];

export const ENTRY_REASONS = ['compra', 'nascimento', 'transferência', 'outro'] as const;
export const EXIT_REASONS = ['venda', 'morte', 'transferência', 'outro'] as const;

const heads = (n: number) => `${nf(n)} ${n === 1 ? 'cabeça' : 'cabeças'}`;
const kg = (n: number) => `${nf(n, Number.isInteger(n) ? 0 : 1)} kg`;
const why = (reason?: string) => (reason ? ` (${reason})` : '');

/** Um registro do histórico em uma frase, para a lista do lote. */
export function describeEvent(e: LotEvent, paddockName: (id: string) => string): string {
  switch (e.type) {
    case 'inicio':
      return `Formação do lote: ${heads(e.heads)}, ${kg(e.weightKg)}, ${e.category}`;
    case 'animais_entrada':
    case 'transf_in':
      return `Entrada de ${heads(e.heads)}${e.weightKg != null ? ` com ${kg(e.weightKg)}` : ''}${why(e.reason)}`;
    case 'animais_saida':
    case 'transf_out':
      return `Saída de ${heads(e.heads)}${why(e.reason)}`;
    case 'pesagem':
      return `Pesagem: ${kg(e.weightKg)}`;
    case 'categoria':
      return `Categoria passou a ${e.category}`;
    case 'suplemento':
      return e.pctPv > 0 ? `Suplemento: ${nf(e.pctPv, 2)}% do peso vivo por dia` : 'Suplemento suspenso';
    case 'piquete_entrada':
      return `Entrou em ${paddockName(e.paddockId)}`;
    case 'piquete_saida':
      return `Saiu de ${paddockName(e.paddockId)}`;
  }
}
