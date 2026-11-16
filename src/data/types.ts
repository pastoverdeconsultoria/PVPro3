import type { GeoJsonPolygon } from '../lib/kml/parseKml';
import type { IsoDate } from '../lib/lots/dates';
import type { LotEvent } from '../lib/lots/types';

export interface Farm {
  id: string;
  name: string;
  municipality: string | null;
  centroid: { lat: number; lon: number } | null;
}

export interface Paddock {
  id: string;
  farmId: string;
  name: string;
  /** Pasta do Google Earth de onde o polígono veio (ex.: "Bloco A"). */
  folder: string | null;
  geom: GeoJsonPolygon;
  areaHa: number;
  species: string | null;
  isGrazing: boolean;
  /** Última saída de gado informada na abertura, antes de existir histórico. */
  initialLastExit: IsoDate | null;
  sort: number;
}

export interface WaterPoint {
  id: string;
  farmId: string;
  name: string | null;
  lat: number;
  lon: number;
}

/** Do lote só o nome é gravado. Cabeças, peso e onde está saem do histórico. */
export interface Lot {
  id: string;
  farmId: string;
  name: string;
  deletedAt: string | null;
}

export type ModuleCondition = 'extensiva' | 'adubada';

export interface Module {
  id: string;
  farmId: string;
  name: string;
  color: string;
  occupationDays: number;
  plannedLotId: string | null;
  condition: ModuleCondition;
  mRef: number;
}

/** Um piquete numa posição do módulo, valendo a partir de uma data. */
export interface CompositionRow {
  id: string;
  moduleId: string;
  paddockId: string;
  ord: number;
  validFrom: IsoDate;
}

/** Tudo de uma fazenda que as telas precisam. O estado dos lotes é derivado de `events`. */
export interface FarmData {
  farm: Farm;
  paddocks: Paddock[];
  waterPoints: WaterPoint[];
  lots: Lot[];
  modules: Module[];
  compositions: CompositionRow[];
  events: LotEvent[];
}

export interface NewFarm {
  farm: Farm;
  paddocks: Paddock[];
  waterPoints: WaterPoint[];
}

export type PaddockPatch = Partial<Pick<Paddock, 'name' | 'species' | 'isGrazing' | 'initialLastExit'>>;

export interface User {
  id: string;
  email: string;
}

/** Erro com mensagem pronta para a tela. */
export class RepoError extends Error {
  constructor(
    message: string,
    /** Verdadeiro quando o servidor não respondeu (sem sinal ou tempo esgotado). */
    readonly offline = false,
  ) {
    super(message);
    this.name = 'RepoError';
  }
}

/** Acesso aos dados. O app usa o Supabase; os testes de tela usam uma versão em memória. */
export interface Repo {
  listFarms(): Promise<Farm[]>;
  loadFarm(farmId: string): Promise<FarmData>;
  createFarm(input: NewFarm): Promise<void>;
  updatePaddock(paddockId: string, patch: PaddockPatch): Promise<void>;
  /** Grava o módulo; com `composition`, grava também a ordem dos piquetes a partir da data. */
  saveModule(module: Module, composition?: { validFrom: IsoDate; paddockIds: string[] }): Promise<void>;
  setModuleDeleted(moduleId: string, deletedAt: string | null): Promise<void>;
  /** Cria o lote com o registro de formação. Devolve os registros como ficaram gravados (com `seq`). */
  createLot(lot: Lot, events: LotEvent[]): Promise<LotEvent[]>;
  /** Grava registros na ordem dada, numa transação só. Devolve como ficaram gravados. */
  recordEvents(farmId: string, events: LotEvent[]): Promise<LotEvent[]>;
  /** Apaga de forma suave (ou desfaz, com `null`) um grupo de registros de uma vez. */
  setEventsDeleted(eventIds: string[], deletedAt: string | null): Promise<void>;
  setLotDeleted(lotId: string, deletedAt: string | null): Promise<void>;
}

export interface Auth {
  currentUser(): Promise<User | null>;
  onChange(listener: (user: User | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Devolve `true` quando o Supabase exige confirmar o e-mail antes de entrar. */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

export const OFFLINE_MESSAGE = 'Sem resposta do servidor. Confira o sinal e tente de novo.';
