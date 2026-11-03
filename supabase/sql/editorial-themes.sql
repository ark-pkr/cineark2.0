-- Additive catalog metadata; existing administrator-only write policies remain in force.
-- Safe to run more than once.
alter table public.itens_catalogo
 add column if not exists editorial_themes text[] not null default '{}'::text[];
do $$
begin
 if not exists (
  select 1 from pg_constraint
  where conname='catalog_editorial_themes_bounds' and conrelid='public.itens_catalogo'::regclass
 ) then
  alter table public.itens_catalogo add constraint catalog_editorial_themes_bounds check (
   cardinality(editorial_themes)<=24
   and (cardinality(editorial_themes)=0 or array_ndims(editorial_themes)=1)
   and array_position(editorial_themes,null) is null
   and length(array_to_string(editorial_themes,','))<=1463
  );
 end if;
end $$;
comment on column public.itens_catalogo.editorial_themes is
 'Themes explicitly reviewed and saved by an administrator; never auto-filled from AI or imported genre metadata.';
