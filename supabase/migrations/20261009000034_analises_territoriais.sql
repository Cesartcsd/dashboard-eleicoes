-- Análises territoriais configuráveis da aba "Ainda há esperança".

create table public.analises_territoriais (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  uf char(2) not null,
  cd_cargo smallint not null,
  candidatura_principal_id integer not null references public.candidaturas on delete cascade,
  candidatura_adversaria_id integer not null references public.candidaturas on delete cascade,
  cd_municipio char(5) references public.municipios,
  mobilizacao numeric(5,4) not null default 0.1 check (mobilizacao between 0.01 and 1),
  autor uuid not null default auth.uid() references auth.users on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (candidatura_principal_id <> candidatura_adversaria_id)
);

create function public.validar_analise_territorial()
returns trigger language plpgsql set search_path = public as $$
declare p public.candidaturas; a public.candidaturas; m public.municipios;
begin
  select * into p from public.candidaturas where id = new.candidatura_principal_id;
  select * into a from public.candidaturas where id = new.candidatura_adversaria_id;
  if p.id is null or a.id is null or p.tipo <> 'nominal' or a.tipo <> 'nominal' then
    raise exception 'selecione duas candidaturas nominais válidas' using errcode = '22023';
  end if;
  if p.uf <> a.uf or p.cd_cargo <> a.cd_cargo or p.cd_eleicao <> a.cd_eleicao then
    raise exception 'as candidaturas devem pertencer à mesma UF, cargo e eleição' using errcode = '22023';
  end if;
  if new.uf <> p.uf or new.cd_cargo <> p.cd_cargo then
    raise exception 'UF ou cargo incompatível com as candidaturas' using errcode = '22023';
  end if;
  if new.cd_municipio is not null then
    select * into m from public.municipios where cd_municipio = new.cd_municipio;
    if m.cd_municipio is null or m.uf <> new.uf then
      raise exception 'município incompatível com a UF' using errcode = '22023';
    end if;
  end if;
  new.titulo := trim(new.titulo);
  new.atualizado_em := now();
  return new;
end $$;

create trigger validar_analise_territorial
before insert or update on public.analises_territoriais
for each row execute function public.validar_analise_territorial();

alter table public.analises_territoriais enable row level security;
create policy "equipe le" on public.analises_territoriais for select to authenticated
  using ((select public.autorizado()));
create policy "autor cria" on public.analises_territoriais for insert to authenticated
  with check (autor = (select auth.uid()) and (select public.autorizado()));
create policy "autor edita" on public.analises_territoriais for update to authenticated
  using (autor = (select auth.uid()) and (select public.autorizado()))
  with check (autor = (select auth.uid()) and (select public.autorizado()));
create policy "autor ou admin apaga" on public.analises_territoriais for delete to authenticated
  using ((autor = (select auth.uid()) or (select public.sou_admin())) and (select public.autorizado()));

create table public.candidaturas_acompanhadas (
  candidatura_id integer primary key references public.candidaturas on delete cascade,
  ordem smallint not null default 1 check (ordem > 0),
  incluido_em timestamptz not null default now(),
  incluido_por text
);
alter table public.candidaturas_acompanhadas enable row level security;
create policy "equipe le" on public.candidaturas_acompanhadas for select to authenticated
  using ((select public.autorizado()));

create function public.salvar_candidatura_acompanhada(p_candidatura_id integer, p_ordem smallint default 1)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem alterar candidaturas acompanhadas' using errcode = '42501';
  end if;
  if not exists (select 1 from public.candidaturas where id = p_candidatura_id and tipo = 'nominal') then
    raise exception 'candidatura nominal inválida' using errcode = '22023';
  end if;
  insert into public.candidaturas_acompanhadas(candidatura_id, ordem, incluido_por)
  values (p_candidatura_id, greatest(p_ordem, 1), public.email_atual())
  on conflict (candidatura_id) do update set ordem = excluded.ordem;
end $$;

create function public.remover_candidatura_acompanhada(p_candidatura_id integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem alterar candidaturas acompanhadas' using errcode = '42501';
  end if;
  delete from public.candidaturas_acompanhadas where candidatura_id = p_candidatura_id;
end $$;

revoke execute on function public.salvar_candidatura_acompanhada(integer, smallint),
  public.remover_candidatura_acompanhada(integer) from public, anon;
grant execute on function public.salvar_candidatura_acompanhada(integer, smallint),
  public.remover_candidatura_acompanhada(integer) to authenticated;

create or replace function public.candidaturas_json(p_uf text default 'SP')
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'eleicao', json_agg(cd_eleicao order by id),
    'cargo', json_agg(cd_cargo order by id), 'tipo', json_agg(tipo order by id),
    'numero', json_agg(numero order by id), 'nome', json_agg(nm_urna order by id),
    'nomeCompleto', json_agg(nm_candidato order by id), 'partido', json_agg(sg_partido order by id),
    'destinacao', json_agg(destinacao order by id), 'votos', json_agg(votos_total order by id),
    'situacao', json_agg(situacao order by id))
  from candidaturas where uf = upper(p_uf);
$$;
