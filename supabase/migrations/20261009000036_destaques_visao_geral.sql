-- Destaques editáveis e exclusivos da Visão Geral.
-- A lista antiga tinha duas responsabilidades: cards da home e candidaturas prioritárias.
-- A partir daqui, prioridades usam candidaturas_acompanhadas e a home usa esta tabela.

create table public.destaques_visao_geral (
  uf char(2) not null check (uf in ('SP', 'MG', 'RS')),
  candidatura_id integer not null references public.candidaturas(id) on delete cascade,
  ordem smallint not null check (ordem between 1 and 6),
  incluido_por text not null,
  incluido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (uf, candidatura_id),
  unique (uf, ordem)
);

create function public.validar_destaque_visao_geral()
returns trigger language plpgsql set search_path = public as $$
declare
  v_uf char(2);
  v_tipo text;
begin
  select uf, tipo into v_uf, v_tipo
  from public.candidaturas
  where id = new.candidatura_id;

  if not found or v_tipo <> 'nominal' or v_uf <> new.uf then
    raise exception 'candidatura nominal inválida para a UF %', new.uf using errcode = '22023';
  end if;
  return new;
end $$;

create trigger validar_destaque_visao_geral
before insert or update on public.destaques_visao_geral
for each row execute function public.validar_destaque_visao_geral();

alter table public.destaques_visao_geral enable row level security;
create policy "equipe le" on public.destaques_visao_geral for select to authenticated
  using ((select public.autorizado()));
revoke all on table public.destaques_visao_geral from anon;
revoke insert, update, delete on table public.destaques_visao_geral from authenticated;
grant select on table public.destaques_visao_geral to authenticated;

create function public.substituir_destaques_visao_geral(p_uf text, p_ids integer[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uf char(2) := upper(trim(p_uf));
  v_ids integer[] := coalesce(p_ids, '{}'::integer[]);
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem alterar os destaques' using errcode = '42501';
  end if;
  if v_uf is null or v_uf not in ('SP', 'MG', 'RS') then
    raise exception 'UF inválida' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 6 then
    raise exception 'selecione no máximo 6 candidaturas' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as x(id)) then
    raise exception 'candidaturas duplicadas não são permitidas' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.candidaturas c on c.id = x.id
    where c.id is null or c.tipo <> 'nominal' or c.uf <> v_uf
  ) then
    raise exception 'todas as candidaturas devem ser nominais e pertencer à UF %', v_uf using errcode = '22023';
  end if;

  delete from public.destaques_visao_geral where uf = v_uf;
  insert into public.destaques_visao_geral(uf, candidatura_id, ordem, incluido_por)
  select v_uf, x.id, x.ordem::smallint, public.email_atual()
  from unnest(v_ids) with ordinality as x(id, ordem);
end $$;

revoke execute on function public.substituir_destaques_visao_geral(text, integer[]) from public, anon;
grant execute on function public.substituir_destaques_visao_geral(text, integer[]) to authenticated;

-- O comparativo de mídia continua usando a curadoria administrativa do Mapa de Mobilização.
create or replace function public.meta_prioritarias_json()
returns json language sql stable security invoker set search_path = public as $$
  with d as (
    select c.id, c.uf, c.nm_urna, c.cd_cargo, c.sg_partido, c.votos_total, c.situacao, ca.ordem
    from candidaturas_acompanhadas ca join candidaturas c on c.id = ca.candidatura_id
  ), paginas as (
    select v.candidatura_id, v.page_id from meta_vinculos v
    where v.status_revisao <> 'rejeitado' and v.candidatura_id in (select id from d)
  ), prop as (
    select p.candidatura_id, a.* from paginas p join meta_anuncios a on a.page_id = p.page_id
  ), dob as (
    select distinct on (m.candidatura_id, a.ad_id) m.candidatura_id, a.*
    from meta_mencoes m join meta_anuncios a using (ad_id)
    where m.candidatura_id in (select id from d) and m.cita_numero
      and m.pagador_candidatura_id is distinct from m.candidatura_id
      and a.page_id not in (select page_id from paginas p where p.candidatura_id = m.candidatura_id)
  ), agg as (
    select 'prop' as fonte, candidatura_id, count(*) as n, sum(gasto_min) as gmin, sum(gasto_max) as gmax, bool_or(gasto_max is null) as aberto,
           sum(gasto_min) filter (where moeda = 'BRL' and alcance_br > 0) as cgmin,
           sum(gasto_max) filter (where moeda = 'BRL' and alcance_br > 0) as cgmax,
           bool_or(gasto_max is null) filter (where moeda = 'BRL' and alcance_br > 0) as caberto,
           sum(alcance_br) filter (where moeda = 'BRL' and alcance_br > 0) as alcance
    from prop group by candidatura_id
    union all
    select 'dob', candidatura_id, count(*), sum(gasto_min), sum(gasto_max), bool_or(gasto_max is null),
           sum(gasto_min) filter (where moeda = 'BRL' and alcance_br > 0),
           sum(gasto_max) filter (where moeda = 'BRL' and alcance_br > 0),
           bool_or(gasto_max is null) filter (where moeda = 'BRL' and alcance_br > 0),
           sum(alcance_br) filter (where moeda = 'BRL' and alcance_br > 0)
    from dob group by candidatura_id
  )
  select coalesce(json_agg(json_build_object(
    'id', d.id, 'uf', d.uf, 'nome', d.nm_urna, 'cargo', d.cd_cargo, 'partido', d.sg_partido, 'votos', d.votos_total, 'situacao', d.situacao,
    'prop', (select row_to_json(x) from (select n, gmin, gmax, aberto, cgmin, cgmax, caberto, alcance from agg where agg.fonte = 'prop' and agg.candidatura_id = d.id) x),
    'dob', (select row_to_json(x) from (select n, gmin, gmax, aberto, cgmin, cgmax, caberto, alcance from agg where agg.fonte = 'dob' and agg.candidatura_id = d.id) x)
  ) order by d.uf, d.ordem), '[]')
  from d;
$$;

-- Compatibilidade com o frontend anterior durante o deploy; a tabela fica vazia e sem novos escritores.
delete from public.candidaturas_destaque;
select public.meta_atualizar_prioritarias();
