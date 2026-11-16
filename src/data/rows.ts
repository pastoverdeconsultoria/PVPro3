import type { LotEvent } from '../lib/lots/types';
import type { CompositionRow, Farm, FieldReport, Lot, Module, NewFarm, NotebookContext, NotebookReport, Paddock, RainRecord, WaterPoint } from './types';

// Tradução entre as linhas do banco (snake_case) e os tipos do app. Fica num
// arquivo só, sem dependência do Supabase, para o teste do banco conferir que as
// colunas e os formatos usados aqui existem de verdade no esquema.

/** Colunas lidas de cada tabela. */
export const COLS = {
  farms: 'id,name,municipality,centroid_lat,centroid_lon,share_token',
  paddocks: 'id,farm_id,name,folder,geom,area_ha,species,is_grazing,initial_last_exit,sort',
  water_points: 'id,farm_id,name,lat,lon',
  lots: 'id,farm_id,name,deleted_at',
  modules: 'id,farm_id,name,color,occupation_days,planned_lot_id,condition,m_ref',
  module_compositions: 'id,module_id,paddock_id,ord,valid_from',
  lot_events:
    'id,lot_id,event_date,seq,type,heads,weight_kg,category,pct_pv,paddock_id,reason,heads_weighed,link,note,deleted_at',
  field_reports: 'id,kind,report_date,mm,lot_id,to_paddock_id,reporter,note,status,created_at',
  rain_records: 'id,rain_date,mm,note,report_id',
} as const;

// biome-ignore lint: linhas do banco chegam sem tipo
type Row = Record<string, any>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
// O Postgres devolve `date` como texto 'AAAA-MM-DD'; alguns clientes devolvem Date.
const isoDate = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export function rowToFarm(r: Row): Farm {
  return {
    id: r.id,
    name: r.name,
    municipality: r.municipality ?? null,
    centroid:
      r.centroid_lat == null || r.centroid_lon == null ? null : { lat: num(r.centroid_lat), lon: num(r.centroid_lon) },
    shareToken: r.share_token ?? null,
  };
}

export function rowToPaddock(r: Row): Paddock {
  return {
    id: r.id,
    farmId: r.farm_id,
    name: r.name,
    folder: r.folder ?? null,
    geom: typeof r.geom === 'string' ? JSON.parse(r.geom) : r.geom,
    areaHa: num(r.area_ha),
    species: r.species ?? null,
    isGrazing: r.is_grazing,
    initialLastExit: r.initial_last_exit == null ? null : isoDate(r.initial_last_exit),
    sort: num(r.sort),
  };
}

export function rowToWaterPoint(r: Row): WaterPoint {
  return { id: r.id, farmId: r.farm_id, name: r.name ?? null, lat: num(r.lat), lon: num(r.lon) };
}

export function rowToLot(r: Row): Lot {
  return { id: r.id, farmId: r.farm_id, name: r.name, deletedAt: r.deleted_at ? String(r.deleted_at) : null };
}

export function rowToModule(r: Row): Module {
  return {
    id: r.id,
    farmId: r.farm_id,
    name: r.name,
    color: r.color,
    occupationDays: num(r.occupation_days),
    plannedLotId: r.planned_lot_id ?? null,
    condition: r.condition,
    mRef: num(r.m_ref),
  };
}

export function rowToComposition(r: Row): CompositionRow {
  return { id: r.id, moduleId: r.module_id, paddockId: r.paddock_id, ord: num(r.ord), validFrom: isoDate(r.valid_from) };
}

export function rowToEvent(r: Row): LotEvent {
  const base = {
    id: r.id as string,
    lotId: r.lot_id as string,
    date: isoDate(r.event_date),
    seq: num(r.seq),
    deletedAt: r.deleted_at ? String(r.deleted_at) : null,
    link: (r.link as string | null) ?? null,
    ...(r.note ? { note: r.note as string } : {}),
  };
  const reason = r.reason ? { reason: r.reason as string } : {};
  switch (r.type as LotEvent['type']) {
    case 'inicio':
      return { ...base, type: 'inicio', heads: num(r.heads), weightKg: num(r.weight_kg), category: r.category };
    case 'animais_entrada':
    case 'transf_in': {
      const w = numOrNull(r.weight_kg);
      return { ...base, type: r.type, heads: num(r.heads), ...(w == null ? {} : { weightKg: w }), ...reason };
    }
    case 'animais_saida':
    case 'transf_out':
      return { ...base, type: r.type, heads: num(r.heads), ...reason };
    case 'pesagem': {
      const hw = numOrNull(r.heads_weighed);
      return { ...base, type: 'pesagem', weightKg: num(r.weight_kg), ...(hw == null ? {} : { headsWeighed: hw }) };
    }
    case 'categoria':
      return { ...base, type: 'categoria', category: r.category };
    case 'suplemento':
      return { ...base, type: 'suplemento', pctPv: num(r.pct_pv) };
    case 'piquete_entrada':
    case 'piquete_saida':
      return { ...base, type: r.type, paddockId: r.paddock_id };
    default:
      throw new Error(`Tipo de registro desconhecido: ${String(r.type)}`);
  }
}

const timestamp = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export function rowToReport(r: Row): FieldReport {
  return {
    id: r.id,
    kind: r.kind,
    date: isoDate(r.report_date),
    mm: numOrNull(r.mm),
    lotId: r.lot_id ?? null,
    toPaddockId: r.to_paddock_id ?? null,
    reporter: r.reporter ?? null,
    note: r.note ?? null,
    status: r.status,
    createdAt: timestamp(r.created_at),
  };
}

export function rowToRain(r: Row): RainRecord {
  return { id: r.id, date: isoDate(r.rain_date), mm: num(r.mm), note: r.note ?? null, reportId: r.report_id ?? null };
}

/** Colunas de relato que o consultor pode alterar antes de lançar. */
export function reportPatchToRow(patch: { date?: string; mm?: number | null; lotId?: string | null; toPaddockId?: string | null; note?: string | null }): Row {
  const r: Row = {};
  if (patch.date !== undefined) r.report_date = patch.date;
  if (patch.mm !== undefined) r.mm = patch.mm;
  if (patch.lotId !== undefined) r.lot_id = patch.lotId;
  if (patch.toPaddockId !== undefined) r.to_paddock_id = patch.toPaddockId;
  if (patch.note !== undefined) r.note = patch.note;
  return r;
}

/** Chuva no formato que a função `record_rain` recebe. */
export function rainToPayload(farmId: string, rain: { id: string; date: string; mm: number; note: string | null }): Row {
  return { id: rain.id, farm_id: farmId, rain_date: rain.date, mm: rain.mm, note: rain.note };
}

/** Relato do caderno no formato que a função `submit_field_report` recebe. */
export function notebookReportToPayload(r: NotebookReport): Row {
  return {
    id: r.id,
    kind: r.kind,
    report_date: r.date,
    mm: r.kind === 'chuva' ? r.mm ?? null : null,
    lot_id: r.kind === 'mudanca' ? r.lotId ?? null : null,
    to_paddock_id: r.kind === 'mudanca' ? r.toPaddockId ?? null : null,
    reporter: r.reporter ?? null,
    note: r.note ?? null,
    device_created_at: r.deviceCreatedAt,
  };
}

/** Resposta da função `notebook_context`. Null quando o link não vale. */
export function jsonToNotebookContext(j: Row | null | string): NotebookContext | null {
  const v = typeof j === 'string' ? (JSON.parse(j) as Row | null) : j;
  if (!v) return null;
  return {
    farmName: v.farm_name,
    paddocks: ((v.paddocks ?? []) as Row[]).map((p) => ({ id: p.id, name: p.name, outline: p.outline ?? null })),
    lots: ((v.lots ?? []) as Row[]).map((l) => ({ id: l.id, name: l.name, heads: Number(l.heads ?? 0), paddockId: l.paddock_id ?? null })),
  };
}

/** Registro no formato que a função `record_lot_events` do banco recebe. `seq` não vai: é do servidor. */
export function eventToPayload(farmId: string, e: LotEvent): Row {
  const p: Row = {
    id: e.id,
    farm_id: farmId,
    lot_id: e.lotId,
    event_date: e.date,
    type: e.type,
    link: e.link ?? null,
    note: e.note ?? null,
  };
  if ('heads' in e) p.heads = e.heads;
  if ('weightKg' in e && e.weightKg != null) p.weight_kg = e.weightKg;
  if ('category' in e) p.category = e.category;
  if ('pctPv' in e) p.pct_pv = e.pctPv;
  if ('paddockId' in e) p.paddock_id = e.paddockId;
  if ('reason' in e && e.reason) p.reason = e.reason;
  if ('headsWeighed' in e && e.headsWeighed != null) p.heads_weighed = e.headsWeighed;
  return p;
}

/** Argumentos da função `create_farm`. */
export function newFarmToArgs(input: NewFarm): { p_farm: Row; p_paddocks: Row[]; p_water_points: Row[] } {
  return {
    p_farm: {
      id: input.farm.id,
      name: input.farm.name,
      municipality: input.farm.municipality,
      centroid_lat: input.farm.centroid?.lat ?? null,
      centroid_lon: input.farm.centroid?.lon ?? null,
    },
    p_paddocks: input.paddocks.map((p) => ({
      id: p.id,
      name: p.name,
      folder: p.folder,
      geom: p.geom,
      area_ha: Number(p.areaHa.toFixed(4)),
      species: p.species,
      is_grazing: p.isGrazing,
    })),
    p_water_points: input.waterPoints.map((w) => ({ id: w.id, name: w.name, lat: w.lat, lon: w.lon })),
  };
}

export function lotToPayload(lot: Lot): Row {
  return { id: lot.id, farm_id: lot.farmId, name: lot.name };
}

/** Argumentos da função `save_module`. */
export function moduleToArgs(
  m: Module,
  composition?: { validFrom: string; paddockIds: string[] },
): { p_module: Row; p_valid_from: string | null; p_paddocks: string[] | null } {
  return {
    p_module: {
      id: m.id,
      farm_id: m.farmId,
      name: m.name,
      color: m.color,
      occupation_days: m.occupationDays,
      planned_lot_id: m.plannedLotId,
      condition: m.condition,
      m_ref: m.mRef,
    },
    p_valid_from: composition?.validFrom ?? null,
    p_paddocks: composition?.paddockIds ?? null,
  };
}

/** Colunas de piquete que o app pode alterar (as mesmas liberadas no banco). */
export function paddockPatchToRow(patch: {
  name?: string;
  species?: string | null;
  isGrazing?: boolean;
  initialLastExit?: string | null;
}): Row {
  const r: Row = {};
  if (patch.name !== undefined) r.name = patch.name;
  if (patch.species !== undefined) r.species = patch.species;
  if (patch.isGrazing !== undefined) r.is_grazing = patch.isGrazing;
  if (patch.initialLastExit !== undefined) r.initial_last_exit = patch.initialLastExit;
  return r;
}
