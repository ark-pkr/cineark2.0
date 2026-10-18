-- Execute depois de reader-access.sql no mesmo projeto do catálogo.
-- Não publica capítulos existentes nem envia arquivos locais automaticamente.
begin;

-- O tipo do ID é obtido do catálogo existente, sem presumir bigint ou UUID.
do $migration$
declare catalog_id_type text;
begin
  select format_type(atttypid, atttypmod) into catalog_id_type
  from pg_attribute
  where attrelid = 'public.itens_catalogo'::regclass and attname = 'id' and not attisdropped;
  if catalog_id_type is null then raise exception 'O catálogo precisa de uma coluna id.'; end if;
  execute format($ddl$
    create table if not exists public.ark_chapters (
      id uuid primary key default gen_random_uuid(),
      work_id %s not null references public.itens_catalogo(id) on delete cascade,
      number numeric not null check (number > 0 and number < 1000000),
      title text not null default '' check (length(title) <= 160),
      published boolean not null default false,
      created_at timestamptz not null default now(),
      unique (work_id, number), unique (id, work_id)
    )$ddl$, catalog_id_type);
  execute format($ddl$
    create table if not exists public.ark_reading_progress (
      user_id uuid not null references auth.users(id) on delete cascade,
      work_id %s not null references public.itens_catalogo(id) on delete cascade,
      chapter_id uuid not null,
      page_index integer not null check (page_index >= 0),
      updated_at timestamptz not null default now(),
      primary key (user_id, work_id),
      foreign key (chapter_id, work_id) references public.ark_chapters(id, work_id) on delete cascade
    )$ddl$, catalog_id_type);
end $migration$;

create table if not exists public.ark_chapter_pages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.ark_chapters(id) on delete cascade,
  page_index integer not null check (page_index >= 0),
  storage_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  unique (chapter_id, page_index),
  check (storage_path like chapter_id::text || '/%')
);

create index if not exists ark_progress_chapter_idx on public.ark_reading_progress(chapter_id);
alter table public.ark_chapters enable row level security;
alter table public.ark_chapter_pages enable row level security;
alter table public.ark_reading_progress enable row level security;
revoke all on public.ark_chapters, public.ark_chapter_pages, public.ark_reading_progress from anon;
grant select, insert, update, delete on public.ark_chapters, public.ark_chapter_pages, public.ark_reading_progress to authenticated;

drop policy if exists ark_chapters_read on public.ark_chapters;
create policy ark_chapters_read on public.ark_chapters for select to authenticated
  using (published or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists ark_chapters_admin on public.ark_chapters;
create policy ark_chapters_admin on public.ark_chapters for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists ark_pages_read on public.ark_chapter_pages;
create policy ark_pages_read on public.ark_chapter_pages for select to authenticated
  using (exists (select 1 from public.ark_chapters c where c.id = chapter_id));
drop policy if exists ark_pages_admin on public.ark_chapter_pages;
create policy ark_pages_admin on public.ark_chapter_pages for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists ark_progress_own on public.ark_reading_progress;
create policy ark_progress_own on public.ark_reading_progress for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.ark_chapters c where c.id = chapter_id
  ));

-- Bucket privado: páginas acessadas por URL assinada após autenticação.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ark-pages', 'ark-pages', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ark_storage_read on storage.objects;
create policy ark_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'ark-pages' and (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or exists (
      select 1 from public.ark_chapter_pages p where p.storage_path = name
    )
  ));
drop policy if exists ark_storage_insert on storage.objects;
create policy ark_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ark-pages' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and exists (select 1 from public.ark_chapters c where c.id::text = (storage.foldername(name))[1]));
drop policy if exists ark_storage_delete on storage.objects;
create policy ark_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ark-pages' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Nenhuma política concede edição de arquivos: envie caminhos únicos, sem upsert.
commit;
