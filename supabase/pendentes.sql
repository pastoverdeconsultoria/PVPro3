-- pvpro3 · SQL único com o que falta rodar depois da etapa 1
--
-- Junta, na ordem, as migrações:
--   supabase/migrations/20261116120000_caderno.sql            (caderno da equipe e chuva)
--   supabase/migrations/20261117120000_adubacao_membros.sql   (adubação e acesso de outras contas)
--
-- Como aplicar: Supabase → SQL Editor → colar este arquivo inteiro → Run.
-- Rodar UMA vez. Se alguma dessas duas migrações já foi rodada, não use este
-- arquivo: rode só a que falta, pelo arquivo dela.
-- É cópia de conveniência; os arquivos em supabase/migrations/ são a fonte.

-- pvpro3 · etapa 2 · caderno da equipe e chuva registrada
--
-- Como aplicar: Supabase → SQL Editor → colar este arquivo inteiro → Run.
-- Rodar UMA vez, depois do arquivo da etapa 1 (20261115120000_base.sql).
--
-- O caderno é o link que o vaqueiro abre sem login. Regras (CLAUDE.md):
--   * O anônimo não lê nem grava tabela nenhuma. Ele só chama duas funções, e
--     as duas conferem o `share_token` da fazenda: uma devolve a lista de
--     piquetes e lotes para o formulário, a outra grava um relato.
--   * Relato é só de chuva ou de mudança de gado. Sem pesagem e sem ocorrência.
--   * O relato nasce "novo". Só membro da fazenda lê, edita, descarta ou lança.
--   * Lançar mudança de gado grava saída e entrada pela mesma função da etapa 1
--     (`record_lot_events`), na mesma transação em que o relato vira "lancado".

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.field_reports (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  kind text not null check (kind in ('chuva', 'mudanca')),
  -- Dia do fato, informado por quem relatou (hoje, ontem ou outra data).
  report_date date not null,
  mm numeric(6, 1),
  lot_id uuid,
  to_paddock_id uuid,
  reporter text,
  note text,
  status text not null default 'novo' check (status in ('novo', 'lancado', 'descartado')),
  -- Quando o relato foi feito no aparelho (pode ser bem antes de chegar aqui, se não havia sinal).
  device_created_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  deleted_at timestamptz,
  foreign key (lot_id, farm_id) references public.lots (id, farm_id),
  foreign key (to_paddock_id, farm_id) references public.paddocks (id, farm_id),
  constraint field_reports_chuva check (kind <> 'chuva' or coalesce(mm, -1) between 0 and 500),
  constraint field_reports_mudanca check (kind <> 'mudanca' or (lot_id is not null and to_paddock_id is not null))
);
create index field_reports_farm_idx on public.field_reports (farm_id, status, created_at);

-- Chuva real (pluviômetro ou vaqueiro). O total de um dia é a soma das linhas
-- válidas daquele dia: duas leituras no mesmo dia se somam.
create table public.rain_records (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  rain_date date not null,
  mm numeric(6, 1) not null check (mm >= 0 and mm <= 500),
  note text,
  report_id uuid references public.field_reports (id),
  author uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index rain_records_farm_idx on public.rain_records (farm_id, rain_date);

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Quem revisou e quando são sempre do servidor.
create function public.field_reports_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger field_reports_before_update
before update on public.field_reports
for each row execute function public.field_reports_before_update();

create function public.rain_records_before_insert()
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

create trigger rain_records_before_insert
before insert on public.rain_records
for each row execute function public.rain_records_before_insert();

-- ---------------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------------

alter table public.field_reports enable row level security;
alter table public.rain_records enable row level security;

create policy field_reports_select on public.field_reports
  for select to authenticated using (public.is_farm_member(farm_id));
create policy field_reports_update on public.field_reports
  for update to authenticated using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id));

create policy rain_records_select on public.rain_records
  for select to authenticated using (public.is_farm_member(farm_id));
create policy rain_records_insert on public.rain_records
  for insert to authenticated with check (public.is_farm_member(farm_id));
create policy rain_records_update on public.rain_records
  for update to authenticated using (public.is_farm_member(farm_id)) with check (public.is_farm_member(farm_id));

revoke all on public.field_reports, public.rain_records from anon, authenticated;

grant select on public.field_reports, public.rain_records to authenticated;
-- O relato só nasce pela função `submit_field_report`; o membro edita e muda a situação.
grant update (report_date, mm, lot_id, to_paddock_id, note, status, deleted_at) on public.field_reports to authenticated;
grant insert on public.rain_records to authenticated;
grant update (deleted_at) on public.rain_records to authenticated;

-- ---------------------------------------------------------------------------
-- Funções do link público (as únicas que o anônimo executa)
-- ---------------------------------------------------------------------------

-- Lista de piquetes e lotes para o formulário do caderno. Devolve null se o
-- link não vale (token errado ou trocado).
--
-- Para quem relata reconhecer o lote e tocar no pasto certo, vem junto:
--   * de cada piquete, o contorno simplificado (no máximo ~40 pontos), para o
--     mapinha de toque. Sem área.
--   * de cada lote com animais, as cabeças e onde ele está. "Onde está" é o
--     destino do relato de mudança mais recente ainda não revisado; sem relato
--     pendente, é a última entrada em piquete do histórico oficial.
-- Não devolve peso, categoria, área nem nada de outra fazenda.
create function public.notebook_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_farm public.farms;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select * into v_farm from public.farms f where f.share_token = p_token and f.deleted_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'farm_name', v_farm.name,
    'paddocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'outline', (
            select jsonb_agg(r.pt order by r.ord)
            from jsonb_array_elements(p.geom -> 'coordinates' -> 0) with ordinality as r (pt, ord)
            where (r.ord - 1) % greatest(1, ceil(jsonb_array_length(p.geom -> 'coordinates' -> 0) / 40.0)::integer) = 0
          )
        )
        order by p.sort, p.name
      )
      from public.paddocks p where p.farm_id = v_farm.id and p.deleted_at is null
    ), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', l.id, 'name', l.name, 'heads', h.heads, 'paddock_id', coalesce(pend.paddock_id, loc.paddock_id))
        order by l.name
      )
      from public.lots l
      cross join lateral (
        select coalesce(sum(case
          when e.type in ('inicio', 'animais_entrada', 'transf_in') then e.heads
          when e.type in ('animais_saida', 'transf_out') then -e.heads
          else 0 end), 0)::integer as heads
        from public.lot_events e where e.lot_id = l.id and e.deleted_at is null
      ) h
      left join lateral (
        select case when e.type = 'piquete_entrada' then e.paddock_id end as paddock_id
        from public.lot_events e
        where e.lot_id = l.id and e.deleted_at is null and e.type in ('piquete_entrada', 'piquete_saida')
        order by e.event_date desc, e.seq desc
        limit 1
      ) loc on true
      left join lateral (
        select r.to_paddock_id as paddock_id
        from public.field_reports r
        where r.lot_id = l.id and r.kind = 'mudanca' and r.status = 'novo' and r.deleted_at is null
        order by r.report_date desc, r.created_at desc
        limit 1
      ) pend on true
      where l.farm_id = v_farm.id and l.deleted_at is null and h.heads > 0
    ), '[]'::jsonb)
  );
end;
$$;

-- Grava um relato do caderno. Reenviar o mesmo relato (mesmo id) não duplica,
-- que é o que a fila offline do aparelho faz quando o sinal volta.
create function public.submit_field_report(p_token text, p_report jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm uuid;
  v_id uuid := (p_report ->> 'id')::uuid;
  v_kind text := p_report ->> 'kind';
  -- Sem data informada, vale o dia em que o relato foi feito; na falta dele, o dia do envio.
  v_today date := (now() at time zone 'America/Bahia')::date;
  v_device timestamptz := (p_report ->> 'device_created_at')::timestamptz;
  v_date date := coalesce(
    (p_report ->> 'report_date')::date,
    (v_device at time zone 'America/Bahia')::date,
    v_today
  );
  v_pending integer;
begin
  select f.id into v_farm from public.farms f
  where p_token is not null and length(p_token) >= 32 and f.share_token = p_token and f.deleted_at is null;
  if v_farm is null then
    raise exception 'Este link do caderno não vale mais. Peça o link novo.' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'Relato sem id.' using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('chuva', 'mudanca') then
    raise exception 'Tipo de relato inválido.' using errcode = '22023';
  end if;
  -- Um dia de folga para fuso; relato muito antigo é erro de digitação.
  if v_date > v_today + 1 then
    raise exception 'A data não pode ser depois de hoje.' using errcode = '22023';
  end if;
  if v_date < v_today - 120 then
    raise exception 'Data antiga demais para o caderno. Avise o consultor.' using errcode = '22023';
  end if;

  if exists (select 1 from public.field_reports r where r.id = v_id) then
    return 'ja_recebido';
  end if;

  -- Trava contra enxurrada se o link vazar.
  select count(*) into v_pending from public.field_reports r where r.farm_id = v_farm and r.status = 'novo' and r.deleted_at is null;
  if v_pending >= 500 then
    raise exception 'O caderno está cheio. Avise o consultor.' using errcode = '53400';
  end if;

  if v_kind = 'mudanca' then
    if not exists (select 1 from public.lots l where l.id = (p_report ->> 'lot_id')::uuid and l.farm_id = v_farm and l.deleted_at is null) then
      raise exception 'Lote não encontrado. Atualize a página.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.paddocks p where p.id = (p_report ->> 'to_paddock_id')::uuid and p.farm_id = v_farm and p.deleted_at is null) then
      raise exception 'Piquete não encontrado. Atualize a página.' using errcode = '22023';
    end if;
  elsif not (coalesce((p_report ->> 'mm')::numeric, -1) between 0 and 500) then
    raise exception 'Chuva: informe os milímetros, de 0 a 500.' using errcode = '22023';
  end if;

  insert into public.field_reports (id, farm_id, kind, report_date, mm, lot_id, to_paddock_id, reporter, note, device_created_at)
  values (
    v_id,
    v_farm,
    v_kind,
    v_date,
    case when v_kind = 'chuva' then (p_report ->> 'mm')::numeric end,
    case when v_kind = 'mudanca' then (p_report ->> 'lot_id')::uuid end,
    case when v_kind = 'mudanca' then (p_report ->> 'to_paddock_id')::uuid end,
    nullif(left(btrim(p_report ->> 'reporter'), 60), ''),
    nullif(left(btrim(p_report ->> 'note'), 500), ''),
    v_device
  );
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Funções do consultor (rodam com a permissão de quem chama: as regras valem)
-- ---------------------------------------------------------------------------

-- Lança um relato de mudança de gado: o relato vira "lancado" e a saída e a
-- entrada entram no histórico do lote, tudo ou nada. Relato já lançado ou
-- descartado não lança de novo.
create function public.launch_move_report(p_report uuid, p_events jsonb)
returns setof public.lot_events
language plpgsql
set search_path = ''
as $$
begin
  update public.field_reports set status = 'lancado'
  where id = p_report and kind = 'mudanca' and status = 'novo' and deleted_at is null;
  if not found then
    raise exception 'Esse relato já foi lançado ou descartado.' using errcode = '22023';
  end if;
  return query select * from public.record_lot_events(p_events);
end;
$$;

-- Registra chuva de um dia. Com `p_replace`, as leituras que já existiam naquele
-- dia são apagadas (de forma suave) antes; sem ele, a nova leitura se soma.
-- Com `p_report`, o relato do caderno vira "lancado" na mesma transação.
create function public.record_rain(p_rain jsonb, p_replace boolean default false, p_report uuid default null)
returns public.rain_records
language plpgsql
set search_path = ''
as $$
declare
  v_farm uuid := (p_rain ->> 'farm_id')::uuid;
  v_date date := (p_rain ->> 'rain_date')::date;
  v_row public.rain_records;
begin
  if p_report is not null then
    update public.field_reports set status = 'lancado'
    where id = p_report and farm_id = v_farm and kind = 'chuva' and status = 'novo' and deleted_at is null;
    if not found then
      raise exception 'Esse relato já foi lançado ou descartado.' using errcode = '22023';
    end if;
  end if;

  if p_replace then
    update public.rain_records set deleted_at = now()
    where farm_id = v_farm and rain_date = v_date and deleted_at is null;
  end if;

  insert into public.rain_records (id, farm_id, rain_date, mm, note, report_id)
  values (
    (p_rain ->> 'id')::uuid,
    v_farm,
    v_date,
    (p_rain ->> 'mm')::numeric,
    nullif(btrim(p_rain ->> 'note'), ''),
    p_report
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- Troca o link do caderno. O link antigo para de funcionar na hora.
create function public.rotate_share_token(p_farm uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_farm_member(p_farm) then
    raise exception 'Sua conta não tem acesso a essa fazenda.' using errcode = '42501';
  end if;
  update public.farms set share_token = v_token where id = p_farm;
  return v_token;
end;
$$;

revoke all on function public.field_reports_before_update() from public, anon, authenticated;
revoke all on function public.rain_records_before_insert() from public, anon, authenticated;
revoke all on function public.notebook_context(text) from public;
revoke all on function public.submit_field_report(text, jsonb) from public;
revoke all on function public.launch_move_report(uuid, jsonb) from public, anon;
revoke all on function public.record_rain(jsonb, boolean, uuid) from public, anon;
revoke all on function public.rotate_share_token(uuid) from public, anon;

-- O link público: anônimo (vaqueiro) e também quem estiver logado no mesmo aparelho.
grant execute on function public.notebook_context(text) to anon, authenticated;
grant execute on function public.submit_field_report(text, jsonb) to anon, authenticated;

grant execute on function public.launch_move_report(uuid, jsonb) to authenticated;
grant execute on function public.record_rain(jsonb, boolean, uuid) to authenticated;
grant execute on function public.rotate_share_token(uuid) to authenticated;

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
