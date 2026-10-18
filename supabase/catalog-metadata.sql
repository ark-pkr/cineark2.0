-- Atualização do catálogo existente: execute uma vez no SQL Editor.
-- Mantém obras, capítulos, progresso e políticas atuais.
begin;
alter table public.itens_catalogo add column if not exists synopsis text not null default '';
alter table public.itens_catalogo add column if not exists mal_id integer;
comment on column public.itens_catalogo.synopsis is 'Sinopse editável, importada da Jikan ou preenchida pelo administrador.';
comment on column public.itens_catalogo.mal_id is 'Identificador opcional do mangá no MyAnimeList/Jikan.';
notify pgrst, 'reload schema';
commit;
