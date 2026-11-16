// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, errorOf, freshDb } from '../test/pg';
import {
  COLS,
  eventToPayload,
  lotToPayload,
  moduleToArgs,
  newFarmToArgs,
  paddockPatchToRow,
  rowToComposition,
  rowToEvent,
  rowToFarm,
  rowToLot,
  rowToModule,
  rowToPaddock,
  rowToWaterPoint,
} from './rows';
import type { Lot, Module, NewFarm } from './types';
import type { LotEvent } from '../lib/lots/types';

// Testa as migrações de verdade num Postgres dentro do teste, com os mesmos
// formatos de dado que o app manda (funções de `rows.ts`).

// biome-ignore lint: linhas do banco chegam sem tipo
type R = Record<string, any>;
const TABLES = ['farms', 'farm_members', 'paddocks', 'water_points', 'lots', 'modules', 'module_compositions', 'lot_events'];
const uuid = () => crypto.randomUUID();
const square = (lng: number, lat: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [lng, lat],
      [lng + 0.01, lat],
      [lng + 0.01, lat + 0.01],
      [lng, lat + 0.01],
      [lng, lat],
    ] as [number, number][],
  ],
});

function newFarm(name: string, paddockNames: string[]): NewFarm {
  const farmId = uuid();
  return {
    farm: { id: farmId, name, municipality: 'Itapetinga, BA', centroid: { lat: -15.25, lon: -40.25 } },
    paddocks: paddockNames.map((n, i) => ({
      id: uuid(),
      farmId,
      name: n,
      folder: i === 0 ? 'Bloco A' : null,
      geom: square(-40.25 + i * 0.02, -15.25),
      areaHa: 118.1234 + i,
      species: 'Marandu',
      isGrazing: n !== 'Reserva',
      initialLastExit: null,
      sort: i,
    })),
    waterPoints: [{ id: uuid(), farmId, name: 'Bebedouro 1', lat: -15.25, lon: -40.25 }],
  };
}

let db: PGlite;
const ana = uuid();
const bruno = uuid();
let fazAna: NewFarm;
let loteAna: Lot;

const createFarm = (input: NewFarm) => {
  const a = newFarmToArgs(input);
  return db.query<R>('select public.create_farm($1::jsonb, $2::jsonb, $3::jsonb) as id', [
    JSON.stringify(a.p_farm),
    JSON.stringify(a.p_paddocks),
    JSON.stringify(a.p_water_points),
  ]);
};
const record = async (farmId: string, events: LotEvent[]) =>
  (
    await db.query<R>(`select ${COLS.lot_events} from public.record_lot_events($1::jsonb)`, [
      JSON.stringify(events.map((e) => eventToPayload(farmId, e))),
    ])
  ).rows.map(rowToEvent);
const createLot = async (lot: Lot, events: LotEvent[]) =>
  (
    await db.query<R>(`select ${COLS.lot_events} from public.create_lot($1::jsonb, $2::jsonb)`, [
      JSON.stringify(lotToPayload(lot)),
      JSON.stringify(events.map((e) => eventToPayload(lot.farmId, e))),
    ])
  ).rows.map(rowToEvent);
const saveModule = (m: Module, composition?: { validFrom: string; paddockIds: string[] }) => {
  const a = moduleToArgs(m, composition);
  return db.query<R>('select public.save_module($1::jsonb, $2::date, $3::jsonb)', [
    JSON.stringify(a.p_module),
    a.p_valid_from,
    a.p_paddocks ? JSON.stringify(a.p_paddocks) : null,
  ]);
};
const count = async (table: string) => Number((await db.query<R>(`select count(*) as n from public.${table}`)).rows[0].n);

beforeAll(async () => {
  db = await freshDb();
  await addUser(db, ana);
  await addUser(db, bruno);
  fazAna = newFarm('Fazenda da Ana', ['P01', 'P02', 'Reserva']);
  loteAna = { id: uuid(), farmId: fazAna.farm.id, name: 'Lote 1', deletedAt: null };
  await as(db, ana, async () => {
    await createFarm(fazAna);
    await createLot(loteAna, [
      { id: uuid(), lotId: loteAna.id, date: '2026-10-01', type: 'inicio', heads: 100, weightKg: 300, category: 'Recria' },
    ]);
  });
}, 60_000);

describe('abertura de fazenda', () => {
  it('quem abre vira dono e enxerga fazenda, piquetes e bebedouros', async () => {
    await as(db, ana, async () => {
      const farms = (await db.query<R>(`select ${COLS.farms} from public.farms`)).rows.map(rowToFarm);
      expect(farms).toEqual([fazAna.farm]);

      const paddocks = (await db.query<R>(`select ${COLS.paddocks} from public.paddocks order by sort`)).rows.map(rowToPaddock);
      expect(paddocks.map((p) => p.name)).toEqual(['P01', 'P02', 'Reserva']);
      expect(paddocks[0]).toEqual({ ...fazAna.paddocks[0], areaHa: 118.1234 });
      expect(paddocks[2].isGrazing).toBe(false);

      const water = (await db.query<R>(`select ${COLS.water_points} from public.water_points`)).rows.map(rowToWaterPoint);
      expect(water).toEqual(fazAna.waterPoints);

      const members = (await db.query<R>('select user_id, role from public.farm_members')).rows;
      expect(members).toEqual([{ user_id: ana, role: 'owner' }]);
    });
  });

  it('reenviar a mesma abertura não duplica nada', async () => {
    await as(db, ana, async () => {
      await createFarm(fazAna);
      expect(await count('farms')).toBe(1);
      expect(await count('paddocks')).toBe(3);
      expect(await count('water_points')).toBe(1);
    });
  });

  it('recusa fazenda sem piquete', async () => {
    const vazia = newFarm('Vazia', []);
    const err = await as(db, ana, () => errorOf(() => createFarm(vazia)));
    expect(err).toMatch(/pelo menos um piquete/);
  });
});

describe('usuário sem vínculo', () => {
  it('não enxerga nenhuma linha de nenhuma tabela', async () => {
    await as(db, bruno, async () => {
      for (const t of TABLES) expect(await count(t), t).toBe(0);
    });
  });

  it('não entra na fazenda de outro reaproveitando o id dela', async () => {
    const roubo = { ...newFarm('Roubo', ['X']), farm: { ...fazAna.farm, name: 'Roubo' } };
    const err = await as(db, bruno, () => errorOf(() => createFarm(roubo)));
    expect(err).toMatch(/já está em uso/);
    await as(db, bruno, async () => expect(await count('farm_members')).toBe(0));
    await as(db, ana, async () => {
      expect((await db.query<R>('select name from public.farms')).rows).toEqual([{ name: 'Fazenda da Ana' }]);
      expect(await count('paddocks')).toBe(3);
    });
  });

  it('não grava lote, registro nem módulo na fazenda de outro', async () => {
    const lote: Lot = { id: uuid(), farmId: fazAna.farm.id, name: 'Invasor', deletedAt: null };
    const inicio: LotEvent = { id: uuid(), lotId: lote.id, date: '2026-10-05', type: 'inicio', heads: 10, weightKg: 200, category: 'Recria' };
    await as(db, bruno, async () => {
      expect(await errorOf(() => createLot(lote, [inicio]))).toMatch(/row-level security/);
      const pesagem: LotEvent = { id: uuid(), lotId: loteAna.id, date: '2026-10-05', type: 'pesagem', weightKg: 1 };
      expect(await errorOf(() => record(fazAna.farm.id, [pesagem]))).toMatch(/row-level security/);
      const modulo: Module = { id: uuid(), farmId: fazAna.farm.id, name: 'M', color: '#fff', occupationDays: 3, plannedLotId: null, condition: 'extensiva', mRef: 40 };
      expect(await errorOf(() => saveModule(modulo, { validFrom: '2026-10-01', paddockIds: [fazAna.paddocks[0].id] }))).toMatch(/row-level security/);
    });
    await as(db, ana, async () => {
      expect(await count('lots')).toBe(1);
      expect(await count('modules')).toBe(0);
    });
  });

  it('não altera piquete de outro (a alteração não acha linha nenhuma)', async () => {
    await as(db, bruno, async () => {
      const r = await db.query<R>('update public.paddocks set name = $1 where id = $2', ['Tomado', fazAna.paddocks[0].id]);
      expect(r.affectedRows).toBe(0);
    });
    await as(db, ana, async () => {
      expect((await db.query<R>('select name from public.paddocks where id = $1', [fazAna.paddocks[0].id])).rows[0].name).toBe('P01');
    });
  });
});

describe('anônimo', () => {
  it('não lê tabela nenhuma', async () => {
    await as(db, null, async () => {
      for (const t of TABLES) expect(await errorOf(() => count(t)), t).toMatch(/permission denied/);
    });
  });

  it('não executa função nenhuma', async () => {
    await as(db, null, async () => {
      expect(await errorOf(() => createFarm(newFarm('Anon', ['X'])))).toMatch(/permission denied/);
      expect(await errorOf(() => record(fazAna.farm.id, []))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>('select public.is_farm_member($1)', [fazAna.farm.id]))).toMatch(/permission denied/);
    });
  });
});

describe('nada é apagado de verdade', () => {
  it('nem o dono tem DELETE', async () => {
    await as(db, ana, async () => {
      for (const t of TABLES) expect(await errorOf(() => db.query<R>(`delete from public.${t}`)), t).toMatch(/permission denied/);
    });
  });

  it('o dono apaga de forma suave e desfaz', async () => {
    await as(db, ana, async () => {
      await db.query<R>('update public.lots set deleted_at = now() where id = $1', [loteAna.id]);
      let lot = (await db.query<R>(`select ${COLS.lots} from public.lots`)).rows.map(rowToLot)[0];
      expect(lot.deletedAt).not.toBeNull();
      await db.query<R>('update public.lots set deleted_at = null where id = $1', [loteAna.id]);
      lot = (await db.query<R>(`select ${COLS.lots} from public.lots`)).rows.map(rowToLot)[0];
      expect(lot).toEqual(loteAna);
    });
  });

  it('o app só altera as colunas liberadas', async () => {
    await as(db, ana, async () => {
      const patch = paddockPatchToRow({ name: 'P01 novo', species: 'Mombaça', isGrazing: false, initialLastExit: '2026-09-20' });
      const cols = Object.keys(patch);
      await db.query<R>(
        `update public.paddocks set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`,
        [fazAna.paddocks[1].id, ...cols.map((c) => patch[c])],
      );
      const p = (await db.query<R>(`select ${COLS.paddocks} from public.paddocks where id = $1`, [fazAna.paddocks[1].id])).rows.map(rowToPaddock)[0];
      expect(p).toMatchObject({ name: 'P01 novo', species: 'Mombaça', isGrazing: false, initialLastExit: '2026-09-20' });

      expect(await errorOf(() => db.query<R>('update public.paddocks set area_ha = 1'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>('update public.paddocks set farm_id = $1', [uuid()]))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>('update public.lot_events set seq = 1'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>('update public.lot_events set heads = 1'))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>("update public.farms set share_token = 'x'"))).toMatch(/permission denied/);
      expect(await errorOf(() => db.query<R>('insert into public.farm_members (farm_id, user_id) values ($1, $2)', [fazAna.farm.id, bruno]))).toMatch(/permission denied/);
    });
  });
});

describe('histórico do lote', () => {
  it('cria o lote com o registro de formação, com seq e autor do servidor', async () => {
    await as(db, ana, async () => {
      const rows = (await db.query<R>('select seq, author, type from public.lot_events where lot_id = $1', [loteAna.id])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'inicio', author: ana });
      expect(Number(rows[0].seq)).toBeGreaterThan(0);
    });
  });

  it('formação inválida não deixa lote órfão para trás', async () => {
    const lote: Lot = { id: uuid(), farmId: fazAna.farm.id, name: 'Zero', deletedAt: null };
    const inicio: LotEvent = { id: uuid(), lotId: lote.id, date: '2026-10-05', type: 'inicio', heads: 0, weightKg: 200, category: 'Recria' };
    await as(db, ana, async () => {
      expect(await errorOf(() => createLot(lote, [inicio]))).toMatch(/lot_events_inicio/);
      expect(await count('lots')).toBe(1);
    });
  });

  it('mudança de piquete grava saída antes da entrada, e o seq vindo do aparelho é ignorado', async () => {
    const [p1, p2] = fazAna.paddocks;
    await as(db, ana, async () => {
      const [entrada] = await record(fazAna.farm.id, [
        { id: uuid(), lotId: loteAna.id, date: '2026-10-02', type: 'piquete_entrada', paddockId: p1.id },
      ]);
      const link = uuid();
      const saved = await record(fazAna.farm.id, [
        { id: uuid(), lotId: loteAna.id, date: '2026-10-08', seq: 999_999, type: 'piquete_saida', paddockId: p1.id, link },
        { id: uuid(), lotId: loteAna.id, date: '2026-10-08', seq: 1, type: 'piquete_entrada', paddockId: p2.id, link },
      ]);
      expect(saved.map((e) => e.type)).toEqual(['piquete_saida', 'piquete_entrada']);
      expect(saved[0].seq!).toBeGreaterThan(entrada.seq!);
      expect(saved[1].seq!).toBeGreaterThan(saved[0].seq!);
      expect(saved[0].seq!).toBeLessThan(999_999);
      expect(saved[0].link).toBe(link);

      // Reenvio dos mesmos registros (fila offline): nada novo é gravado.
      const antes = await count('lot_events');
      expect(await record(fazAna.farm.id, saved)).toEqual([]);
      expect(await count('lot_events')).toBe(antes);
    });
  });

  it('lê de volta todos os tipos de registro como o app mandou', async () => {
    const base = { lotId: loteAna.id, date: '2026-10-10' };
    const sent: LotEvent[] = [
      { ...base, id: uuid(), type: 'animais_entrada', heads: 20, weightKg: 250.5, reason: 'compra' },
      { ...base, id: uuid(), type: 'animais_saida', heads: 5, reason: 'venda' },
      { ...base, id: uuid(), type: 'pesagem', weightKg: 312.4, headsWeighed: 30 },
      { ...base, id: uuid(), type: 'categoria', category: 'Engorda' },
      { ...base, id: uuid(), type: 'suplemento', pctPv: 0.5, note: 'proteinado' },
    ];
    await as(db, ana, async () => {
      const saved = await record(fazAna.farm.id, sent);
      expect(saved.map(({ seq: _s, deletedAt: _d, link: _l, ...rest }) => rest)).toEqual(sent);
    });
  });

  it('recusa registro com piquete de outra fazenda', async () => {
    const outra = newFarm('Outra da Ana', ['Q01']);
    await as(db, ana, async () => {
      await createFarm(outra);
      const err = await errorOf(() =>
        record(fazAna.farm.id, [{ id: uuid(), lotId: loteAna.id, date: '2026-10-12', type: 'piquete_entrada', paddockId: outra.paddocks[0].id }]),
      );
      expect(err).toMatch(/foreign key/);
    });
  });

  it('apaga e desfaz a mudança inteira (saída e entrada ligadas) de uma vez', async () => {
    await as(db, ana, async () => {
      const ids = (await db.query<R>('select id from public.lot_events where link is not null')).rows.map((r) => r.id);
      expect(ids).toHaveLength(2);
      await db.query<R>('update public.lot_events set deleted_at = now() where id = any($1)', [ids]);
      const deleted = (await db.query<R>(`select ${COLS.lot_events} from public.lot_events where id = any($1)`, [ids])).rows.map(rowToEvent);
      expect(deleted.every((e) => e.deletedAt)).toBe(true);
      await db.query<R>('update public.lot_events set deleted_at = null where id = any($1)', [ids]);
      expect(await count('lot_events')).toBeGreaterThan(2);
    });
  });
});

describe('módulos', () => {
  const modulo: Module = {
    id: uuid(),
    farmId: '',
    name: 'Módulo A',
    color: '#5B8DEF',
    occupationDays: 5,
    plannedLotId: null,
    condition: 'extensiva',
    mRef: 40,
  };

  it('grava o módulo com a composição e guarda o histórico de versões', async () => {
    modulo.farmId = fazAna.farm.id;
    modulo.plannedLotId = loteAna.id;
    const [p1, p2] = fazAna.paddocks;
    await as(db, ana, async () => {
      await saveModule(modulo, { validFrom: '2026-10-01', paddockIds: [p1.id, p2.id] });
      // Mesma data: substitui a versão.
      await saveModule(modulo, { validFrom: '2026-10-01', paddockIds: [p2.id, p1.id] });
      // Data nova: versão nova, a antiga fica.
      await saveModule({ ...modulo, name: 'Módulo A1', occupationDays: 4 }, { validFrom: '2026-11-01', paddockIds: [p1.id] });

      const mods = (await db.query<R>(`select ${COLS.modules} from public.modules`)).rows.map(rowToModule);
      expect(mods).toEqual([{ ...modulo, name: 'Módulo A1', occupationDays: 4 }]);

      const comp = (
        await db.query<R>(`select ${COLS.module_compositions} from public.module_compositions where deleted_at is null order by valid_from, ord`)
      ).rows.map(rowToComposition);
      expect(comp.map((c) => [c.validFrom, c.ord, c.paddockId])).toEqual([
        ['2026-10-01', 0, p2.id],
        ['2026-10-01', 1, p1.id],
        ['2026-11-01', 0, p1.id],
      ]);
      expect(await count('module_compositions')).toBe(5);
    });
  });

  it('salvar só os dados do módulo não mexe na composição', async () => {
    await as(db, ana, async () => {
      const antes = await count('module_compositions');
      await saveModule({ ...modulo, condition: 'adubada', mRef: 105 });
      expect(await count('module_compositions')).toBe(antes);
      const m = (await db.query<R>(`select ${COLS.modules} from public.modules`)).rows.map(rowToModule)[0];
      expect(m).toMatchObject({ condition: 'adubada', mRef: 105 });
    });
  });

  it('recusa composição vazia e piquete de outra fazenda', async () => {
    await as(db, ana, async () => {
      expect(await errorOf(() => saveModule(modulo, { validFrom: '2026-12-01', paddockIds: [] }))).toMatch(/pelo menos um piquete/);
      const q01 = (await db.query<R>("select id from public.paddocks where name = 'Q01'")).rows[0].id as string;
      expect(await errorOf(() => saveModule(modulo, { validFrom: '2026-12-01', paddockIds: [q01] }))).toMatch(/foreign key/);
    });
  });

  it('apaga o módulo de forma suave', async () => {
    await as(db, ana, async () => {
      await db.query<R>('update public.modules set deleted_at = now() where id = $1', [modulo.id]);
      expect((await db.query<R>('select deleted_at from public.modules where id = $1', [modulo.id])).rows[0].deleted_at).not.toBeNull();
    });
  });
});

describe('o token do caderno', () => {
  it('existe, é único por fazenda e só membro lê', async () => {
    await as(db, ana, async () => {
      const tokens = (await db.query<R>('select share_token from public.farms')).rows.map((r) => r.share_token as string);
      expect(tokens).toHaveLength(2);
      expect(new Set(tokens).size).toBe(2);
      expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
    });
    await as(db, bruno, async () => {
      expect((await db.query<R>('select share_token from public.farms')).rows).toEqual([]);
    });
  });
});
