// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, errorOf, freshDb } from '../test/pg';
import { COLS, fertilizationToRow, newFarmToArgs, rowToFertilization, rowToMember } from './rows';
import type { NewFarm } from './types';

// Adubação e membros da fazenda (etapa 4), provados num Postgres de verdade.

// biome-ignore lint: linhas do banco chegam sem tipo
type R = Record<string, any>;
const uuid = () => crypto.randomUUID();
const square = (lng: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lng, -15], [lng + 0.01, -15], [lng + 0.01, -14.99], [lng, -14.99], [lng, -15]] as [number, number][]],
});
function newFarm(name: string, paddockNames: string[]): NewFarm {
  const farmId = uuid();
  return {
    farm: { id: farmId, name, municipality: null, centroid: null },
    paddocks: paddockNames.map((n, i) => ({ id: uuid(), farmId, name: n, folder: null, geom: square(-40 + i * 0.02), areaHa: 50, species: null, isGrazing: true, initialLastExit: null, sort: i })),
    waterPoints: [],
  };
}

let db: PGlite;
const ana = uuid();
const bruno = uuid();
const carla = uuid();
let faz: NewFarm;
let outra: NewFarm;

const createFarm = (input: NewFarm) => {
  const a = newFarmToArgs(input);
  return db.query('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(a.p_farm), JSON.stringify(a.p_paddocks), JSON.stringify(a.p_water_points)]);
};
const members = async () => (await db.query<R>('select * from public.list_farm_members($1)', [faz.farm.id])).rows.map(rowToMember);
const count = async (table: string) => Number((await db.query<R>(`select count(*) as n from public.${table}`)).rows[0].n);
const add = (email: string) => db.query('select public.add_farm_member($1, $2)', [faz.farm.id, email]);
const remove = (user: string) => db.query('select public.remove_farm_member($1, $2)', [faz.farm.id, user]);

beforeAll(async () => {
  db = await freshDb();
  await addUser(db, ana, 'ana@exemplo.test');
  await addUser(db, bruno, 'Bruno@Exemplo.test');
  await addUser(db, carla, 'carla@exemplo.test');
  faz = newFarm('Fazenda da Ana', ['P01', 'P02']);
  outra = newFarm('Fazenda da Carla', ['Q01']);
  await as(db, ana, () => createFarm(faz));
  await as(db, carla, () => createFarm(outra));
}, 60_000);

describe('membros da fazenda', () => {
  it('o dono vê quem tem acesso e dá acesso a outra conta pelo e-mail', async () => {
    await as(db, bruno, async () => expect(await count('paddocks')).toBe(0));
    await as(db, ana, async () => {
      expect(await members()).toMatchObject([{ userId: ana, email: 'ana@exemplo.test', role: 'owner' }]);
      // Maiúscula, minúscula e espaço em volta não atrapalham.
      await add('  bruno@exemplo.TEST ');
      expect((await members()).map((m) => [m.email, m.role])).toEqual([
        ['ana@exemplo.test', 'owner'],
        ['Bruno@Exemplo.test', 'member'],
      ]);
      await add('bruno@exemplo.test');
      expect(await members()).toHaveLength(2);
    });
    await as(db, bruno, async () => {
      expect(await count('paddocks')).toBe(2);
      expect((await db.query<R>('select name from public.farms')).rows).toEqual([{ name: 'Fazenda da Ana' }]);
    });
  });

  it('e-mail sem conta vira convite; e-mail torto dá erro claro', async () => {
    const r = await as(db, ana, () => add('ninguem@exemplo.test'));
    expect((r.rows[0] as R).add_farm_member).toBe('invited');
    expect(await as(db, ana, () => errorOf(() => add('sem-arroba')))).toMatch(/E-mail inválido/);
  });

  it('quem não é dono não dá nem tira acesso; de fora não lista ninguém', async () => {
    await as(db, bruno, async () => {
      expect(await errorOf(() => add('carla@exemplo.test'))).toMatch(/Só o dono/);
      expect(await errorOf(() => remove(ana))).toMatch(/Só o dono/);
      // Membro comum consegue ver quem tem acesso.
      expect(await members()).toHaveLength(2);
    });
    await as(db, carla, async () => {
      expect(await members()).toEqual([]);
      expect(await errorOf(() => add('carla@exemplo.test'))).toMatch(/Só o dono/);
    });
    await as(db, null, async () => {
      expect(await errorOf(() => members())).toMatch(/permission denied/);
      expect(await errorOf(() => add('carla@exemplo.test'))).toMatch(/permission denied/);
    });
  });

  it('o dono tira o acesso: a pessoa para de enxergar na hora, e pode voltar depois', async () => {
    await as(db, ana, async () => {
      expect(await errorOf(() => remove(ana))).toMatch(/não pode tirar o próprio acesso/);
      await remove(bruno);
      expect(await members()).toHaveLength(1);
    });
    await as(db, bruno, async () => {
      expect(await count('farms')).toBe(0);
      expect(await count('paddocks')).toBe(0);
      expect(await errorOf(() => db.query('insert into public.lots (id, farm_id, name) values ($1, $2, $3)', [uuid(), faz.farm.id, 'x']))).toMatch(/row-level security/);
    });
    // Nada foi apagado de verdade: a linha continua, marcada.
    expect(Number((await db.query<R>('select count(*) as n from public.farm_members where farm_id = $1', [faz.farm.id])).rows[0].n)).toBe(2);
    await as(db, ana, () => add('bruno@exemplo.test'));
    await as(db, bruno, async () => expect(await count('paddocks')).toBe(2));
  });
});

describe('adubação', () => {
  it('membro registra, o autor é do servidor, e apagar é suave', async () => {
    const fert = { id: uuid(), paddockId: faz.paddocks[0].id, date: '2026-11-03', nKgHa: 40, note: 'ureia' };
    await as(db, bruno, async () => {
      const row = fertilizationToRow(faz.farm.id, fert);
      const cols = Object.keys(row);
      await db.query(`insert into public.fertilizations (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
      const saved = (await db.query<R>(`select ${COLS.fertilizations} from public.fertilizations`)).rows.map(rowToFertilization);
      expect(saved).toEqual([fert]);
      expect((await db.query<R>('select author from public.fertilizations')).rows).toEqual([{ author: bruno }]);

      expect(await errorOf(() => db.query('delete from public.fertilizations'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('update public.fertilizations set n_kg_ha = 1'))).toMatch(/permission denied/);
      await db.query('update public.fertilizations set deleted_at = now() where id = $1', [fert.id]);
      expect(await count('fertilizations')).toBe(1);
    });
  });

  it('recusa dose absurda e piquete de outra fazenda; quem é de fora não vê nada', async () => {
    const insert = (paddockId: string, n: number) =>
      db.query('insert into public.fertilizations (id, farm_id, paddock_id, applied_on, n_kg_ha) values ($1, $2, $3, $4, $5)', [uuid(), faz.farm.id, paddockId, '2026-11-03', n]);
    await as(db, ana, async () => {
      expect(await errorOf(() => insert(faz.paddocks[0].id, 0))).toMatch(/check constraint/);
      expect(await errorOf(() => insert(faz.paddocks[0].id, 900))).toMatch(/check constraint/);
      expect(await errorOf(() => insert(outra.paddocks[0].id, 40))).toMatch(/foreign key/);
    });
    await as(db, carla, async () => {
      expect(await count('fertilizations')).toBe(0);
      expect(await errorOf(() => insert(faz.paddocks[0].id, 40))).toMatch(/row-level security/);
    });
    await as(db, null, async () => expect(await errorOf(() => count('fertilizations'))).toMatch(/permission denied/));
  });
});
