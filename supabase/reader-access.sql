-- Execute no SQL Editor do projeto Supabase antes de abrir o cadastro público.
-- Substitui as políticas existentes do catálogo para separar leitores e administradores.
begin;
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
commit;

-- Para promover uma conta já cadastrada, execute separadamente após substituir o e-mail:
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- where email = 'SEU_EMAIL_ADMIN';
-- Saia e entre novamente para renovar as permissões da sessão.
