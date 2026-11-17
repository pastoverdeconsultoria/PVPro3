// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, errorOf, freshDb } from '../test/pg';
import { COLS, eventToPayload, fertilizationToRow, lotToPayload, moduleToArgs, newFarmToArgs, rainToPayload, rowToEvent } from './rows';
import type { Lot, NewFarm } from './types';
import type { LotEvent } from '../lib/lots/types';

// Papel "leitura + campo": vê tudo, grava só mudança de piquete, pesagem e chuva.

// biome-ignore lint: linhas do banco chegam sem tipo
type R = Record<string, any>;
const uuid = () => crypto.randomUUID();
const square = (lng: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lng, -15], [lng + 0.01, -15], [lng + 0.01, -14.99], [lng, -14.99], [lng, -15]] as [number, number][]],
});
function newFarm(): NewFarm {
  const farmId = uuid();
  return {
    farm: { id: farmId, name: 'Fazenda A', municipality: null, centroid: null },
    paddocks: ['P01', 'P02'].map((n, i) => ({ id: uuid(), farmId, name: n, folder: null, geom: square(-40 + i * 0.02), areaHa: 50, species: null, isGrazing: true, initialLastExit: null, sort: i })),
    waterPoints: [],
  };
}

let db: PGlite;
const lucas = uuid();
const cliente = uuid();
let faz: NewFarm;
let lote: Lot;

const q = (sql: string, params: unknown[] = []) => db.query<R>(sql, params);
const record = async (events: LotEvent[]) =>
  (await q(`select ${COLS.lot_events} from public.record_lot_events($1::jsonb)`, [JSON.stringify(events.map((e) => eventToPayload(faz.farm.id, e)))])).rows.map(rowToEvent);
const role = async () => (await q('select public.my_farm_role($1) as r', [faz.farm.id])).rows[0].r;
const base = () => ({ id: uuid(), lotId: lote.id, date: '2026-11-10' });

beforeAll(async () => {
  db = await freshDb();
  await addUser(db, lucas, 'lucas@exemplo.test');
  await addUser(db, cliente, 'cliente@exemplo.test', { admin: false });
  faz = newFarm();
  lote = { id: uuid(), farmId: faz.farm.id, name: 'Lote 1', deletedAt: null };
  await as(db, lucas, async () => {
    const a = newFarmToArgs(faz);
    await q('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(a.p_farm), JSON.stringify(a.p_paddocks), JSON.stringify(a.p_water_points)]);
    await q(`select ${COLS.lot_events} from public.create_lot($1::jsonb, $2::jsonb)`, [
      JSON.stringify(lotToPayload(lote)),
      JSON.stringify([eventToPayload(faz.farm.id, { id: uuid(), lotId: lote.id, date: '2026-11-01', type: 'inicio', heads: 100, weightKg: 300, category: 'Recria' })]),
    ]);
    // Padrão do convite é leitura.
    expect((await q('select public.add_farm_member($1, $2) as r', [faz.farm.id, 'cliente@exemplo.test'])).rows[0].r).toBe('member');
  });
}, 120_000);

describe('leitura + campo', () => {
  it('o cliente vê tudo e sabe o próprio papel', async () => {
    await as(db, cliente, async () => {
      expect(await role()).toBe('viewer');
      expect((await q('select name from public.lots')).rows).toEqual([{ name: 'Lote 1' }]);
      expect((await q('select count(*)::int as n from public.paddocks')).rows[0].n).toBe(2);
    });
    await as(db, lucas, async () => expect(await role()).toBe('owner'));
  });

  it('grava mudança de piquete, pesagem e chuva', async () => {
    await as(db, cliente, async () => {
      const saved = await record([
        { ...base(), type: 'piquete_entrada', paddockId: faz.paddocks[0].id },
        { ...base(), date: '2026-11-12', type: 'pesagem', weightKg: 310, headsWeighed: 20 },
      ]);
      expect(saved.map((e) => e.type)).toEqual(['piquete_entrada', 'pesagem']);
      await q('select public.record_rain($1::jsonb, false, null)', [JSON.stringify(rainToPayload(faz.farm.id, { id: uuid(), date: '2026-11-12', mm: 18, note: null }))]);
      expect((await q('select count(*)::int as n from public.rain_records')).rows[0].n).toBe(1);
    });
  });

  it('não grava nada fora do campo', async () => {
    await as(db, cliente, async () => {
      expect(await errorOf(() => record([{ ...base(), type: 'animais_saida', heads: 5 }]))).toMatch(/row-level security/);
      expect(await errorOf(() => record([{ ...base(), type: 'suplemento', pctPv: 1 }]))).toMatch(/row-level security/);
      const novo: Lot = { id: uuid(), farmId: faz.farm.id, name: 'Lote 2', deletedAt: null };
      expect(await errorOf(() => q('select public.create_lot($1::jsonb, $2::jsonb)', [JSON.stringify(lotToPayload(novo)), '[]']))).toMatch(/row-level security/);
      const m = moduleToArgs({ id: uuid(), farmId: faz.farm.id, name: 'M', color: '#fff', occupationDays: 3, plannedLotId: null, condition: 'extensiva', mRef: 40 });
      expect(await errorOf(() => q('select public.save_module($1::jsonb, null, null)', [JSON.stringify(m.p_module)]))).toMatch(/row-level security/);
      const fert = fertilizationToRow(faz.farm.id, { id: uuid(), paddockId: faz.paddocks[0].id, date: '2026-11-03', nKgHa: 40, note: null });
      const cols = Object.keys(fert);
      expect(await errorOf(() => q(`insert into public.fertilizations (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => fert[c])))).toMatch(/row-level security/);
      expect(await errorOf(() => q('select public.rotate_share_token($1)', [faz.farm.id]))).toMatch(/não pode trocar o link/);
      expect(await errorOf(() => q('select public.add_farm_member($1, $2)', [faz.farm.id, 'x@exemplo.test']))).toMatch(/Só o dono/);
      // Alteração em linha que ele não pode mexer não passa (o banco simplesmente não acha a linha).
      await q("update public.paddocks set name = 'Mudado' where farm_id = $1", [faz.farm.id]);
      await q("update public.farms set name = 'Mudado' where id = $1", [faz.farm.id]);
      await q('update public.lots set deleted_at = now() where id = $1', [lote.id]);
    });
    await as(db, lucas, async () => {
      expect((await q("select count(*)::int as n from public.paddocks where name = 'Mudado'")).rows[0].n).toBe(0);
      expect((await q('select name from public.farms')).rows[0].name).toBe('Fazenda A');
      expect((await q('select deleted_at from public.lots where id = $1', [lote.id])).rows[0].deleted_at).toBeNull();
    });
  });

  it('desfaz só o que ele mesmo gravou', async () => {
    const doConsultor = { ...base(), date: '2026-11-13', type: 'pesagem' as const, weightKg: 320 };
    await as(db, lucas, () => record([doConsultor]));
    await as(db, cliente, async () => {
      const mine = (await q("select id from public.lot_events where author = $1 and type = 'pesagem'", [cliente])).rows[0].id;
      await q('update public.lot_events set deleted_at = now() where id = $1', [mine]);
      await q('update public.lot_events set deleted_at = now() where id = $1', [doConsultor.id]);
    });
    await as(db, lucas, async () => {
      const rows = (await q("select author, deleted_at from public.lot_events where type = 'pesagem' order by event_date")).rows;
      expect(rows.map((r) => [r.author === cliente, r.deleted_at !== null])).toEqual([
        [true, true],
        [false, false],
      ]);
    });
  });

  it('o dono troca para acesso completo e o convite leva o papel escolhido', async () => {
    await as(db, cliente, async () => expect(await errorOf(() => q('select public.set_farm_member_role($1, $2, $3)', [faz.farm.id, cliente, 'member']))).toMatch(/Só o dono/));
    await as(db, lucas, async () => {
      expect(await errorOf(() => q('select public.set_farm_member_role($1, $2, $3)', [faz.farm.id, lucas, 'viewer']))).toMatch(/próprio acesso/);
      expect(await errorOf(() => q('select public.set_farm_member_role($1, $2, $3)', [faz.farm.id, cliente, 'dono']))).toMatch(/inválido/);
      await q('select public.set_farm_member_role($1, $2, $3)', [faz.farm.id, cliente, 'member']);
    });
    await as(db, cliente, async () => {
      expect(await role()).toBe('member');
      expect((await record([{ ...base(), type: 'animais_saida', heads: 5 }])).length).toBe(1);
    });

    const colega = uuid();
    await as(db, lucas, async () => {
      expect((await q('select public.add_farm_member($1, $2, $3) as r', [faz.farm.id, 'colega@exemplo.test', 'member'])).rows[0].r).toBe('invited');
      expect((await q('select email, role from public.list_farm_invites($1)', [faz.farm.id])).rows).toEqual([{ email: 'colega@exemplo.test', role: 'member' }]);
    });
    await addUser(db, colega, 'colega@exemplo.test', { admin: false });
    await as(db, colega, async () => {
      expect((await q('select public.claim_farm_invites() as n')).rows[0].n).toBe(1);
      expect(await role()).toBe('member');
    });
  });
});
