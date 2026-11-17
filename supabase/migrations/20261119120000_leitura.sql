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
