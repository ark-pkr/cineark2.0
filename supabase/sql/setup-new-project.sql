-- CINE ARK: install schema, permissions and private storage in the NEW project.
-- Run this entire file in the Supabase SQL Editor.
-- Administrator promotion is separate: set-administrator.sql after confirming your account.
begin;

-- Source: create-catalog.sql
-- Primeiro passo APENAS em um projeto Supabase novo.
-- Não modifica uma tabela de catálogo que já exista e não importa dados do projeto antigo.

create table if not exists public.itens_catalogo (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  type text not null default 'Mangá' check (type in ('Mangá', 'Manhwa', 'Manhua')),
  poster text not null default '',
  synopsis text not null default '',
  mal_id integer,
  currentcount integer not null default 0 check (currentcount >= 0),
  totalcount integer not null default 0 check (totalcount >= 0),
  rating numeric not null default 10 check (rating >= 0 and rating <= 10),
  status text not null default 'lendo' check (status in ('lendo', 'lido', 'pretendo')),
  created_at timestamptz not null default now()
);
create index if not exists itens_catalogo_created_at_idx on public.itens_catalogo(created_at desc);
alter table public.itens_catalogo enable row level security;
-- As políticas são aplicadas em reader-access.sql. Sem elas, RLS bloqueia o acesso.

-- Source: reader-access.sql
-- Execute no SQL Editor do projeto Supabase antes de abrir o cadastro público.
-- Substitui as políticas existentes do catálogo para separar leitores e administradores.

alter table public.itens_catalogo enable row level security;
do $$
declare policy_record record;
begin
  for policy_record in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'itens_catalogo'
  loop
    execute format('drop policy %I on public.itens_catalogo', policy_record.policyname);
  end loop;
end $$;
grant select on public.itens_catalogo to anon, authenticated;
grant insert, update, delete on public.itens_catalogo to authenticated;
create policy catalog_read on public.itens_catalogo for select to anon, authenticated using (true);
create policy catalog_admin_insert on public.itens_catalogo for insert to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy catalog_admin_update on public.itens_catalogo for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy catalog_admin_delete on public.itens_catalogo for delete to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Para promover uma conta já cadastrada, execute separadamente após substituir o e-mail:
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- where email = 'SEU_EMAIL_ADMIN';
-- Saia e entre novamente para renovar as permissões da sessão.

-- Source: chapters-storage.sql
-- Execute depois de reader-access.sql no mesmo projeto do catálogo.
-- Não publica capítulos existentes nem envia arquivos locais automaticamente.

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

-- Source: catalog-metadata.sql
-- Atualização do catálogo existente: execute uma vez no SQL Editor.
-- Mantém obras, capítulos, progresso e políticas atuais.

alter table public.itens_catalogo add column if not exists synopsis text not null default '';
alter table public.itens_catalogo add column if not exists mal_id integer;
comment on column public.itens_catalogo.synopsis is 'Sinopse editável, importada da Jikan ou preenchida pelo administrador.';
comment on column public.itens_catalogo.mal_id is 'Identificador opcional do mangá no MyAnimeList/Jikan.';
notify pgrst, 'reload schema';

commit;
