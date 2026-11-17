-- SQL pendente: rode este arquivo inteiro uma vez no SQL Editor do Supabase.
-- Contém: supabase/migrations/20261118120000_convites.sql
-- (O caderno, a adubação e os membros já foram aplicados em 17 nov 2026.)

-- Cadastro só com convite e fazenda nova só pelo administrador.
--
-- - Administrador do sistema (tabela `app_admins`): só ele abre fazenda nova.
--   Quem já era dono de fazenda quando esta migração rodou vira administrador.
-- - Convite (tabela `farm_invites`): o dono da fazenda informa o e-mail do
--   cliente. Se a conta já existe, o acesso é dado na hora; se não existe, fica
--   um convite aberto.
-- - Trava de cadastro (`hook_before_user_created`): o Supabase só cria conta
--   para e-mail com convite aberto. Precisa ser ligada no painel do Supabase em
--   Authentication → Hooks → "Before User Created" (Postgres, esta função).
-- - Ao entrar, o app chama `claim_farm_invites`, que transforma os convites do
--   e-mail da conta em acesso à fazenda.

-- ---------------------------------------------------------------------------
-- Administrador
-- ---------------------------------------------------------------------------

create table public.app_admins (
  user_id uuid primary key references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

insert into public.app_admins (user_id)
select distinct m.user_id
from public.farm_members m
where m.role = 'owner' and m.removed_at is null
on conflict do nothing;

create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- Fazenda só nasce pela mão do administrador, venha de onde vier a gravação.
create function public.farms_only_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Só o administrador do sistema abre fazenda nova.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger farms_only_admin
before insert on public.farms
for each row execute function public.farms_only_admin();

revoke all on function public.farms_only_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------

create table public.farm_invites (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

-- Um convite aberto por e-mail em cada fazenda.
create unique index farm_invites_open on public.farm_invites (farm_id, email)
  where accepted_at is null and revoked_at is null;
create index farm_invites_email on public.farm_invites (email)
  where accepted_at is null and revoked_at is null;

-- Ninguém lê nem grava direto: só pelas funções abaixo.
alter table public.farm_invites enable row level security;
revoke all on public.farm_invites from anon, authenticated;

-- Dá acesso pelo e-mail. Conta que já existe entra na hora ('member'); e-mail
-- sem conta fica convidado ('invited') e passa no cadastro. Só o dono.
drop function public.add_farm_member(uuid, text);

create function public.add_farm_member(p_farm uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  if not public.is_farm_owner(p_farm) then
    raise exception 'Só o dono da fazenda dá acesso a outra conta.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email limit 1;
  if v_user is not null then
    insert into public.farm_members (farm_id, user_id, role) values (p_farm, v_user, 'member')
    on conflict (farm_id, user_id) do update set removed_at = null;
    return 'member';
  end if;
  insert into public.farm_invites (farm_id, email, invited_by) values (p_farm, v_email, auth.uid())
  on conflict (farm_id, email) where accepted_at is null and revoked_at is null do nothing;
  return 'invited';
end;
$$;

-- Convites ainda não usados da fazenda. Só o dono vê.
create function public.list_farm_invites(p_farm uuid)
returns table (id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.email, i.created_at
  from public.farm_invites i
  where i.farm_id = p_farm and i.accepted_at is null and i.revoked_at is null
    and public.is_farm_owner(p_farm)
  order by i.created_at, i.id;
$$;

-- Cancela um convite que ainda não foi usado. Só o dono.
create function public.cancel_farm_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm uuid;
begin
  select i.farm_id into v_farm from public.farm_invites i where i.id = p_invite;
  if v_farm is null or not public.is_farm_owner(v_farm) then
    raise exception 'Só o dono da fazenda cancela convite.' using errcode = '42501';
  end if;
  update public.farm_invites set revoked_at = now()
  where id = p_invite and accepted_at is null and revoked_at is null;
end;
$$;

-- Transforma os convites do e-mail da conta logada em acesso. Só vale para
-- e-mail confirmado. Devolve quantas fazendas foram liberadas agora.
create function public.claim_farm_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_n integer;
begin
  if v_uid is null then
    return 0;
  end if;
  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  with opened as (
    update public.farm_invites i set accepted_at = now()
    where i.email = v_email and i.accepted_at is null and i.revoked_at is null
    returning i.farm_id
  )
  insert into public.farm_members (farm_id, user_id, role)
  select distinct o.farm_id, v_uid, 'member' from opened o
  on conflict (farm_id, user_id) do update set removed_at = null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.add_farm_member(uuid, text) from public, anon;
revoke all on function public.list_farm_invites(uuid) from public, anon;
revoke all on function public.cancel_farm_invite(uuid) from public, anon;
revoke all on function public.claim_farm_invites() from public, anon;

grant execute on function public.add_farm_member(uuid, text) to authenticated;
grant execute on function public.list_farm_invites(uuid) to authenticated;
grant execute on function public.cancel_farm_invite(uuid) to authenticated;
grant execute on function public.claim_farm_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Trava de cadastro (Auth Hook "Before User Created")
-- ---------------------------------------------------------------------------

-- O Supabase chama esta função antes de criar qualquer conta. Sem convite
-- aberto para o e-mail, a conta não é criada e a pessoa vê a mensagem.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if v_email is not null and exists (
    select 1 from public.farm_invites i
    where i.email = v_email and i.accepted_at is null and i.revoked_at is null
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Este e-mail não tem convite. Peça ao consultor para liberar o seu acesso.'
  ));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

grant select on public.farm_invites to supabase_auth_admin;
create policy farm_invites_hook on public.farm_invites
  for select to supabase_auth_admin using (true);
