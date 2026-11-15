// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diffDays, formatBr, isIsoDate } from './dates';
import { deriveLot, orderEvents, paddockOccupancy, stateAt, validateLot } from './deriveLot';
import { checkChange, lastSeq, planMove, planRemoval, planRestore } from './changes';
import type { LotEvent } from './types';

const LOT = 'l1';
const TODAY = '2026-11-15';

let ids = 0;
const id = () => `e${++ids}`;

/** Simula o servidor: grava os registros novos dando `seq` crescente, na ordem recebida. */
function save(events: LotEvent[], created: LotEvent[]): LotEvent[] {
  let seq = lastSeq(events);
  return [...events, ...created.map((e) => ({ ...e, seq: ++seq }))];
}

function formed(date = '2026-01-10', heads = 100, weightKg = 300): LotEvent[] {
  return save([], [{ id: id(), lotId: LOT, date, type: 'inicio', heads, weightKg, category: 'Recria' }]);
}

function move(events: LotEvent[], toPaddockId: string, date: string): LotEvent[] {
  const r = planMove({ events, lotId: LOT, toPaddockId, date, today: TODAY, newId: id });
  if (!r.ok) throw new Error(r.error);
  return save(events, r.value);
}

const moveError = (events: LotEvent[], toPaddockId: string, date: string, today = TODAY) => {
  const r = planMove({ events, lotId: LOT, lotName: 'Lote 1', toPaddockId, date, today, newId: id });
  return r.ok ? null : r.error;
};

describe('datas', () => {
  it('valida, formata e conta dias', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('15/11/2026')).toBe(false);
    expect(formatBr('2026-11-15')).toBe('15/11/2026');
    expect(diffDays('2026-02-27', '2026-03-02')).toBe(3);
  });
});

describe('onde está o lote (deduzido do histórico)', () => {
  it('lote sem nenhuma movimentação', () => {
    expect(deriveLot(LOT, formed()).location).toEqual({ kind: 'sem_movimentacao' });
  });

  it('lote no piquete, com a data de entrada', () => {
    const ev = move(formed(), 'p1', '2026-01-10');
    expect(deriveLot(LOT, ev).location).toEqual({ kind: 'no_piquete', paddockId: 'p1', since: '2026-01-10' });
  });

  it('lote cuja última movimentação foi saída', () => {
    let ev = move(formed(), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-01-20', type: 'piquete_saida', paddockId: 'p1' }]);
    expect(deriveLot(LOT, ev).location).toEqual({ kind: 'fora', since: '2026-01-20', lastPaddockId: 'p1' });
  });

  it('as três situações são distintas da de lote sem animais', () => {
    let ev = move(formed(), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 100, reason: 'Venda' }]);
    expect(deriveLot(LOT, ev).location).toEqual({ kind: 'sem_animais', since: '2026-02-01' });
  });

  it('não há campo de piquete atual: o resultado muda só porque o histórico mudou', () => {
    const ev = move(move(formed(), 'p1', '2026-01-10'), 'p2', '2026-01-15');
    expect(deriveLot(LOT, ev).location).toMatchObject({ paddockId: 'p2' });
    const semUltima = ev.filter((e) => !(e.date === '2026-01-15'));
    expect(deriveLot(LOT, semUltima).location).toMatchObject({ paddockId: 'p1', since: '2026-01-10' });
  });
});

describe('mudança de piquete', () => {
  it('grava saída e entrada no mesmo dia, ligadas, com a saída antes', () => {
    const base = move(formed(), 'p1', '2026-01-10');
    const r = planMove({ events: base, lotId: LOT, toPaddockId: 'p2', date: '2026-01-15', today: TODAY, newId: id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((e) => [e.type, 'paddockId' in e ? e.paddockId : null, e.date])).toEqual([
      ['piquete_saida', 'p1', '2026-01-15'],
      ['piquete_entrada', 'p2', '2026-01-15'],
    ]);
    expect(r.value[0].link).toBeTruthy();
    expect(r.value[0].link).toBe(r.value[1].link);

    const d = deriveLot(LOT, save(base, r.value));
    expect(d.problems).toEqual([]);
    expect(d.stays).toEqual([
      { lotId: LOT, paddockId: 'p1', start: '2026-01-10', end: '2026-01-15' },
      { lotId: LOT, paddockId: 'p2', start: '2026-01-15', end: null },
    ]);
  });

  it('primeira entrada de um lote sem piquete grava só a entrada', () => {
    const r = planMove({ events: formed(), lotId: LOT, toPaddockId: 'p1', date: '2026-01-12', today: TODAY, newId: id });
    expect(r.ok && r.value.map((e) => e.type)).toEqual(['piquete_entrada']);
  });

  it('a ordem dentro do dia importa: entrada gravada antes da saída vira inconsistência', () => {
    const base = move(formed(), 'p1', '2026-01-10');
    const r = planMove({ events: base, lotId: LOT, toPaddockId: 'p2', date: '2026-01-15', today: TODAY, newId: id });
    if (!r.ok) throw new Error(r.error);
    const invertido = save(base, [...r.value].reverse());
    expect(deriveLot(LOT, invertido).problems.map((p) => p.kind)).toEqual(['entrada_sem_saida', 'saida_de_outro_piquete']);
    expect(validateLot(LOT, invertido, 'Lote 1')).toContain('sem ter saído do anterior');
  });

  it('mudança lançada offline (sem seq) conta depois do que já está gravado no dia', () => {
    const base = move(formed(), 'p1', '2026-01-10');
    const r = planMove({ events: base, lotId: LOT, toPaddockId: 'p2', date: '2026-01-10', today: TODAY, newId: id });
    if (!r.ok) throw new Error(r.error);
    const d = deriveLot(LOT, [...r.value, ...base]); // sem seq e fora de ordem na lista
    expect(d.problems).toEqual([]);
    expect(d.location).toEqual({ kind: 'no_piquete', paddockId: 'p2', since: '2026-01-10' });
  });

  it('passar por um piquete e sair no mesmo dia não deixa estadia', () => {
    const ev = move(move(formed(), 'p1', '2026-01-10'), 'p2', '2026-01-10');
    expect(deriveLot(LOT, ev).stays).toEqual([{ lotId: LOT, paddockId: 'p2', start: '2026-01-10', end: null }]);
  });

  it('recusa com mensagem', () => {
    const emP1 = move(formed(), 'p1', '2026-01-10');
    expect(moveError(emP1, 'p1', '2026-01-12')).toBe('O lote já está nesse piquete.');
    expect(moveError(emP1, 'p2', '2026-01-09')).toBe('Lote 1 foi formado em 10/01/2026.');
    expect(moveError(move(emP1, 'p2', '2026-01-20'), 'p3', '2026-01-18')).toBe(
      'A entrada atual foi em 20/01/2026; a saída não pode ser antes disso.',
    );
    expect(moveError(emP1, 'p2', '2026-11-16')).toBe('A data não pode ser depois de hoje.');
    expect(moveError(emP1, 'p2', '2026-02-31')).toBe('Informe a data.');
  });

  it('entrada com data antiga não passa na frente de uma saída posterior', () => {
    let ev = move(formed(), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-01-20', type: 'piquete_saida', paddockId: 'p1' }]);
    expect(moveError(ev, 'p2', '2026-01-15')).toBe('A última saída foi em 20/01/2026; a entrada não pode ser antes disso.');
    expect(moveError(ev, 'p2', '2026-01-20')).toBeNull();
  });

  it('lote sem animais não muda de piquete', () => {
    const ev = save(formed(), [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 100 }]);
    expect(moveError(ev, 'p1', '2026-02-05')).toBe('Lote 1 não tem animais em 05/02/2026.');
  });

  it('reafirmar a entrada no piquete onde o lote já está não parte a estadia', () => {
    let ev = move(formed(), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-01-14', type: 'piquete_entrada', paddockId: 'p1' }]);
    const d = deriveLot(LOT, ev);
    expect(d.problems).toEqual([]);
    expect(d.stays).toEqual([{ lotId: LOT, paddockId: 'p1', start: '2026-01-10', end: null }]);
  });
});

describe('estado do lote', () => {
  it('peso médio ponderado ao entrar animais; quem entra sem peso entra na média', () => {
    let ev = formed('2026-01-10', 100, 300);
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_entrada', heads: 50, weightKg: 240 }]);
    expect(deriveLot(LOT, ev).current).toMatchObject({ heads: 150, weightKg: 280 });
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-02', type: 'animais_entrada', heads: 10 }]);
    expect(deriveLot(LOT, ev).current).toMatchObject({ heads: 160, weightKg: 280 });
  });

  it('pesagem sobrescreve o peso; apagar a última devolve o da anterior; sem pesagem, o do cadastro', () => {
    let ev = formed('2026-01-10', 100, 300);
    const p1 = id();
    const p2 = id();
    ev = save(ev, [{ id: p1, lotId: LOT, date: '2026-02-10', type: 'pesagem', weightKg: 320 }]);
    ev = save(ev, [{ id: p2, lotId: LOT, date: '2026-03-10', type: 'pesagem', weightKg: 345 }]);
    expect(deriveLot(LOT, ev).current!.weightKg).toBe(345);

    const semUltima = planRemoval(LOT, ev, p2, '2026-03-11T10:00:00Z');
    if (!semUltima.ok) throw new Error(semUltima.error);
    expect(deriveLot(LOT, semUltima.value).current!.weightKg).toBe(320);

    const semNenhuma = planRemoval(LOT, semUltima.value, p1, '2026-03-11T10:01:00Z');
    if (!semNenhuma.ok) throw new Error(semNenhuma.error);
    expect(deriveLot(LOT, semNenhuma.value).current!.weightKg).toBe(300);
  });

  it('dois registros no mesmo dia desempatam pelo seq, não pela posição na lista', () => {
    const ev = formed('2026-01-10', 100, 300);
    const a: LotEvent = { id: id(), lotId: LOT, date: '2026-02-10', type: 'pesagem', weightKg: 310, seq: 5 };
    const b: LotEvent = { id: id(), lotId: LOT, date: '2026-02-10', type: 'pesagem', weightKg: 330, seq: 6 };
    expect(deriveLot(LOT, [...ev, a, b]).current!.weightKg).toBe(330);
    expect(deriveLot(LOT, [b, a, ...ev]).current!.weightKg).toBe(330);
    expect(orderEvents([b, a, ...ev]).map((e) => e.seq)).toEqual([1, 5, 6]);
  });

  it('registro com data passada recalcula o que vem depois', () => {
    let ev = formed('2026-01-10', 100, 300);
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-03-01', type: 'categoria', category: 'Engorda' }]);
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 4, reason: 'Morte' }]);
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-15', type: 'suplemento', pctPv: 0.5 }]);
    const d = deriveLot(LOT, ev);
    expect(d.timeline.map((s) => [s.date, s.heads, s.category, s.supplPct])).toEqual([
      ['2026-01-10', 100, 'Recria', 0],
      ['2026-02-01', 96, 'Recria', 0],
      ['2026-02-15', 96, 'Recria', 0.5],
      ['2026-03-01', 96, 'Engorda', 0.5],
    ]);
    expect(stateAt(d, '2026-02-20')).toMatchObject({ heads: 96, supplPct: 0.5, category: 'Recria' });
    expect(stateAt(d, '2026-01-01')).toBeNull();
  });
});

describe('validação: alteração que quebra o histórico é recusada', () => {
  it('cabeças negativas', () => {
    const ev = save(formed('2026-01-10', 100), [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 101 }]);
    expect(validateLot(LOT, ev, 'Lote 1')).toBe('Lote 1 ficaria com menos de zero cabeças em 01/02/2026.');
  });

  it('saída antiga que deixaria o lote negativo mais adiante', () => {
    let ev = formed('2026-01-10', 100);
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-03-01', type: 'animais_saida', heads: 90 }]);
    const tentativa = [...ev, { id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 20 } as LotEvent];
    const r = checkChange(LOT, tentativa, 'Lote 1');
    expect(r).toEqual({ ok: false, error: 'Lote 1 ficaria com menos de zero cabeças em 01/03/2026.' });
  });

  it('registro antes da formação do lote', () => {
    const ev = save(formed('2026-01-10'), [{ id: id(), lotId: LOT, date: '2026-01-05', type: 'pesagem', weightKg: 290 }]);
    expect(validateLot(LOT, ev, 'Lote 1')).toBe('Há registro de Lote 1 antes da formação do lote (10/01/2026).');
  });

  it('lote sem formação e formação duplicada', () => {
    const solto: LotEvent[] = [{ id: id(), lotId: LOT, date: '2026-01-10', type: 'pesagem', weightKg: 300, seq: 1 }];
    expect(deriveLot(LOT, solto).problems.map((p) => p.kind)).toEqual(['sem_formacao']);
    const dupla = save(formed(), [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'inicio', heads: 5, weightKg: 200, category: 'Recria' }]);
    expect(deriveLot(LOT, dupla).problems.map((p) => p.kind)).toEqual(['formacao_duplicada']);
  });

  it('a formação do lote não pode ser excluída', () => {
    const ev = formed();
    expect(planRemoval(LOT, ev, ev[0].id, 'x')).toEqual({ ok: false, error: 'A formação do lote não pode ser excluída.' });
    expect(planRemoval(LOT, ev, 'nao-existe', 'x')).toEqual({ ok: false, error: 'Registro não encontrado.' });
  });
});

describe('apagar é suave e reversível', () => {
  it('apagar uma mudança tira saída e entrada juntas e o lote volta ao piquete anterior', () => {
    const ev = move(move(formed(), 'p1', '2026-01-10'), 'p2', '2026-01-15');
    const entradaP2 = ev.find((e) => e.type === 'piquete_entrada' && e.paddockId === 'p2')!;
    const r = planRemoval(LOT, ev, entradaP2.id, '2026-01-16T08:00:00Z');
    if (!r.ok) throw new Error(r.error);

    expect(r.value).toHaveLength(ev.length); // nada some do banco
    expect(r.value.filter((e) => e.deletedAt).map((e) => e.type).sort()).toEqual(['piquete_entrada', 'piquete_saida']);
    expect(deriveLot(LOT, r.value).location).toEqual({ kind: 'no_piquete', paddockId: 'p1', since: '2026-01-10' });
    expect(deriveLot(LOT, r.value).stays).toEqual([{ lotId: LOT, paddockId: 'p1', start: '2026-01-10', end: null }]);

    const volta = planRestore(LOT, r.value, entradaP2.id);
    if (!volta.ok) throw new Error(volta.error);
    expect(deriveLot(LOT, volta.value).location).toMatchObject({ paddockId: 'p2', since: '2026-01-15' });
  });

  it('apagar a entrada do meio de uma sequência é recusado, porque deixaria saída sem entrada', () => {
    let ev = move(formed(), 'p1', '2026-01-10');
    const primeira = ev.find((e) => e.type === 'piquete_entrada')!;
    ev = move(ev, 'p2', '2026-01-15');
    const r = planRemoval(LOT, ev, primeira.id, 'x', 'Lote 1');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('sem entrada antes');
  });
});

describe('lote que zera não ocupa piquete', () => {
  it('a estadia fecha no dia em que o lote zerou', () => {
    let ev = move(formed('2026-01-10', 100), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 100, reason: 'Venda' }]);
    const d = deriveLot(LOT, ev);
    expect(d.stays).toEqual([{ lotId: LOT, paddockId: 'p1', start: '2026-01-10', end: '2026-02-01' }]);
    expect(d.problems).toEqual([]);
  });

  it('zerou no dia da entrada: a estadia some', () => {
    let ev = move(formed('2026-01-10', 100), 'p1', '2026-01-10');
    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-01-10', type: 'transf_out', heads: 100 }]);
    expect(deriveLot(LOT, ev).stays).toEqual([]);
  });

  it('piquete só aparece ocupado por lote com animais e estadia aberta', () => {
    const other = (e: LotEvent): LotEvent => ({ ...e, lotId: 'l2', id: id() });
    let ev = move(formed('2026-01-10', 100), 'p1', '2026-01-10');
    // Segundo lote no mesmo piquete, e um terceiro registro de lote vendido.
    const l2: LotEvent[] = [
      other({ id: '', lotId: '', date: '2026-01-12', type: 'inicio', heads: 30, weightKg: 400, category: 'Engorda', seq: 50 }),
      other({ id: '', lotId: '', date: '2026-01-12', type: 'piquete_entrada', paddockId: 'p1', seq: 51 }),
    ];
    expect(paddockOccupancy([...ev, ...l2])).toEqual(new Map([['p1', [LOT, 'l2']]]));

    ev = save(ev, [{ id: id(), lotId: LOT, date: '2026-02-01', type: 'animais_saida', heads: 100 }]);
    expect(paddockOccupancy([...ev, ...l2])).toEqual(new Map([['p1', ['l2']]]));
  });
});
