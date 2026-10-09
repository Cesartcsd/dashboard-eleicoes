-- O payload de candidaturas passou a incluir cd_eleicao; força os navegadores a renovar o IndexedDB.
insert into public.meta(chave, valor)
values ('versao_dados', to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'))
on conflict (chave) do update set valor = excluded.valor;
