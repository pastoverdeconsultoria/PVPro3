import type { GeoJsonPolygon } from '../lib/kml/parseKml';
import type { IsoDate } from '../lib/lots/dates';
import type { LotEvent } from '../lib/lots/types';

export interface Farm {
  id: string;
  name: string;
  municipality: string | null;
  centroid: { lat: number; lon: number } | null;
  /** Segredo do link do caderno da equipe. Só membro da fazenda recebe. */
  shareToken?: string | null;
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

export type ReportKind = 'chuva' | 'mudanca';
export type ReportStatus = 'novo' | 'lancado' | 'descartado';

/** Relato feito pela equipe no caderno. Fica "novo" até o consultor lançar ou descartar. */
export interface FieldReport {
  id: string;
  kind: ReportKind;
  /** Dia do fato, informado por quem relatou. */
  date: IsoDate;
  mm: number | null;
  lotId: string | null;
  toPaddockId: string | null;
  reporter: string | null;
  note: string | null;
  status: ReportStatus;
  /** Quando chegou ao servidor. */
  createdAt: string;
}

/** Uma leitura de chuva real. O total do dia é a soma das leituras do dia. */
export interface RainRecord {
  id: string;
  date: IsoDate;
  mm: number;
  note: string | null;
  reportId: string | null;
}

/** Adubação nitrogenada aplicada num piquete. Entra na projeção, com efeito distribuído em 60 dias. */
export interface Fertilization {
  id: string;
  paddockId: string;
  date: IsoDate;
  /** kg de N por hectare (não de ureia). */
  nKgHa: number;
  note: string | null;
}

/** Conta com acesso à fazenda. */
export interface FarmMember {
  userId: string;
  email: string;
  role: FarmRole;
}

/** Dono, acesso completo, ou leitura + campo (vê tudo, grava só troca de gado, pesagem e chuva). */
export type FarmRole = 'owner' | 'member' | 'viewer';

/** Convite ainda não usado: o e-mail ainda não criou conta. */
export interface FarmInvite {
  id: string;
  email: string;
  role: 'member' | 'viewer';
  createdAt: string;
}

export type ReportPatch = Partial<Pick<FieldReport, 'date' | 'mm' | 'lotId' | 'toPaddockId' | 'note'>>;

/** O que o link público mostra: o mínimo para quem relata reconhecer o lote e tocar no pasto certo. */
export interface NotebookContext {
  farmName: string;
  /** `outline`: contorno simplificado em [lng, lat], para o mapinha de toque. */
  paddocks: { id: string; name: string; outline?: [number, number][] | null }[];
  /** Só lotes com animais. `paddockId`: onde o lote está, contando relato ainda não revisado. */
  lots: { id: string; name: string; heads?: number; paddockId?: string | null }[];
}

/** Relato como sai do aparelho do vaqueiro. */
export interface NotebookReport {
  id: string;
  kind: ReportKind;
  date: IsoDate;
  mm?: number;
  lotId?: string;
  toPaddockId?: string;
  reporter?: string;
  note?: string;
  /** Quando foi feito no aparelho (pode ser bem antes do envio, se não havia sinal). */
  deviceCreatedAt: string;
}

/** Acesso do link público, sem login. Só duas operações, as duas conferem o token. */
export interface NotebookApi {
  /** Null quando o link não vale mais. */
  context(token: string): Promise<NotebookContext | null>;
  submit(token: string, report: NotebookReport): Promise<void>;
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
  reports: FieldReport[];
  rain: RainRecord[];
  /** Falso quando o banco ainda não tem as tabelas do caderno (falta rodar o SQL da etapa 2). */
  notebookReady?: boolean;
  fertilizations: Fertilization[];
  /** Falso quando o banco ainda não tem adubação e membros (falta rodar o SQL da etapa 4). */
  fertilizationReady?: boolean;
  /** Papel da conta nesta fazenda. Null quando o banco ainda não sabe dizer (vale como acesso completo). */
  myRole?: FarmRole | null;
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
    /** Verdadeiro quando a tabela ou função ainda não existe no banco (falta rodar uma migração). */
    readonly schemaMissing = false,
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

  /** Só os relatos do caderno, para conferir se chegou coisa nova sem reler a fazenda inteira. */
  listReports(farmId: string): Promise<FieldReport[]>;
  updateReport(reportId: string, patch: ReportPatch): Promise<void>;
  /** Descarta um relato, ou devolve um descartado para "novo". */
  setReportStatus(reportId: string, status: 'novo' | 'descartado'): Promise<void>;
  /** Lança um relato de mudança: grava os registros e marca o relato, tudo ou nada. */
  launchMoveReport(reportId: string, farmId: string, events: LotEvent[]): Promise<LotEvent[]>;
  /**
   * Registra chuva de um dia. `replace` apaga (suave) as leituras que já havia no
   * dia; sem ele a leitura se soma. Com `reportId`, o relato vira "lancado" junto.
   */
  recordRain(farmId: string, rain: Pick<RainRecord, 'id' | 'date' | 'mm' | 'note'>, options: { replace: boolean; reportId?: string }): Promise<RainRecord>;
  setRainDeleted(rainId: string, deletedAt: string | null): Promise<void>;
  /** Troca o link do caderno; o antigo para de funcionar. Devolve o token novo. */
  rotateShareToken(farmId: string): Promise<string>;

  recordFertilization(farmId: string, fertilization: Fertilization): Promise<void>;
  setFertilizationDeleted(fertilizationId: string, deletedAt: string | null): Promise<void>;
  renameFarm(farmId: string, patch: { name: string; municipality: string | null }): Promise<void>;
  listMembers(farmId: string): Promise<FarmMember[]>;
  /**
   * Dá acesso pelo e-mail. Só o dono. Conta que já existe entra na hora
   * ('member'); e-mail sem conta fica convidado ('invited') e pode se cadastrar.
   */
  addMember(farmId: string, email: string, role: 'member' | 'viewer'): Promise<'member' | 'invited'>;
  /** Troca entre acesso completo e leitura + campo. Só o dono. */
  setMemberRole(farmId: string, userId: string, role: 'member' | 'viewer'): Promise<void>;
  /** Tira o acesso (de forma suave). Só o dono, e nunca o próprio. */
  removeMember(farmId: string, userId: string): Promise<void>;
  /** Convites ainda não usados. Só o dono vê; os outros recebem lista vazia. */
  listInvites(farmId: string): Promise<FarmInvite[]>;
  cancelInvite(inviteId: string): Promise<void>;
  /** Transforma os convites do e-mail da conta em acesso. Devolve quantas fazendas foram liberadas. */
  claimInvites(): Promise<number>;
  /** Se a conta pode abrir fazenda nova (administrador do sistema). */
  canCreateFarms(): Promise<boolean>;
}

export interface Auth {
  currentUser(): Promise<User | null>;
  /**
   * Há sessão válida para falar com o servidor? Sem sinal o app abre com a
   * identidade guardada, mas a fila só é enviada com a sessão renovada: sem ela
   * o banco recusaria e o registro feito no campo seria desfeito.
   */
  hasSession(): Promise<boolean>;
  onChange(listener: (user: User | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Devolve `true` quando o Supabase exige confirmar o e-mail antes de entrar. */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  /** Manda o e-mail com o link para criar senha nova. */
  requestPasswordReset(email: string): Promise<void>;
  /** Grava a senha nova da conta logada (depois de abrir o link do e-mail). */
  updatePassword(password: string): Promise<void>;
  /** Avisa quando a pessoa chegou pelo link de "esqueci a senha". */
  onPasswordRecovery(listener: () => void): () => void;
}

/**
 * Gravação feita sem sinal, guardada no aparelho até conseguir enviar. Só as
 * ações de campo entram aqui: registros do lote, lote novo e chuva.
 */
export type PendingOp =
  | { id: string; kind: 'events'; events: LotEvent[] }
  | { id: string; kind: 'createLot'; lot: Lot; events: LotEvent[] }
  | { id: string; kind: 'rain'; rain: Pick<RainRecord, 'id' | 'date' | 'mm' | 'note'>; replace: boolean };

export const OFFLINE_MESSAGE = 'Sem resposta do servidor. Confira o sinal e tente de novo.';
