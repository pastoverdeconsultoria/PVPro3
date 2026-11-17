-- pvpro3 · etapa 4 · adubação nitrogenada e membros da fazenda
--
-- Como aplicar: Supabase → SQL Editor → colar este arquivo inteiro → Run.
-- Rodar UMA vez, depois dos arquivos das etapas 1 e 2.
--
--   * Adubação: registro de N aplicado por piquete, com data. Entra na projeção
--     de capacidade de suporte, com o efeito distribuído nos 60 dias seguintes.
--   * Membros: o dono dá acesso à fazenda a outra conta, pelo e-mail, e tira.
--     Tirar é suave (`removed_at`), como tudo neste banco.

-- ---------------------------------------------------------------------------
-- Adubação
-- ---------------------------------------------------------------------------

create table public.fertilizations (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  paddock_id uuid not null,
  applied_on date not null,
  -- Dose de nitrogênio, em kg de N por hectare (não de ureia).
  n_kg_ha numeric(6, 1) not null check (n_kg_ha > 0 and n_kg_ha <= 500),
  note text,
  author uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (paddock_id, farm_id) references public.paddocks (id, farm_id)
);
create index fertilizations_farm_idx on public.fertilizations (farm_id, applied_on);

create function public.fertilizations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author := auth.uid();
  new.created_at := now();
  new.deleted_at := null;
  return new;
end;
$$;

create trigger fertilizations_before_insert
before insert on public.fertilizations
for each row execute function public.fertilizations_before_insert();

alter table public.fertilizations enable row level security;

create policy fertilizations_select on public.fertilizations
  for select to authenticated using (public.is_farm_member(farm_id));
create policy fertilizations_insert on public.fertilizations
  for insert to authenticated with check (public.is_farm_member(farm_id));
create policy fertilizations_update on public.fertilizations
  for update to authenticated using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id));

revoke all on public.fertilizations from anon, authenticated;
grant select, insert on public.fertilizations to authenticated;
grant update (deleted_at) on public.fertilizations to authenticated;
revoke all on function public.fertilizations_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Membros da fazenda
-- ---------------------------------------------------------------------------

alter table public.farm_members add column removed_at timestamptz;

-- Quem teve o acesso tirado deixa de ser membro na hora, em todas as regras.
create or replace function public.is_farm_member(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm and m.user_id = auth.uid() and m.removed_at is null
  );
$$;

create function public.is_farm_owner(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm and m.user_id = auth.uid() and m.role = 'owner' and m.removed_at is null
  );
$$;

-- Quem tem acesso à fazenda, com o e-mail. Só membro consegue listar.
create function public.list_farm_members(p_farm uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.farm_members m
  join auth.users u on u.id = m.user_id
  where m.farm_id = p_farm and m.removed_at is null and public.is_farm_member(p_farm)
  order by m.created_at, m.user_id;
$$;

-- Dá acesso à fazenda a uma conta que já existe, pelo e-mail. Só o dono.
-- Quem já teve acesso e foi tirado volta a ter.
create function public.add_farm_member(p_farm uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.is_farm_owner(p_farm) then
    raise exception 'Só o dono da fazenda dá acesso a outra conta.' using errcode = '42501';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Não existe conta com esse e-mail. A pessoa precisa criar a conta no app primeiro.' using errcode = '22023';
  end if;
  insert into public.farm_members (farm_id, user_id, role) values (p_farm, v_user, 'member')
  on conflict (farm_id, user_id) do update set removed_at = null;
  return v_user;
end;
$$;

-- Tira o acesso de uma conta. Só o dono, e nunca o próprio acesso (a fazenda
-- não pode ficar sem dono).
create function public.remove_farm_member(p_farm uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_farm_owner(p_farm) then
    raise exception 'Só o dono da fazenda tira o acesso de outra conta.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode tirar o próprio acesso.' using errcode = '22023';
  end if;
  update public.farm_members set removed_at = now()
  where farm_id = p_farm and user_id = p_user and removed_at is null;
end;
$$;

revoke all on function public.is_farm_owner(uuid) from public, anon;
revoke all on function public.list_farm_members(uuid) from public, anon;
revoke all on function public.add_farm_member(uuid, text) from public, anon;
revoke all on function public.remove_farm_member(uuid, uuid) from public, anon;

grant execute on function public.is_farm_owner(uuid) to authenticated;
grant execute on function public.list_farm_members(uuid) to authenticated;
grant execute on function public.add_farm_member(uuid, text) to authenticated;
grant execute on function public.remove_farm_member(uuid, uuid) to authenticated;
