-- pvpro3 · etapa 1 · base do banco
--
-- Como aplicar: Supabase → SQL Editor → colar este arquivo inteiro → Run.
-- Rodar UMA vez, num projeto novo. Rodar de novo dá erro de "já existe" e não estraga nada.
--
-- Princípios (CLAUDE.md):
--   * Só membro da fazenda lê e grava. Anônimo não enxerga nada.
--   * Nada é apagado de verdade: não existe permissão de DELETE, só `deleted_at`.
--   * Cabeças, peso, categoria e piquete atual do lote não são colunas: saem do
--     histórico (`lot_events`), ordenado por `event_date, seq`.
--   * `seq` é dado pelo servidor. Mover lote grava saída e entrada na mesma
--     transação, saída antes (função `record_lot_events`).
--   * Os ids vêm do aparelho (UUID), para o reenvio de um registro não duplicar.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.farms (
  id uuid primary key,
  name text not null check (length(btrim(name)) > 0),
  municipality text,
  centroid_lat double precision check (centroid_lat between -90 and 90),
  centroid_lon double precision check (centroid_lon between -180 and 180),
  -- Usado pelo caderno da equipe (etapa 2). Só membro consegue ler.
  share_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.farm_members (
  farm_id uuid not null references public.farms (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);
create index farm_members_user_idx on public.farm_members (user_id);

create table public.paddocks (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  name text not null check (length(btrim(name)) > 0),
  folder text,
  -- Polígono GeoJSON em lat/lon originais do KML (anéis fechados).
  geom jsonb not null check (geom ->> 'type' = 'Polygon'),
  area_ha numeric(10, 4) not null check (area_ha > 0),
  species text,
  is_grazing boolean not null default true,
  -- Última saída de gado informada na abertura, para o descanso não nascer "sem dado".
  initial_last_exit date,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, farm_id)
);
create index paddocks_farm_idx on public.paddocks (farm_id);

create table public.water_points (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  name text,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index water_points_farm_idx on public.water_points (farm_id);

-- Do lote só o nome é gravado. O resto é sempre derivado do histórico.
create table public.lots (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, farm_id)
);
create index lots_farm_idx on public.lots (farm_id);

create table public.modules (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  name text not null check (length(btrim(name)) > 0),
  color text not null,
  occupation_days integer not null check (occupation_days between 1 and 365),
  planned_lot_id uuid,
  condition text not null check (condition in ('extensiva', 'adubada')),
  -- M de referência em kg MS/ha/dia. 250 é o teto físico do modelo.
  m_ref numeric(6, 1) not null check (m_ref > 0 and m_ref <= 250),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, farm_id),
  foreign key (planned_lot_id, farm_id) references public.lots (id, farm_id)
);
create index modules_farm_idx on public.modules (farm_id);

-- Ordem dos piquetes de um módulo, com "vale a partir de". Cada (módulo, data)
-- é uma versão; a composição de um dia é a versão mais recente até aquele dia.
create table public.module_compositions (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  module_id uuid not null,
  paddock_id uuid not null,
  ord integer not null check (ord >= 0),
  valid_from date not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (module_id, farm_id) references public.modules (id, farm_id),
  foreign key (paddock_id, farm_id) references public.paddocks (id, farm_id)
);
create index module_compositions_farm_idx on public.module_compositions (farm_id);
create index module_compositions_module_idx on public.module_compositions (module_id, valid_from);

create sequence public.lot_events_seq;

-- O histórico do lote. Tipos com nomes separados para animais entrando e saindo
-- do lote (animais_*) e para o lote entrando e saindo de piquete (piquete_*).
create table public.lot_events (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  lot_id uuid not null,
  event_date date not null,
  seq bigint not null,
  type text not null check (type in (
    'inicio', 'animais_entrada', 'animais_saida', 'transf_in', 'transf_out',
    'pesagem', 'categoria', 'suplemento', 'piquete_entrada', 'piquete_saida'
  )),
  heads integer,
  weight_kg numeric(7, 2),
  category text,
  pct_pv numeric(4, 2),
  paddock_id uuid,
  reason text,
  heads_weighed integer,
  -- Registros que nasceram juntos (saída e entrada de uma mudança) e são apagados juntos.
  link uuid,
  note text,
  author uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (lot_id, farm_id) references public.lots (id, farm_id),
  foreign key (paddock_id, farm_id) references public.paddocks (id, farm_id),
  constraint lot_events_inicio check (
    type <> 'inicio' or (coalesce(heads, 0) > 0 and coalesce(weight_kg, 0) > 0 and length(btrim(coalesce(category, ''))) > 0)
  ),
  constraint lot_events_animais check (
    type not in ('animais_entrada', 'animais_saida', 'transf_in', 'transf_out') or coalesce(heads, 0) > 0
  ),
  constraint lot_events_peso check (weight_kg is null or weight_kg > 0),
  constraint lot_events_pesagem check (type <> 'pesagem' or weight_kg is not null),
  constraint lot_events_categoria check (type <> 'categoria' or length(btrim(coalesce(category, ''))) > 0),
  constraint lot_events_suplemento check (type <> 'suplemento' or coalesce(pct_pv, -1) between 0 and 2.5),
  constraint lot_events_piquete check (type not in ('piquete_entrada', 'piquete_saida') or paddock_id is not null)
);
-- Leitura paginada com ordenação estável (o PostgREST corta em 1000 linhas).
create index lot_events_farm_page_idx on public.lot_events (farm_id, event_date, id);
create index lot_events_lot_idx on public.lot_events (lot_id, event_date, seq);

-- ---------------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------------

-- Vínculo do usuário com a fazenda. SECURITY DEFINER para as políticas poderem
-- consultar `farm_members` sem entrar em recursão.
create function public.is_farm_member(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm and m.user_id = auth.uid()
  );
$$;

-- `seq` e autor são sempre do servidor, venha o que vier do aparelho.
create function public.lot_events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.seq := nextval('public.lot_events_seq');
  new.author := auth.uid();
  new.created_at := now();
  new.deleted_at := null;
  return new;
end;
$$;

create trigger lot_events_before_insert
before insert on public.lot_events
for each row execute function public.lot_events_before_insert();

-- ---------------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------------

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.paddocks enable row level security;
alter table public.water_points enable row level security;
alter table public.lots enable row level security;
alter table public.modules enable row level security;
alter table public.module_compositions enable row level security;
alter table public.lot_events enable row level security;

create policy farms_select on public.farms
  for select to authenticated using (public.is_farm_member(id));
create policy farms_update on public.farms
  for update to authenticated using (public.is_farm_member(id)) with check (public.is_farm_member(id));

create policy farm_members_select on public.farm_members
  for select to authenticated using (public.is_farm_member(farm_id));

do $$
declare t text;
begin
  foreach t in array array['paddocks', 'water_points', 'lots', 'modules', 'module_compositions', 'lot_events'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_farm_member(farm_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_farm_member(farm_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id))', t || '_update', t);
  end loop;
end;
$$;

-- O Supabase dá permissão ampla por padrão a anon e authenticated. Aqui ela é
-- tirada e devolvida só no que o app usa. Não existe DELETE para ninguém, e
-- UPDATE só alcança as colunas listadas (id, fazenda, seq e autor não mudam).
revoke all on
  public.farms, public.farm_members, public.paddocks, public.water_points,
  public.lots, public.modules, public.module_compositions, public.lot_events
from anon, authenticated;
revoke all on sequence public.lot_events_seq from anon, authenticated;

grant select on
  public.farms, public.farm_members, public.paddocks, public.water_points,
  public.lots, public.modules, public.module_compositions, public.lot_events
to authenticated;

-- Fazenda, piquete e bebedouro nascem só pela função `create_farm`.
grant insert on public.lots, public.modules, public.module_compositions, public.lot_events to authenticated;

grant update (name, municipality) on public.farms to authenticated;
grant update (name, species, is_grazing, initial_last_exit) on public.paddocks to authenticated;
grant update (name, deleted_at) on public.lots to authenticated;
grant update (name, color, occupation_days, planned_lot_id, condition, m_ref, deleted_at) on public.modules to authenticated;
grant update (deleted_at) on public.module_compositions to authenticated;
grant update (note, deleted_at) on public.lot_events to authenticated;

-- ---------------------------------------------------------------------------
-- Gravações que precisam ser uma transação só
-- ---------------------------------------------------------------------------

-- Abre a fazenda: fazenda, vínculo de dono, piquetes e bebedouros de uma vez.
-- Reenviar a mesma abertura (mesmo id) não duplica nada.
create function public.create_farm(p_farm jsonb, p_paddocks jsonb, p_water_points jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := (p_farm ->> 'id')::uuid;
  v_inserted uuid;
begin
  if v_uid is null then
    raise exception 'Entre na conta para abrir uma fazenda.' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'Fazenda sem id.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_paddocks) is distinct from 'array' or jsonb_array_length(p_paddocks) = 0 then
    raise exception 'A fazenda precisa de pelo menos um piquete.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_paddocks) > 2000 then
    raise exception 'Piquetes demais num arquivo só.' using errcode = '22023';
  end if;

  insert into public.farms (id, name, municipality, centroid_lat, centroid_lon, created_by)
  values (
    v_id,
    p_farm ->> 'name',
    nullif(btrim(p_farm ->> 'municipality'), ''),
    (p_farm ->> 'centroid_lat')::double precision,
    (p_farm ->> 'centroid_lon')::double precision,
    v_uid
  )
  on conflict (id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Já existe: ou é o reenvio de quem abriu, ou é alguém usando o id de outra fazenda.
    if public.is_farm_member(v_id) then
      return v_id;
    end if;
    raise exception 'Esse id de fazenda já está em uso.' using errcode = '42501';
  end if;

  insert into public.farm_members (farm_id, user_id, role) values (v_id, v_uid, 'owner');

  insert into public.paddocks (id, farm_id, name, folder, geom, area_ha, species, is_grazing, sort)
  select
    (t.e ->> 'id')::uuid,
    v_id,
    t.e ->> 'name',
    nullif(btrim(t.e ->> 'folder'), ''),
    t.e -> 'geom',
    (t.e ->> 'area_ha')::numeric,
    nullif(btrim(t.e ->> 'species'), ''),
    coalesce((t.e ->> 'is_grazing')::boolean, true),
    (t.ord - 1)::integer
  from jsonb_array_elements(p_paddocks) with ordinality as t (e, ord);

  insert into public.water_points (id, farm_id, name, lat, lon)
  select
    (t.e ->> 'id')::uuid,
    v_id,
    nullif(btrim(t.e ->> 'name'), ''),
    (t.e ->> 'lat')::double precision,
    (t.e ->> 'lon')::double precision
  from jsonb_array_elements(coalesce(p_water_points, '[]'::jsonb)) as t (e);

  return v_id;
end;
$$;

-- Grava registros do histórico na ordem em que vieram, um por vez, para o `seq`
-- sair crescente nessa ordem. É por aqui que passa a mudança de piquete (saída
-- e depois entrada). Registro com id já gravado é ignorado (reenvio).
-- Roda com a permissão de quem chama: as regras de acesso valem.
create function public.record_lot_events(p_events jsonb)
returns setof public.lot_events
language plpgsql
set search_path = ''
as $$
declare
  v_e jsonb;
  v_row public.lot_events;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Lista de registros inválida.' using errcode = '22023';
  end if;
  for v_e in
    select t.e from jsonb_array_elements(p_events) with ordinality as t (e, ord) order by t.ord
  loop
    insert into public.lot_events (
      id, farm_id, lot_id, event_date, seq, type, heads, weight_kg, category,
      pct_pv, paddock_id, reason, heads_weighed, link, note
    )
    values (
      (v_e ->> 'id')::uuid,
      (v_e ->> 'farm_id')::uuid,
      (v_e ->> 'lot_id')::uuid,
      (v_e ->> 'event_date')::date,
      0, -- trocado pelo gatilho
      v_e ->> 'type',
      (v_e ->> 'heads')::integer,
      (v_e ->> 'weight_kg')::numeric,
      nullif(btrim(v_e ->> 'category'), ''),
      (v_e ->> 'pct_pv')::numeric,
      (v_e ->> 'paddock_id')::uuid,
      nullif(btrim(v_e ->> 'reason'), ''),
      (v_e ->> 'heads_weighed')::integer,
      (v_e ->> 'link')::uuid,
      nullif(btrim(v_e ->> 'note'), '')
    )
    on conflict (id) do nothing
    returning * into v_row;
    if found then
      return next v_row;
    end if;
  end loop;
end;
$$;

-- Cria o lote e o registro de formação juntos: lote sem formação não existe.
create function public.create_lot(p_lot jsonb, p_events jsonb)
returns setof public.lot_events
language plpgsql
set search_path = ''
as $$
begin
  insert into public.lots (id, farm_id, name)
  values ((p_lot ->> 'id')::uuid, (p_lot ->> 'farm_id')::uuid, p_lot ->> 'name')
  on conflict (id) do nothing;
  return query select * from public.record_lot_events(p_events);
end;
$$;

-- Grava o módulo e, se vier lista de piquetes, a composição que vale a partir
-- de `p_valid_from`. Salvar de novo na mesma data substitui a versão daquela data;
-- as versões de datas anteriores ficam como histórico.
create function public.save_module(p_module jsonb, p_valid_from date default null, p_paddocks jsonb default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := (p_module ->> 'id')::uuid;
  v_farm uuid := (p_module ->> 'farm_id')::uuid;
begin
  insert into public.modules (id, farm_id, name, color, occupation_days, planned_lot_id, condition, m_ref)
  values (
    v_id,
    v_farm,
    p_module ->> 'name',
    p_module ->> 'color',
    (p_module ->> 'occupation_days')::integer,
    (p_module ->> 'planned_lot_id')::uuid,
    p_module ->> 'condition',
    (p_module ->> 'm_ref')::numeric
  )
  on conflict (id) do update set
    name = excluded.name,
    color = excluded.color,
    occupation_days = excluded.occupation_days,
    planned_lot_id = excluded.planned_lot_id,
    condition = excluded.condition,
    m_ref = excluded.m_ref,
    deleted_at = null;

  if p_paddocks is not null then
    if p_valid_from is null then
      raise exception 'Informe a partir de quando a composição vale.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_paddocks) is distinct from 'array' or jsonb_array_length(p_paddocks) = 0 then
      raise exception 'O módulo precisa de pelo menos um piquete.' using errcode = '22023';
    end if;

    update public.module_compositions
    set deleted_at = now()
    where module_id = v_id and valid_from = p_valid_from and deleted_at is null;

    insert into public.module_compositions (id, farm_id, module_id, paddock_id, ord, valid_from)
    select gen_random_uuid(), v_farm, v_id, (t.e #>> '{}')::uuid, (t.ord - 1)::integer, p_valid_from
    from jsonb_array_elements(p_paddocks) with ordinality as t (e, ord);
  end if;

  return v_id;
end;
$$;

-- Funções: ninguém anônimo executa nada.
revoke all on function public.is_farm_member(uuid) from public, anon;
revoke all on function public.lot_events_before_insert() from public, anon, authenticated;
revoke all on function public.create_farm(jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.record_lot_events(jsonb) from public, anon;
revoke all on function public.create_lot(jsonb, jsonb) from public, anon;
revoke all on function public.save_module(jsonb, date, jsonb) from public, anon;

grant execute on function public.is_farm_member(uuid) to authenticated;
grant execute on function public.create_farm(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.record_lot_events(jsonb) to authenticated;
grant execute on function public.create_lot(jsonb, jsonb) to authenticated;
grant execute on function public.save_module(jsonb, date, jsonb) to authenticated;
