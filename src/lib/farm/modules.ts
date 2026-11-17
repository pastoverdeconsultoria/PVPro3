import type { CompositionRow, Module, ModuleCondition } from '../../data/types';
import type { IsoDate } from '../lots/dates';
import type { FarmView, PaddockView } from './farmView';

/** Cores dos módulos, na ordem em que são sugeridas. */
export const MODULE_COLORS = ['#5B8DEF', '#D08A4B', '#9B7BE0', '#4FC3B0', '#E06C9F', '#E0C14F'] as const;

/** M de referência por condição (kg MS/ha/dia), da prática do Lucas. */
export const M_REF: Record<ModuleCondition, number> = { extensiva: 40, adubada: 105 };

export const CONDITION_LABEL: Record<ModuleCondition, string> = { extensiva: 'Extensiva', adubada: 'Adubada' };

/**
 * Piquetes do módulo, em ordem, num dia. Cada (módulo, data) gravada é uma
 * versão inteira da composição; vale a versão mais recente até aquele dia.
 */
export function compositionAt(rows: readonly CompositionRow[], moduleId: string, date: IsoDate): string[] {
  let version: IsoDate | null = null;
  for (const r of rows) {
    if (r.moduleId === moduleId && r.validFrom <= date && (!version || r.validFrom > version)) version = r.validFrom;
  }
  if (!version) return [];
  return rows
    .filter((r) => r.moduleId === moduleId && r.validFrom === version)
    .sort((a, b) => a.ord - b.ord)
    .map((r) => r.paddockId);
}

/** Datas das versões de composição de um módulo, da mais recente para a mais antiga. */
export function compositionVersions(rows: readonly CompositionRow[], moduleId: string): IsoDate[] {
  return [...new Set(rows.filter((r) => r.moduleId === moduleId).map((r) => r.validFrom))].sort().reverse();
}

/** De qual módulo é cada piquete num dia. */
export function paddockModules(modules: readonly Module[], rows: readonly CompositionRow[], date: IsoDate): Map<string, Module> {
  const out = new Map<string, Module>();
  for (const m of modules) {
    for (const id of compositionAt(rows, m.id, date)) if (!out.has(id)) out.set(id, m);
  }
  return out;
}

export interface ModuleView {
  module: Module;
  /** Piquetes na ordem do rodízio (os que ainda existem na fazenda). */
  paddocks: PaddockView[];
  areaHa: number;
  /** UA presentes nos piquetes do módulo. */
  ua: number;
  /** Lotação do módulo agora: UA presentes ÷ área do módulo. Null sem área. */
  uaHa: number | null;
  /** Piquete ocupado agora (o primeiro na ordem, se houver mais de um). */
  current: PaddockView | null;
  /** Próximo piquete na ordem do rodízio, depois do ocupado. */
  next: PaddockView | null;
}

export function moduleViews(
  modules: readonly Module[],
  rows: readonly CompositionRow[],
  view: FarmView,
): ModuleView[] {
  return modules.map((module) => {
    const paddocks = compositionAt(rows, module.id, view.today)
      .map((id) => view.paddockById.get(id))
      .filter((p): p is PaddockView => !!p);
    const areaHa = paddocks.reduce((s, p) => s + p.paddock.areaHa, 0);
    const sumUa = paddocks.reduce((s, p) => s + p.ua, 0);
    const idx = paddocks.findIndex((p) => p.occupants.length > 0);
    return {
      module,
      paddocks,
      areaHa,
      ua: sumUa,
      uaHa: areaHa > 0 ? sumUa / areaHa : null,
      current: idx >= 0 ? paddocks[idx] : null,
      next: idx >= 0 && paddocks.length > 1 ? paddocks[(idx + 1) % paddocks.length] : null,
    };
  });
}

/**
 * Confere a composição antes de gravar. Um piquete só pode estar em um módulo
 * por vez. Devolve a mensagem de erro, ou null se pode gravar.
 */
export function checkComposition(
  module: Pick<Module, 'id'>,
  paddockIds: readonly string[],
  validFrom: IsoDate,
  modules: readonly Module[],
  rows: readonly CompositionRow[],
  paddockName: (id: string) => string,
): string | null {
  if (!paddockIds.length) return 'O módulo precisa de pelo menos um piquete. Para desfazer o módulo, exclua-o.';
  if (new Set(paddockIds).size !== paddockIds.length) return 'O mesmo piquete aparece duas vezes.';
  for (const other of modules) {
    if (other.id === module.id) continue;
    const taken = compositionAt(rows, other.id, validFrom);
    const clash = paddockIds.find((id) => taken.includes(id));
    if (clash) return `${paddockName(clash)} já está no ${other.name}. Tire de lá primeiro.`;
  }
  return null;
}

/** Próxima troca prevista de um módulo, pelo plano de dias de ocupação. */
export interface PlannedMove {
  module: Module;
  lotId: string;
  lotName: string;
  from: PaddockView;
  to: PaddockView;
  /** Dias até a troca: 1 = amanhã, 0 = hoje, negativo = atrasada. */
  daysUntil: number;
  /** Descanso que o piquete de destino terá no dia da troca. Null sem dado de saída. */
  restAtEntry: number | null;
}

/**
 * Fila de trocas: para cada módulo com piquete ocupado, quando o lote deve ir
 * para o próximo da ordem. O último dia planejado de ocupação é a véspera da
 * troca (dia 6 de 6 → troca amanhã). Não entra módulo com um piquete só, nem
 * quando o próximo piquete já está ocupado.
 */
export function moveQueue(mods: readonly ModuleView[]): PlannedMove[] {
  const out: PlannedMove[] = [];
  for (const m of mods) {
    const from = m.current;
    const to = m.next;
    if (!from || !to || to === from || to.occupants.length || from.dayOfUse == null) continue;
    const lot = from.occupants[0];
    const daysUntil = m.module.occupationDays - from.dayOfUse + 1;
    out.push({
      module: m.module,
      lotId: lot.lot.id,
      lotName: from.occupants.map((o) => o.lot.name).join(' e '),
      from,
      to,
      daysUntil,
      restAtEntry: to.restDays == null ? null : to.restDays + Math.max(0, daysUntil),
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** "Amanhã", "Em 3 dias", "Hoje", "Atrasada 2 dias". */
export function whenText(daysUntil: number): string {
  if (daysUntil === 0) return 'Hoje';
  if (daysUntil === 1) return 'Amanhã';
  if (daysUntil > 1) return `Em ${daysUntil} dias`;
  return `Atrasada ${-daysUntil} ${daysUntil === -1 ? 'dia' : 'dias'}`;
}
