-- SQL pendente: rode este arquivo inteiro uma vez no SQL Editor do Supabase.
-- Contém, na ordem:
--   supabase/migrations/20261118120000_convites.sql  (convite e trava de cadastro)
--   supabase/migrations/20261119120000_leitura.sql   (acesso leitura + campo)
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


-- Papel "leitura + campo" ('viewer'), pensado para o cliente.
--
-- Quem tem esse papel vê tudo da fazenda e só grava o que é de campo:
--   * mudança de piquete (saída e entrada do lote),
--   * pesagem,
--   * chuva.
-- Pode desfazer (apagar de forma suave) os registros de campo que ele mesmo fez.
-- Não cria lote, não mexe em módulo, piquete, adubação, caderno da equipe nem
-- no nome da fazenda. Quem dá acesso escolhe o papel; o padrão é 'viewer'.
--
-- 'member' continua sendo "acesso completo"; 'owner' é o dono.

-- ---------------------------------------------------------------------------
-- Papel
-- ---------------------------------------------------------------------------

alter table public.farm_members drop constraint farm_members_role_check;
alter table public.farm_members add constraint farm_members_role_check
  check (role in ('owner', 'member', 'viewer'));

alter table public.farm_invites add column role text not null default 'viewer'
  check (role in ('member', 'viewer'));

-- Pode mexer em tudo da fazenda (dono ou acesso completo).
create function public.is_farm_editor(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm and m.user_id = auth.uid() and m.removed_at is null
      and m.role in ('owner', 'member')
  );
$$;

-- Papel da conta logada na fazenda, ou null sem vínculo.
create function public.my_farm_role(p_farm uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.farm_members m
  where m.farm_id = p_farm and m.user_id = auth.uid() and m.removed_at is null
  limit 1;
$$;

revoke all on function public.is_farm_editor(uuid) from public, anon;
revoke all on function public.my_farm_role(uuid) from public, anon;
grant execute on function public.is_farm_editor(uuid) to authenticated;
grant execute on function public.my_farm_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Regras de gravação: o que não é de campo passa a exigir acesso completo
-- ---------------------------------------------------------------------------

drop policy farms_update on public.farms;
create policy farms_update on public.farms
  for update to authenticated using (public.is_farm_editor(id)) with check (public.is_farm_editor(id));

do $$
declare t text;
begin
  foreach t in array array['paddocks', 'water_points', 'lots', 'modules', 'module_compositions', 'fertilizations'] loop
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_farm_editor(farm_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_farm_editor(farm_id)) with check (public.is_farm_editor(farm_id))', t || '_update', t);
  end loop;
end;
$$;

drop policy field_reports_update on public.field_reports;
create policy field_reports_update on public.field_reports
  for update to authenticated using (public.is_farm_editor(farm_id)) with check (public.is_farm_editor(farm_id));

-- Histórico do lote: o leitor grava só mudança de piquete e pesagem, e só
-- desfaz o que ele mesmo gravou desses tipos.
drop policy lot_events_insert on public.lot_events;
drop policy lot_events_update on public.lot_events;
create policy lot_events_insert on public.lot_events
  for insert to authenticated with check (
    public.is_farm_editor(farm_id)
    or (public.is_farm_member(farm_id) and type in ('piquete_entrada', 'piquete_saida', 'pesagem'))
  );
create policy lot_events_update on public.lot_events
  for update to authenticated
  using (
    public.is_farm_editor(farm_id)
    or (public.is_farm_member(farm_id) and author = auth.uid() and type in ('piquete_entrada', 'piquete_saida', 'pesagem'))
  )
  with check (
    public.is_farm_editor(farm_id)
    or (public.is_farm_member(farm_id) and author = auth.uid() and type in ('piquete_entrada', 'piquete_saida', 'pesagem'))
  );

-- Chuva continua aberta a todo membro (inclusive leitor): registrar e apagar.

-- Trocar o link do caderno da equipe exige acesso completo.
create or replace function public.rotate_share_token(p_farm uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_farm_editor(p_farm) then
    raise exception 'Sua conta não pode trocar o link do caderno.' using errcode = '42501';
  end if;
  update public.farms set share_token = v_token where id = p_farm;
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dar acesso com papel
-- ---------------------------------------------------------------------------

drop function public.add_farm_member(uuid, text);

create function public.add_farm_member(p_farm uuid, p_email text, p_role text default 'viewer')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(p_role, 'viewer');
  v_user uuid;
begin
  if not public.is_farm_owner(p_farm) then
    raise exception 'Só o dono da fazenda dá acesso a outra conta.' using errcode = '42501';
  end if;
  if v_role not in ('member', 'viewer') then
    raise exception 'Tipo de acesso inválido.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email limit 1;
  if v_user is not null then
    insert into public.farm_members (farm_id, user_id, role) values (p_farm, v_user, v_role)
    on conflict (farm_id, user_id) do update
      set removed_at = null,
          role = case when public.farm_members.role = 'owner' then 'owner' else excluded.role end;
    return 'member';
  end if;
  insert into public.farm_invites (farm_id, email, invited_by, role) values (p_farm, v_email, auth.uid(), v_role)
  on conflict (farm_id, email) where accepted_at is null and revoked_at is null do update set role = excluded.role;
  return 'invited';
end;
$$;

-- Troca o papel de quem já tem acesso. Só o dono, nunca o próprio nem o de outro dono.
create function public.set_farm_member_role(p_farm uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_farm_owner(p_farm) then
    raise exception 'Só o dono da fazenda muda o tipo de acesso.' using errcode = '42501';
  end if;
  if p_role not in ('member', 'viewer') then
    raise exception 'Tipo de acesso inválido.' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode mudar o próprio acesso.' using errcode = '22023';
  end if;
  update public.farm_members set role = p_role
  where farm_id = p_farm and user_id = p_user and removed_at is null and role <> 'owner';
end;
$$;

drop function public.list_farm_invites(uuid);

create function public.list_farm_invites(p_farm uuid)
returns table (id uuid, email text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.email, i.role, i.created_at
  from public.farm_invites i
  where i.farm_id = p_farm and i.accepted_at is null and i.revoked_at is null
    and public.is_farm_owner(p_farm)
  order by i.created_at, i.id;
$$;

-- O convite agora leva o papel escolhido.
create or replace function public.claim_farm_invites()
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
    returning i.farm_id, i.role
  )
  insert into public.farm_members (farm_id, user_id, role)
  select distinct on (o.farm_id) o.farm_id, v_uid, o.role from opened o
  on conflict (farm_id, user_id) do update
    set removed_at = null,
        role = case when public.farm_members.role = 'owner' then 'owner' else excluded.role end;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.add_farm_member(uuid, text, text) from public, anon;
revoke all on function public.set_farm_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.list_farm_invites(uuid) from public, anon;
grant execute on function public.add_farm_member(uuid, text, text) to authenticated;
grant execute on function public.set_farm_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.list_farm_invites(uuid) to authenticated;
