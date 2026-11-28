import { parseNum } from '../format';
import { isIsoDate, type IsoDate } from './dates';
import { CATEGORIES } from './describe';

/**
 * Importação do rebanho de hoje por planilha (CSV). Uma linha por lote:
 * nome, cabeças, peso médio, categoria, piquete onde está, data e se o peso é
 * de balança. Não é importação de histórico: cada linha vira o cadastro do lote
 * (formação) e, se tiver piquete, a entrada nele na mesma data.
 */

export interface HerdRow {
  /** Linha da planilha (a do cabeçalho é a 1), para a mensagem apontar onde corrigir. */
  line: number;
  name: string;
  heads: number;
  weightKg: number;
  category: string;
  paddockId: string | null;
  paddockName: string | null;
  date: IsoDate;
  weighed: boolean;
  /** Impede a importação da linha. */
  errors: string[];
  /** Não impede, mas a pessoa precisa saber. */
  warnings: string[];
}

export interface HerdCsvResult {
  /** Erro que impede ler a planilha inteira (falta coluna, arquivo vazio). */
  error: string | null;
  rows: HerdRow[];
}

export interface HerdCsvContext {
  paddocks: readonly { id: string; name: string; isGrazing: boolean }[];
  /** Nomes de lotes que já existem na fazenda (não excluídos). */
  existingLotNames: readonly string[];
  today: IsoDate;
}

type Column = 'name' | 'heads' | 'weight' | 'category' | 'paddock' | 'date' | 'weighed';

/** Nomes aceitos para cada coluna, já sem acento, minúsculos e sem espaço ou pontuação. */
const ALIASES: Record<Column, string[]> = {
  name: ['lote', 'nome', 'nomedolote', 'nomelote'],
  heads: ['cabecas', 'cab', 'qtd', 'quantidade', 'animais', 'ncabecas', 'numerodecabecas'],
  weight: ['peso', 'pesomedio', 'pesomediokg', 'pesokg', 'pesomedioemkg', 'kg'],
  category: ['categoria', 'cat'],
  paddock: ['piquete', 'pasto', 'piqueteatual', 'ondeesta'],
  date: ['data', 'dataformacao', 'formadoem', 'datadeformacao', 'dataentrada', 'desde'],
  weighed: ['pesado', 'balanca', 'pesodebalanca', 'pesadonabalanca', 'pesagem'],
};

const REQUIRED: Column[] = ['name', 'heads', 'category'];

const LABEL: Record<Column, string> = {
  name: 'lote',
  heads: 'cabecas',
  weight: 'peso_medio_kg',
  category: 'categoria',
  paddock: 'piquete',
  date: 'data',
  weighed: 'pesado_na_balanca',
};

/** Ordem das colunas no modelo para baixar. */
export const TEMPLATE_COLUMNS = ['lote', 'cabecas', 'peso_medio_kg', 'categoria', 'piquete', 'data', 'pesado_na_balanca'] as const;

/** Sem acento, minúsculo, sem espaço nem pontuação: "Peso médio (kg)" vira "pesomediokg". */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Para comparar nomes de piquete e lote: sem acento, minúsculo, espaços simples. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa o CSV em linhas e campos. Aceita ponto e vírgula (Excel em português),
 * vírgula e tabulação, campos entre aspas (com aspas dobradas dentro) e quebra
 * de linha do Windows. O separador é o que mais aparece na primeira linha.
 */
export function splitCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ';');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim()));
}

/** "15/11/2026", "15/11/26", "2026-11-15" ou "15-11-2026" para 'AAAA-MM-DD'. Null se não der. */
export function parseDateBr(text: string): IsoDate | null {
  const t = text.trim();
  if (isIsoDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

function parseYesNo(text: string): boolean | null {
  const t = normalizeKey(text);
  if (!t) return false;
  if (['sim', 's', 'x', '1', 'yes', 'y', 'balanca', 'verdadeiro', 'true'].includes(t)) return true;
  if (['nao', 'n', '0', 'no', 'falso', 'false'].includes(t)) return false;
  return null;
}

function categoryOf(text: string): readonly [string, number] | null {
  const t = normalizeKey(text);
  if (!t) return null;
  // Aceita singular e plural ("vaca", "vacas", "novilha", "bezerro").
  return CATEGORIES.find(([c]) => {
    const k = normalizeKey(c);
    return k === t || k === `${t}s` || k.replace(/s$/, '') === t;
  }) ?? null;
}

/** Lê a planilha e confere cada linha contra a fazenda, sem gravar nada. */
export function parseHerdCsv(text: string, ctx: HerdCsvContext): HerdCsvResult {
  const table = splitCsv(text).filter((r) => r.some((f) => f !== ''));
  if (!table.length) return { error: 'A planilha está vazia.', rows: [] };

  const header = table[0].map(normalizeKey);
  const index = {} as Record<Column, number>;
  for (const col of Object.keys(ALIASES) as Column[]) {
    index[col] = header.findIndex((h) => ALIASES[col].includes(h));
  }
  const missing = REQUIRED.filter((c) => index[c] < 0);
  if (missing.length) {
    return {
      error: `Faltam as colunas ${missing.map((c) => `"${LABEL[c]}"`).join(', ')} na primeira linha. Baixe o modelo para ver o formato.`,
      rows: [],
    };
  }
  if (table.length === 1) return { error: 'A planilha só tem o cabeçalho, sem nenhum lote.', rows: [] };

  const paddocks = new Map<string, { id: string; name: string; isGrazing: boolean }[]>();
  for (const p of ctx.paddocks) {
    const k = normalizeName(p.name);
    paddocks.set(k, [...(paddocks.get(k) ?? []), p]);
  }
  const existing = new Set(ctx.existingLotNames.map(normalizeName));
  const seenNames = new Map<string, number>();
  const cell = (r: string[], col: Column) => (index[col] >= 0 ? r[index[col]] ?? '' : '');

  const rows: HerdRow[] = table.slice(1).map((r, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = cell(r, 'name').replace(/\s+/g, ' ');
    if (!name) errors.push('Falta o nome do lote.');
    else {
      const k = normalizeName(name);
      if (existing.has(k)) errors.push('Já existe um lote com esse nome na fazenda.');
      const before = seenNames.get(k);
      if (before != null) errors.push(`Nome repetido (já aparece na linha ${before}).`);
      else seenNames.set(k, line);
    }

    const headsText = cell(r, 'heads');
    // "1.200" em cabeças é milhar, não decimal.
    const heads = /^\d{1,3}(\.\d{3})+$/.test(headsText) ? Number(headsText.replace(/\./g, '')) : parseNum(headsText);
    if (!headsText) errors.push('Falta o número de cabeças.');
    else if (!Number.isInteger(heads) || heads <= 0) errors.push(`Cabeças inválidas: "${headsText}".`);

    const catText = cell(r, 'category');
    const cat = categoryOf(catText);
    if (!catText) errors.push('Falta a categoria.');
    else if (!cat) errors.push(`Categoria "${catText}" não existe. Use: ${CATEGORIES.map(([c]) => c).join(', ')}.`);

    const weightText = cell(r, 'weight');
    let weightKg = parseNum(weightText);
    if (!weightText) {
      if (cat) {
        weightKg = cat[1];
        warnings.push(`Sem peso: usa o padrão de ${cat[0]} (${cat[1]} kg).`);
      }
    } else if (!(weightKg > 0) || weightKg > 1500) errors.push(`Peso inválido: "${weightText}".`);

    const dateText = cell(r, 'date');
    let date: IsoDate = ctx.today;
    if (dateText) {
      const d = parseDateBr(dateText);
      if (!d) errors.push(`Data inválida: "${dateText}". Use dia/mês/ano.`);
      else if (d > ctx.today) errors.push('A data não pode ser depois de hoje.');
      else date = d;
    } else warnings.push('Sem data: entra com a data de hoje.');

    const weighedText = cell(r, 'weighed');
    const weighed = parseYesNo(weighedText);
    if (weighed == null) errors.push(`Em "pesado na balança", use sim ou não (veio "${weighedText}").`);
    if (weighed && !weightText) errors.push('Marcado como pesado na balança, mas sem peso.');

    const padText = cell(r, 'paddock');
    let paddockId: string | null = null;
    let paddockName: string | null = null;
    if (padText) {
      const found = paddocks.get(normalizeName(padText)) ?? [];
      if (!found.length) errors.push(`Piquete "${padText}" não existe na fazenda.`);
      else if (found.length > 1) errors.push(`Há ${found.length} piquetes chamados "${padText}". Renomeie um deles antes.`);
      else {
        paddockId = found[0].id;
        paddockName = found[0].name;
        if (!found[0].isGrazing) warnings.push(`${found[0].name} está marcado como fora do pastejo.`);
      }
    } else warnings.push('Sem piquete: o lote fica fora de piquete até a primeira mudança.');

    return {
      line,
      name,
      heads,
      weightKg,
      category: cat?.[0] ?? catText,
      paddockId,
      paddockName,
      date,
      weighed: weighed === true,
      errors,
      warnings,
    };
  });

  return { error: null, rows };
}

/**
 * Modelo para baixar, já com os piquetes da fazenda nos exemplos. Ponto e
 * vírgula e marca de UTF-8 no começo, para o Excel em português abrir com os
 * acentos e as colunas certas.
 */
export function herdTemplateCsv(paddockNames: readonly string[], today: IsoDate): string {
  const br = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`;
  const quote = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const [p1 = '', p2 = ''] = paddockNames;
  const lines = [
    TEMPLATE_COLUMNS.join(';'),
    ['Lote 1', '120', '280', 'Recria', quote(p1), br, 'sim'].join(';'),
    ['Lote 2', '85', '', 'Vacas', quote(p2), br, 'não'].join(';'),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
