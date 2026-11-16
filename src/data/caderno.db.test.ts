// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, errorOf, freshDb } from '../test/pg';
import {
  COLS,
  eventToPayload,
  jsonToNotebookContext,
  lotToPayload,
  newFarmToArgs,
  notebookReportToPayload,
  rainToPayload,
  reportPatchToRow,
  rowToEvent,
  rowToFarm,
  rowToRain,
  rowToReport,
} from './rows';
import type { Lot, NewFarm, NotebookReport } from './types';
import type { LotEvent } from '../lib/lots/types';

// Regras do caderno da equipe (etapa 2), provadas num Postgres de verdade.

// biome-ignore lint: linhas do banco chegam sem tipo
type R = Record<string, any>;
const uuid = () => crypto.randomUUID();
const square = (lng: number, lat: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lng, lat], [lng + 0.01, lat], [lng + 0.01, lat + 0.01], [lng, lat + 0.01], [lng, lat]] as [number, number][]],
});

function newFarm(name: string, paddockNames: string[]): NewFarm {
  const farmId = uuid();
  return {
    farm: { id: farmId, name, municipality: null, centroid: null },
    paddocks: paddockNames.map((n, i) => ({
      id: uuid(), farmId, name: n, folder: null, geom: square(-40 + i * 0.02, -15), areaHa: 100, species: null, isGrazing: true, initialLastExit: null, sort: i,
    })),
    waterPoints: [],
  };
}

let db: PGlite;
const ana = uuid();
const bruno = uuid();
let faz: NewFarm;
let outra: NewFarm;
let lote: Lot;
let token = '';
let hoje = '';

const createFarm = (input: NewFarm) => {
  const a = newFarmToArgs(input);
  return db.query<R>('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(a.p_farm), JSON.stringify(a.p_paddocks), JSON.stringify(a.p_water_points)]);
};
const context = async (t: string | null) =>
  jsonToNotebookContext((await db.query<R>('select public.notebook_context($1) as c', [t])).rows[0].c);
const submit = async (t: string, r: NotebookReport) =>
  (await db.query<R>('select public.submit_field_report($1, $2::jsonb) as r', [t, JSON.stringify(notebookReportToPayload(r))])).rows[0].r as string;
const reports = async () => (await db.query<R>(`select ${COLS.field_reports} from public.field_reports order by created_at, id`)).rows.map(rowToReport);
const count = async (table: string) => Number((await db.query<R>(`select count(*) as n from public.${table}`)).rows[0].n);
const report = (over: Partial<NotebookReport> = {}): NotebookReport => ({
  id: uuid(), kind: 'chuva', date: hoje, mm: 12.5, reporter: 'Zé', deviceCreatedAt: new Date().toISOString(), ...over,
});
const dayOffset = async (n: number) =>
  String((await db.query<R>(`select to_char((now() at time zone 'America/Bahia')::date + $1::int, 'YYYY-MM-DD') as d`, [n])).rows[0].d);

beforeAll(async () => {
  db = await freshDb();
  await addUser(db, ana);
  await addUser(db, bruno);
  hoje = await dayOffset(0);
  faz = newFarm('Fazenda da Ana', ['P01', 'P02']);
  outra = newFarm('Fazenda do Bruno', ['Q01']);
  lote = { id: uuid(), farmId: faz.farm.id, name: 'Lote 1', deletedAt: null };
  await as(db, ana, async () => {
    await createFarm(faz);
    const inicio: LotEvent = { id: uuid(), lotId: lote.id, date: await dayOffset(-40), type: 'inicio', heads: 100, weightKg: 300, category: 'Recria' };
    const entrada: LotEvent = { id: uuid(), lotId: lote.id, date: await dayOffset(-10), type: 'piquete_entrada', paddockId: faz.paddocks[0].id };
    await db.query('select public.create_lot($1::jsonb, $2::jsonb)', [JSON.stringify(lotToPayload(lote)), JSON.stringify([inicio, entrada].map((e) => eventToPayload(faz.farm.id, e)))]);
    token = (await db.query<R>(`select ${COLS.farms} from public.farms`)).rows.map(rowToFarm)[0].shareToken!;
  });
  await as(db, bruno, () => createFarm(outra));
}, 60_000);

describe('link público (anônimo)', () => {
  it('com o token certo recebe só nomes de piquetes e lotes', async () => {
    await as(db, null, async () => {
      const c = await context(token);
      expect(c).toEqual({
        farmName: 'Fazenda da Ana',
        paddocks: faz.paddocks.map((p) => ({ id: p.id, name: p.name })),
        lots: [{ id: lote.id, name: 'Lote 1' }],
      });
    });
  });

  it('token errado, curto ou vazio não devolve nada', async () => {
    await as(db, null, async () => {
      expect(await context('x'.repeat(64))).toBeNull();
      expect(await context('abc')).toBeNull();
      expect(await context('')).toBeNull();
      expect(await context(null)).toBeNull();
    });
  });

  it('continua sem ler nem gravar tabela nenhuma diretamente', async () => {
    await as(db, null, async () => {
      for (const t of ['field_reports', 'rain_records', 'farms', 'lots', 'paddocks']) {
        expect(await errorOf(() => count(t)), t).toMatch(/permission denied/);
      }
      expect(await errorOf(() => db.query('insert into public.field_reports (id, farm_id, kind, report_date, mm) values ($1, $2, $3, $4, 1)', [uuid(), faz.farm.id, 'chuva', hoje]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('select public.rotate_share_token($1)', [faz.farm.id]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query("select public.record_rain('{}'::jsonb)"))).toMatch(/permission denied/);
    });
  });

  it('grava relato de chuva e de mudança, e o reenvio não duplica', async () => {
    const chuva = report();
    const mudanca = report({ kind: 'mudanca', mm: undefined, lotId: lote.id, toPaddockId: faz.paddocks[1].id, note: 'pasto rapado' });
    await as(db, null, async () => {
      expect(await submit(token, chuva)).toBe('ok');
      expect(await submit(token, mudanca)).toBe('ok');
      expect(await submit(token, chuva)).toBe('ja_recebido');
      expect(await submit(token, mudanca)).toBe('ja_recebido');
    });
    await as(db, ana, async () => {
      const all = await reports();
      expect(all).toHaveLength(2);
      expect(all.find((r) => r.id === chuva.id)).toMatchObject({ kind: 'chuva', date: hoje, mm: 12.5, reporter: 'Zé', status: 'novo', lotId: null });
      expect(all.find((r) => r.id === mudanca.id)).toMatchObject({ kind: 'mudanca', mm: null, lotId: lote.id, toPaddockId: faz.paddocks[1].id, note: 'pasto rapado', status: 'novo' });
    });
  });

  it('recusa token errado, data futura, chuva sem milímetros e lote ou piquete de outra fazenda', async () => {
    await as(db, null, async () => {
      expect(await errorOf(() => submit('y'.repeat(64), report()))).toMatch(/link do caderno não vale mais/);
      expect(await errorOf(async () => submit(token, report({ date: await dayOffset(3) })))).toMatch(/depois de hoje/);
      expect(await errorOf(async () => submit(token, report({ date: await dayOffset(-200) })))).toMatch(/antiga demais/);
      expect(await errorOf(() => submit(token, report({ mm: undefined })))).toMatch(/informe os milímetros/);
      expect(await errorOf(() => submit(token, report({ mm: 900 })))).toMatch(/informe os milímetros/);
      expect(await errorOf(() => submit(token, report({ kind: 'mudanca', lotId: lote.id, toPaddockId: outra.paddocks[0].id })))).toMatch(/Piquete não encontrado/);
      expect(await errorOf(() => submit(token, report({ kind: 'mudanca', lotId: uuid(), toPaddockId: faz.paddocks[1].id })))).toMatch(/Lote não encontrado/);
    });
    await as(db, ana, async () => expect(await count('field_reports')).toBe(2));
  });

  it('relato sem data cai no dia em que foi feito no aparelho, não no dia do envio', async () => {
    const id = uuid();
    const feito = `${await dayOffset(-3)}T15:00:00-03:00`;
    await as(db, null, async () => {
      await db.query('select public.submit_field_report($1, $2::jsonb)', [token, JSON.stringify({ id, kind: 'chuva', mm: 4, device_created_at: feito })]);
    });
    await as(db, ana, async () => {
      expect((await reports()).find((r) => r.id === id)!.date).toBe(await dayOffset(-3));
      await db.query('update public.field_reports set status = $1 where id = $2', ['descartado', id]);
    });
  });
});

describe('membro da fazenda', () => {
  it('quem não tem vínculo não vê os relatos nem a chuva', async () => {
    await as(db, bruno, async () => {
      expect(await count('field_reports')).toBe(0);
      expect(await count('rain_records')).toBe(0);
      const r = await db.query('update public.field_reports set status = $1', ['descartado']);
      expect(r.affectedRows).toBe(0);
    });
  });

  it('edita o relato antes de lançar, e quem revisou fica registrado pelo servidor', async () => {
    await as(db, ana, async () => {
      const chuva = (await reports()).find((r) => r.kind === 'chuva' && r.status === 'novo')!;
      const patch = reportPatchToRow({ mm: 15, date: await dayOffset(-1), note: 'corrigido' });
      const cols = Object.keys(patch);
      await db.query(`update public.field_reports set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [chuva.id, ...cols.map((c) => patch[c])]);
      expect((await reports()).find((r) => r.id === chuva.id)).toMatchObject({ mm: 15, date: await dayOffset(-1), note: 'corrigido', status: 'novo' });

      expect(await errorOf(() => db.query('update public.field_reports set reviewed_by = $1', [bruno]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('update public.field_reports set farm_id = $1', [outra.farm.id]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('delete from public.field_reports'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('insert into public.field_reports (id, farm_id, kind, report_date, mm) values ($1, $2, $3, $4, 1)', [uuid(), faz.farm.id, 'chuva', hoje]))).toMatch(/permission denied/);
    });
  });

  it('lança a chuva: o relato vira lançado e a leitura entra no dia; lançar de novo é recusado', async () => {
    await as(db, ana, async () => {
      const chuva = (await reports()).find((r) => r.kind === 'chuva' && r.status === 'novo')!;
      const rain = { id: uuid(), date: chuva.date, mm: chuva.mm!, note: null };
      const launch = () => db.query<R>(`select ${COLS.rain_records} from public.record_rain($1::jsonb, $2, $3)`, [JSON.stringify(rainToPayload(faz.farm.id, rain)), false, chuva.id]);
      expect((await launch()).rows.map(rowToRain)).toEqual([{ ...rain, reportId: chuva.id }]);
      expect(await errorOf(() => db.query('select public.record_rain($1::jsonb, $2, $3)', [JSON.stringify(rainToPayload(faz.farm.id, { ...rain, id: uuid() })), false, chuva.id]))).toMatch(/já foi lançado ou descartado/);
      expect(await count('rain_records')).toBe(1);

      const row = (await db.query<R>('select status, reviewed_by, reviewed_at from public.field_reports where id = $1', [chuva.id])).rows[0];
      expect(row).toMatchObject({ status: 'lancado', reviewed_by: ana });
      expect(row.reviewed_at).not.toBeNull();
    });
  });

  it('chuva no mesmo dia: sem substituir soma, com substituir fica só a nova', async () => {
    await as(db, ana, async () => {
      const dia = await dayOffset(-1);
      const total = async () => Number((await db.query<R>('select coalesce(sum(mm), 0) as t from public.rain_records where rain_date = $1 and deleted_at is null', [dia])).rows[0].t);
      expect(await total()).toBe(15);
      await db.query('select public.record_rain($1::jsonb, false)', [JSON.stringify(rainToPayload(faz.farm.id, { id: uuid(), date: dia, mm: 5, note: 'tarde' }))]);
      expect(await total()).toBe(20);
      await db.query('select public.record_rain($1::jsonb, true)', [JSON.stringify(rainToPayload(faz.farm.id, { id: uuid(), date: dia, mm: 8, note: null }))]);
      expect(await total()).toBe(8);
      // Nada some de verdade: as leituras antigas continuam no banco, apagadas de forma suave.
      expect(await count('rain_records')).toBe(3);
      const author = (await db.query<R>('select distinct author from public.rain_records')).rows;
      expect(author).toEqual([{ author: ana }]);
    });
  });

  it('lança a mudança de gado: saída e entrada entram juntas com o relato, e só uma vez', async () => {
    await as(db, ana, async () => {
      const mud = (await reports()).find((r) => r.kind === 'mudanca')!;
      const link = uuid();
      const events: LotEvent[] = [
        { id: uuid(), lotId: lote.id, date: mud.date, type: 'piquete_saida', paddockId: faz.paddocks[0].id, link },
        { id: uuid(), lotId: lote.id, date: mud.date, type: 'piquete_entrada', paddockId: mud.toPaddockId!, link },
      ];
      const payload = JSON.stringify(events.map((e) => eventToPayload(faz.farm.id, e)));
      const saved = (await db.query<R>(`select ${COLS.lot_events} from public.launch_move_report($1, $2::jsonb)`, [mud.id, payload])).rows.map(rowToEvent);
      expect(saved.map((e) => e.type)).toEqual(['piquete_saida', 'piquete_entrada']);
      expect(saved[0].seq!).toBeLessThan(saved[1].seq!);
      expect((await reports()).find((r) => r.id === mud.id)!.status).toBe('lancado');

      const antes = await count('lot_events');
      expect(await errorOf(() => db.query('select public.launch_move_report($1, $2::jsonb)', [mud.id, payload]))).toMatch(/já foi lançado ou descartado/);
      expect(await count('lot_events')).toBe(antes);
    });
  });

  it('se a gravação do histórico falha, o relato continua novo (tudo ou nada)', async () => {
    const mud = report({ kind: 'mudanca', mm: undefined, lotId: lote.id, toPaddockId: faz.paddocks[0].id });
    await as(db, null, () => submit(token, mud));
    await as(db, ana, async () => {
      const ruim = [{ id: uuid(), farm_id: faz.farm.id, lot_id: lote.id, event_date: hoje, type: 'piquete_entrada', paddock_id: outra.paddocks[0].id }];
      expect(await errorOf(() => db.query('select public.launch_move_report($1, $2::jsonb)', [mud.id, JSON.stringify(ruim)]))).toMatch(/foreign key|row-level security/);
      expect((await reports()).find((r) => r.id === mud.id)!.status).toBe('novo');
    });
  });

  it('descarta um relato e devolve para novo', async () => {
    await as(db, ana, async () => {
      const novo = (await reports()).find((r) => r.status === 'novo')!;
      await db.query('update public.field_reports set status = $1 where id = $2', ['descartado', novo.id]);
      expect((await reports()).find((r) => r.id === novo.id)!.status).toBe('descartado');
      await db.query('update public.field_reports set status = $1 where id = $2', ['novo', novo.id]);
      expect((await reports()).find((r) => r.id === novo.id)!.status).toBe('novo');
    });
  });
});

describe('troca do link', () => {
  it('quem não tem vínculo não troca; o dono troca e o link antigo para de valer', async () => {
    await as(db, bruno, async () => {
      expect(await errorOf(() => db.query('select public.rotate_share_token($1)', [faz.farm.id]))).toMatch(/não tem acesso/);
    });
    let novo = '';
    await as(db, ana, async () => {
      novo = (await db.query<R>('select public.rotate_share_token($1) as t', [faz.farm.id])).rows[0].t;
      expect(novo).toMatch(/^[0-9a-f]{64}$/);
      expect(novo).not.toBe(token);
    });
    await as(db, null, async () => {
      expect(await context(token)).toBeNull();
      expect(await errorOf(() => submit(token, report()))).toMatch(/link do caderno não vale mais/);
      expect((await context(novo))!.farmName).toBe('Fazenda da Ana');
      expect(await submit(novo, report())).toBe('ok');
    });
  });
});
