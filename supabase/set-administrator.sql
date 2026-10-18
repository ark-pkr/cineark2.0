-- Execute somente depois de cadastrar e confirmar este e-mail no aplicativo.
-- Não cria contas, não define senhas e não promove outros leitores.
begin;
do $admin$
declare affected integer;
begin
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
    where lower(email) = 'mrogerio4578@gmail.com' and email_confirmed_at is not null;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Cadastre e confirme mrogerio4578@gmail.com antes de executar este arquivo.';
  end if;
end $admin$;
commit;
-- Após executar, saia do aplicativo e entre novamente para renovar a sessão.
