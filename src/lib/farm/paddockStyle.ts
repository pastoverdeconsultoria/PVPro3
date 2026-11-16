import type { ShapeStyle } from '../../components/FarmMap';
import { nf } from '../format';
import type { PaddockView } from './farmView';

// Paleta do simulador (CLAUDE.md, Design).
export const MAP_COLORS = {
  occupied: '#C6F24E',
  rest0: '#1E3A2B',
  rest7: '#2F6B4A',
  rest14: '#5DB383',
  unknown: '#3A433E',
  off: '#18211C',
} as const;

export const MAP_LEGEND: { color: string; label: string }[] = [
  { color: MAP_COLORS.occupied, label: 'Ocupado' },
  { color: MAP_COLORS.rest0, label: 'Descanso 0–6 d' },
  { color: MAP_COLORS.rest7, label: '7–13 d' },
  { color: MAP_COLORS.rest14, label: '14 d ou mais' },
  { color: MAP_COLORS.unknown, label: 'Sem dado' },
];

/** Uma palavra para a situação do piquete, usada em listas e rótulos. */
export function paddockStatusText(p: PaddockView): string {
  if (p.occupants.length) return `ocupado por ${p.occupants.map((o) => o.lot.name).join(' e ')}`;
  if (p.restDays == null) return 'sem dado de saída';
  return p.restDays === 0 ? 'saiu hoje' : `vazio há ${p.restDays} d`;
}

/** Cor e texto do piquete no mapa: ocupado em verde-limão, vazio pela idade do descanso. */
export function paddockStyle(p: PaddockView): ShapeStyle {
  if (p.occupants.length) {
    return {
      fill: MAP_COLORS.occupied,
      text: '#0B120E',
      lines: [nf(p.instantUaHa ?? 0, 2), `UA/ha · dia ${p.dayOfUse}`],
    };
  }
  if (!p.paddock.isGrazing) return { fill: MAP_COLORS.off, text: '#9DB0A3', dashed: true, lines: [] };
  if (p.restDays == null) return { fill: MAP_COLORS.unknown, text: '#EEF3EC', lines: ['—', 'sem dado'] };
  const fill = p.restDays >= 14 ? MAP_COLORS.rest14 : p.restDays >= 7 ? MAP_COLORS.rest7 : MAP_COLORS.rest0;
  return { fill, text: p.restDays >= 14 ? '#0B120E' : '#EEF3EC', lines: [`${p.restDays} d`, 'de descanso'] };
}
