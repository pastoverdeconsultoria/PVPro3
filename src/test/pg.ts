import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Postgres de verdade rodando dentro do teste (PGlite). O que o Supabase já traz
// pronto é imitado aqui: os papéis `anon` e `authenticated`, o esquema `auth` e a
// permissão ampla que ele dá por padrão a esses papéis. Assim as migrações são
// testadas como vão rodar no projeto real, inclusive os `revoke`.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create role supabase_auth_admin nologin;

  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Banco novo, com todas as migrações aplicadas na ordem. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of migrationFiles()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

/**
 * Cria a conta. Por padrão ela é administradora, porque só administrador abre
 * fazenda; `admin: false` faz um cliente comum.
 */
export async function addUser(db: PGlite, id: string, email: string | null = null, opts: { admin?: boolean; confirmed?: boolean } = {}): Promise<void> {
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [id, email, opts.confirmed === false ? null : new Date().toISOString()]);
  if (opts.admin !== false) await db.query('insert into public.app_admins (user_id) values ($1)', [id]);
}

/** Roda `fn` como um usuário logado (`userId`) ou como anônimo (`null`). */
export async function as<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Mensagem do erro que `fn` deu, ou null se passou. */
export async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
