import { describe, expect, it } from 'vitest';
import { herdTemplateCsv, parseDateBr, parseHerdCsv, splitCsv } from './herdCsv';

const ctx = {
  paddocks: [
    { id: 'p1', name: 'P01', isGrazing: true },
    { id: 'p2', name: 'Várzea Grande', isGrazing: true },
    { id: 'p3', name: 'Reserva', isGrazing: false },
  ],
  existingLotNames: ['Lote Antigo'],
  today: '2026-11-15',
};

describe('splitCsv', () => {
  it('acha o separador e respeita aspas', () => {
    expect(splitCsv('a;b;c\r\n1;"x;y";3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', '3'],
    ]);
    expect(splitCsv('a,b\n"diz ""oi""",2')).toEqual([
      ['a', 'b'],
      ['diz "oi"', '2'],
    ]);
    expect(splitCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignora a marca de UTF-8 do Excel', () => {
    expect(splitCsv('﻿lote;cabecas')[0]).toEqual(['lote', 'cabecas']);
  });
});

describe('parseDateBr', () => {
  it('aceita dia/mês/ano e ISO, recusa data que não existe', () => {
    expect(parseDateBr('5/3/2026')).toBe('2026-03-05');
    expect(parseDateBr('05/03/26')).toBe('2026-03-05');
    expect(parseDateBr('2026-03-05')).toBe('2026-03-05');
    expect(parseDateBr('31/02/2026')).toBeNull();
    expect(parseDateBr('ontem')).toBeNull();
  });
});

describe('parseHerdCsv', () => {
  it('lê o formato do Excel em português, com cabeçalho acentuado e vírgula decimal', () => {
    const csv = [
      'Lote;Cabeças;Peso médio (kg);Categoria;Piquete;Data;Pesado na balança',
      'Garrotes;1.200;285,5;recria;p01;10/11/2026;sim',
      'Vacas paridas;80;;vaca;VARZEA GRANDE;;não',
    ].join('\r\n');
    const r = parseHerdCsv(csv, ctx);
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(2);
    const [a, b] = r.rows;
    expect(a).toMatchObject({ line: 2, name: 'Garrotes', heads: 1200, weightKg: 285.5, category: 'Recria', paddockId: 'p1', date: '2026-11-10', weighed: true, errors: [] });
    expect(b).toMatchObject({ name: 'Vacas paridas', heads: 80, weightKg: 450, category: 'Vacas', paddockId: 'p2', paddockName: 'Várzea Grande', date: '2026-11-15', weighed: false, errors: [] });
    expect(b.warnings.join(' ')).toMatch(/padrão de Vacas/);
    expect(b.warnings.join(' ')).toMatch(/data de hoje/);
  });

  it('aponta cada erro na linha certa', () => {
    const csv = [
      'lote;cabecas;peso_medio_kg;categoria;piquete;data;pesado_na_balanca',
      'Lote Antigo;10;300;Recria;P01;01/11/2026;',
      'L2;dez;300;Recria;P01;01/11/2026;',
      'L3;10;300;Cavalo;P01;01/11/2026;',
      'L4;10;300;Recria;P99;01/11/2026;',
      'L5;10;300;Recria;P01;01/12/2026;',
      'L6;10;;Recria;P01;01/11/2026;sim',
      'L6;10;300;Recria;;;talvez',
      ';10;300;Recria;;;',
    ].join('\n');
    const rows = parseHerdCsv(csv, ctx).rows;
    const err = (line: number) => rows.find((r) => r.line === line)!.errors.join(' ');
    expect(err(2)).toMatch(/Já existe um lote/);
    expect(err(3)).toMatch(/Cabeças inválidas/);
    expect(err(4)).toMatch(/Categoria "Cavalo" não existe/);
    expect(err(5)).toMatch(/Piquete "P99" não existe/);
    expect(err(6)).toMatch(/depois de hoje/);
    expect(err(7)).toMatch(/pesado na balança, mas sem peso/);
    expect(err(8)).toMatch(/Nome repetido \(já aparece na linha 7\)/);
    expect(err(8)).toMatch(/use sim ou não/);
    expect(err(9)).toMatch(/Falta o nome/);
  });

  it('avisa piquete fora do pastejo e lote sem piquete, sem barrar', () => {
    const rows = parseHerdCsv('lote;cabecas;categoria;piquete\nA;10;Recria;Reserva\nB;5;Touros;', ctx).rows;
    expect(rows.every((r) => !r.errors.length)).toBe(true);
    expect(rows[0].warnings.join(' ')).toMatch(/fora do pastejo/);
    expect(rows[1].paddockId).toBeNull();
    expect(rows[1].warnings.join(' ')).toMatch(/fora de piquete/);
  });

  it('recusa planilha sem as colunas obrigatórias ou sem linhas', () => {
    expect(parseHerdCsv('nome;peso\nA;300', ctx).error).toMatch(/"cabecas", "categoria"/);
    expect(parseHerdCsv('lote;cabecas;categoria\n', ctx).error).toMatch(/só tem o cabeçalho/);
    expect(parseHerdCsv('', ctx).error).toMatch(/vazia/);
  });

  it('piquete com nome repetido na fazenda não é adivinhado', () => {
    const dup = { ...ctx, paddocks: [...ctx.paddocks, { id: 'p4', name: 'p01', isGrazing: true }] };
    expect(parseHerdCsv('lote;cabecas;categoria;piquete\nA;10;Recria;P01', dup).rows[0].errors.join(' ')).toMatch(/Há 2 piquetes/);
  });

  it('o modelo baixado é lido de volta sem erro', () => {
    const csv = herdTemplateCsv(['P01', 'Várzea Grande'], '2026-11-15');
    expect(csv.startsWith('﻿')).toBe(true);
    const r = parseHerdCsv(csv, ctx);
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
    expect(r.rows.map((x) => x.paddockId)).toEqual(['p1', 'p2']);
  });
});
