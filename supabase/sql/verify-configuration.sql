-- Somente leitura: execute após as migrações no SQL Editor.
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname = 'public'
  and tablename in ('itens_catalogo', 'ark_chapters', 'ark_chapter_pages', 'ark_reading_progress')
order by tablename;

select tablename, policyname, roles, cmd
from pg_policies where schemaname = 'public'
  and tablename in ('itens_catalogo', 'ark_chapters', 'ark_chapter_pages', 'ark_reading_progress')
order by tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'ark-pages';

select email, email_confirmed_at is not null as email_confirmed,
  raw_app_meta_data ->> 'role' as application_role
from auth.users where lower(email) = 'mrogerio4578@gmail.com';
