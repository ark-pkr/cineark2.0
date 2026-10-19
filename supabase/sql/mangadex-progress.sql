-- Execute uma vez no SQL Editor do projeto CINE ARK. Pode executar novamente.
begin;
do $setup$
declare catalog_id_type text;
begin
  select format_type(atttypid, atttypmod) into catalog_id_type
  from pg_attribute where attrelid = 'public.itens_catalogo'::regclass
    and attname = 'id' and not attisdropped;
  if catalog_id_type is null then raise exception 'Catálogo sem coluna id.'; end if;
  execute format($ddl$
    create table if not exists public.ark_mangadex_progress (
      user_id uuid not null references auth.users(id) on delete cascade,
      work_id %s not null references public.itens_catalogo(id) on delete cascade,
      manga_id uuid not null,
      chapter_id uuid not null,
      chapter_number text not null default '' check (length(chapter_number) <= 80),
      language text not null check (language in ('pt-br', 'pt', 'en')),
      page_index integer not null check (page_index between 0 and 1000),
      updated_at timestamptz not null default now(),
      primary key (user_id, work_id)
    )$ddl$, catalog_id_type);
end $setup$;
alter table public.ark_mangadex_progress enable row level security;
revoke all on public.ark_mangadex_progress from anon, authenticated;
grant select, insert, update, delete on public.ark_mangadex_progress to authenticated;
drop policy if exists dex_progress_select on public.ark_mangadex_progress;
create policy dex_progress_select on public.ark_mangadex_progress for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists dex_progress_insert on public.ark_mangadex_progress;
create policy dex_progress_insert on public.ark_mangadex_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists dex_progress_update on public.ark_mangadex_progress;
create policy dex_progress_update on public.ark_mangadex_progress for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists dex_progress_delete on public.ark_mangadex_progress;
create policy dex_progress_delete on public.ark_mangadex_progress for delete to authenticated
  using ((select auth.uid()) = user_id);
-- An old offline device must not replace newer progress already saved by another device.
create or replace function public.ark_keep_latest_dex_progress()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if new.updated_at > now() + interval '5 minutes' then
    raise exception 'Confira a data e a hora do dispositivo.';
  end if;
  if TG_OP = 'UPDATE' and new.updated_at < old.updated_at then return old; end if;
  return new;
end $function$;
revoke all on function public.ark_keep_latest_dex_progress() from public, anon, authenticated;
drop trigger if exists ark_keep_latest_dex_progress on public.ark_mangadex_progress;
create trigger ark_keep_latest_dex_progress before insert or update on public.ark_mangadex_progress
  for each row execute function public.ark_keep_latest_dex_progress();
notify pgrst, 'reload schema';
commit;

-- Verificação: as quatro políticas e RLS=true precisam aparecer.
select c.relrowsecurity as rls_enabled, p.policyname, p.cmd
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relname = 'ark_mangadex_progress';
