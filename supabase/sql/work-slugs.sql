begin;
alter table public.itens_catalogo add column slug text;
update public.itens_catalogo set slug=id::text where slug is null;
alter table public.itens_catalogo alter column slug set default gen_random_uuid()::text;
alter table public.itens_catalogo alter column slug set not null;
alter table public.itens_catalogo add constraint catalog_slug_format check(length(slug) between 1 and 180 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create unique index catalog_slug_unique on public.itens_catalogo(slug);
notify pgrst,'reload schema';
commit;
