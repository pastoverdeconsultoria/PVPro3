// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, errorOf, freshDb } from '../test/pg';
import { newFarmToArgs } from './rows';
import type { NewFarm } from './types';

// Cadastro só com convite e fazenda nova só pelo administrador.

// biome-ignore lint: linhas do banco chegam sem tipo
type R = Record<string, any>;
const uuid = () => crypto.randomUUID();
function newFarm(name: string): NewFarm {
  const farmId = uuid();
  return {
    farm: { id: farmId, name, municipality: null, centroid: null },
    paddocks: [
      {
        id: uuid(),
        farmId,
        name: 'P01',
        folder: null,
        geom: { type: 'Polygon', coordinates: [[[-40, -15], [-39.99, -15], [-39.99, -14.99], [-40, -14.99], [-40, -15]]] },
        areaHa: 50,
        species: null,
        isGrazing: true,
        initialLastExit: null,
        sort: 0,
      },
    ],
    waterPoints: [],
  };
}

let db: PGlite;
const lucas = uuid();
const cliente = uuid();
let fazA: NewFarm;
let fazB: NewFarm;

const createFarm = (input: NewFarm) => {
  const a = newFarmToArgs(input);
  return db.query('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(a.p_farm), JSON.stringify(a.p_paddocks), JSON.stringify(a.p_water_points)]);
};
const add = async (farm: NewFarm, email: string) => (await db.query<R>('select public.add_farm_member($1, $2) as r', [farm.farm.id, email])).rows[0].r as string;
const invites = async (farm: NewFarm) => (await db.query<R>('select email from public.list_farm_invites($1)', [farm.farm.id])).rows.map((r) => r.email);
const claim = async () => Number((await db.query<R>('select public.claim_farm_invites() as n')).rows[0].n);
const farmNames = async () => (await db.query<R>('select name from public.farms order by name')).rows.map((r) => r.name);
/** O que o Supabase faria ao tentar criar a conta: chama o hook como `supabase_auth_admin`. */
async function hook(email: string): Promise<R> {
  await db.exec('set role supabase_auth_admin');
  try {
    return (await db.query<R>('select public.hook_before_user_created($1::jsonb) as r', [JSON.stringify({ metadata: { name: 'before-user-created' }, user: { email } })])).rows[0].r;
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = await freshDb();
  await addUser(db, lucas, 'lucas@exemplo.test');
  fazA = newFarm('Fazenda A');
  fazB = newFarm('Fazenda B');
  await as(db, lucas, async () => {
    await createFarm(fazA);
    await createFarm(fazB);
  });
}, 60_000);

describe('cadastro só com convite', () => {
  it('sem convite o Supabase não cria a conta', async () => {
    const r = await hook('estranho@exemplo.test');
    expect(r.error.http_code).toBe(403);
    expect(r.error.message).toMatch(/não tem convite/);
  });

  it('o dono convida; o e-mail convidado passa no cadastro e só enxerga a fazenda dele', async () => {
    await as(db, lucas, async () => {
      expect(await add(fazA, '  Cliente@Exemplo.TEST ')).toBe('invited');
      // Convidar de novo não duplica.
      expect(await add(fazA, 'cliente@exemplo.test')).toBe('invited');
      expect(await invites(fazA)).toEqual(['cliente@exemplo.test']);
    });
    expect(await hook('CLIENTE@exemplo.test')).toEqual({});

    // A conta nasce; ao entrar, o app chama claim.
    await addUser(db, cliente, 'cliente@exemplo.test', { admin: false });
    await as(db, cliente, async () => {
      expect(await farmNames()).toEqual([]);
      expect(await claim()).toBe(1);
      expect(await farmNames()).toEqual(['Fazenda A']);
      // Chamar de novo não faz nada.
      expect(await claim()).toBe(0);
    });
    await as(db, lucas, async () => {
      expect(await invites(fazA)).toEqual([]);
      expect(await farmNames()).toEqual(['Fazenda A', 'Fazenda B']);
    });
    // Convite usado não serve para criar outra conta com o mesmo e-mail.
    expect((await hook('cliente@exemplo.test')).error.http_code).toBe(403);
  });

  it('conta que já existe ganha acesso na hora, sem convite', async () => {
    await as(db, lucas, async () => expect(await add(fazB, 'cliente@exemplo.test')).toBe('member'));
    await as(db, cliente, async () => expect(await farmNames()).toEqual(['Fazenda A', 'Fazenda B']));
  });

  it('convite cancelado não passa no cadastro', async () => {
    await as(db, lucas, () => add(fazA, 'desistiu@exemplo.test'));
    expect(await hook('desistiu@exemplo.test')).toEqual({});
    const id = (await db.query<R>("select id from public.farm_invites where email = 'desistiu@exemplo.test'")).rows[0].id;
    await as(db, cliente, async () => expect(await errorOf(() => db.query('select public.cancel_farm_invite($1)', [id]))).toMatch(/Só o dono/));
    await as(db, lucas, () => db.query('select public.cancel_farm_invite($1)', [id]));
    expect((await hook('desistiu@exemplo.test')).error.http_code).toBe(403);
  });

  it('e-mail não confirmado não pega o convite', async () => {
    const semConfirmar = uuid();
    await as(db, lucas, () => add(fazA, 'pendente@exemplo.test'));
    await addUser(db, semConfirmar, 'pendente@exemplo.test', { admin: false, confirmed: false });
    await as(db, semConfirmar, async () => {
      expect(await claim()).toBe(0);
      expect(await farmNames()).toEqual([]);
    });
  });
});

describe('administrador', () => {
  it('cliente não abre fazenda nova, não convida e não vê convites', async () => {
    await as(db, cliente, async () => {
      expect(await errorOf(() => createFarm(newFarm('Fazenda do Cliente')))).toMatch(/Só o administrador/);
      expect(await errorOf(() => add(fazA, 'outro@exemplo.test'))).toMatch(/Só o dono/);
      expect(await invites(fazA)).toEqual([]);
      expect((await db.query<R>('select public.is_app_admin() as a')).rows[0].a).toBe(false);
    });
    await as(db, lucas, async () => expect((await db.query<R>('select public.is_app_admin() as a')).rows[0].a).toBe(true));
  });

  it('ninguém de fora lê convites, administradores nem chama o hook', async () => {
    await as(db, cliente, async () => {
      expect(await errorOf(() => db.query('select * from public.farm_invites'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('select * from public.app_admins'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('insert into public.app_admins (user_id) values ($1)', [cliente]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query(`select public.hook_before_user_created('{}'::jsonb)`))).toMatch(/permission denied/);
    });
    await as(db, null, async () => {
      expect(await errorOf(() => db.query('select public.claim_farm_invites()'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query('select public.is_app_admin()'))).toMatch(/permission denied/);
    });
  });

  it('quem já era dono quando a migração rodou vira administrador', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { PGlite } = await import('@electric-sql/pglite');
    // Banco com as migrações antigas, uma fazenda aberta, e depois a migração nova.
    const old = new PGlite();
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const stub = readFileSync(join(process.cwd(), 'src', 'test', 'pg.ts'), 'utf8').match(/const SUPABASE_STUB = `([\s\S]*?)`;/)![1];
    await old.exec(stub);
    for (const f of files.filter((f) => f < '20261118')) await old.exec(readFileSync(join(dir, f), 'utf8'));
    const dono = uuid();
    await old.query('insert into auth.users (id, email) values ($1, $2)', [dono, 'dono@exemplo.test']);
    await old.query("select set_config('request.jwt.claim.sub', $1, false)", [dono]);
    const a = newFarmToArgs(newFarm('Antiga'));
    await old.exec('set role authenticated');
    await old.query('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(a.p_farm), JSON.stringify(a.p_paddocks), JSON.stringify(a.p_water_points)]);
    await old.exec('reset role');
    for (const f of files.filter((f) => f >= '20261118')) await old.exec(readFileSync(join(dir, f), 'utf8'));
    expect((await old.query<R>('select user_id from public.app_admins')).rows).toEqual([{ user_id: dono }]);
    await old.close();
  }, 60_000);
});
