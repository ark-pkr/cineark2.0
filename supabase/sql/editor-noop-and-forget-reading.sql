create or replace function public.ark_edit_chapter(p_chapter uuid,p_revision bigint,p_number numeric,p_title text,p_pages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.ark_chapters; item jsonb; i integer:=0;
begin
 if coalesce((auth.jwt()->'app_metadata'->>'role'),'')<>'admin' then raise exception 'Administrador necessário' using errcode='42501';end if;
 select * into c from public.ark_chapters where id=p_chapter for update;
 if not found or c.archived_at is not null then raise exception 'Capítulo indisponível';end if;
 if c.content_revision<>p_revision then raise exception 'Este capítulo foi alterado. Reabra o editor para revisar a versão atual.' using errcode='40001';end if;
 if p_number is null or p_number<=0 or p_number>=1000000 or p_title is null or length(p_title)>160 then raise exception 'Número ou título inválido';end if;
 if jsonb_typeof(p_pages) is distinct from 'array' or jsonb_array_length(p_pages) not between 1 and 1000 then raise exception 'Selecione de 1 a 1000 páginas';end if;
 if (select count(distinct value->>'storage_path') from jsonb_array_elements(p_pages))<>jsonb_array_length(p_pages) then raise exception 'Páginas duplicadas';end if;
 for item in select value from jsonb_array_elements(p_pages) loop
  if item->>'storage_path' is null or left(item->>'storage_path',37)<>p_chapter::text||'/' or (item->>'storage_path') like '%..%' or (item->>'storage_path') !~ ('^'||p_chapter::text||'/[A-Za-z0-9_.-]+$') then raise exception 'Arquivo fora deste capítulo';end if;
  if coalesce((item->>'width')::integer,0) not between 1 and 50000 or coalesce((item->>'height')::integer,0) not between 1 and 50000 then raise exception 'Dimensões inválidas';end if;
  if not exists(select 1 from storage.objects where bucket_id='ark-pages' and name=item->>'storage_path') then raise exception 'Arquivo não enviado';end if;
 end loop;
 if p_number=c.number and btrim(p_title)=c.title and p_pages=coalesce((select jsonb_agg(jsonb_build_object('storage_path',storage_path,'width',width,'height',height) order by page_index) from public.ark_chapter_pages where chapter_id=p_chapter),'[]'::jsonb) then return jsonb_build_object('id',c.id,'content_revision',c.content_revision);end if;
 delete from public.ark_chapter_pages where chapter_id=p_chapter;
 for item in select value from jsonb_array_elements(p_pages) loop
  insert into public.ark_chapter_pages(chapter_id,page_index,storage_path,width,height) values(p_chapter,i,item->>'storage_path',(item->>'width')::integer,(item->>'height')::integer);i:=i+1;
 end loop;
 update public.ark_chapters set number=p_number,title=btrim(p_title) where id=p_chapter;
 select * into c from public.ark_chapters where id=p_chapter;
 return jsonb_build_object('id',c.id,'content_revision',c.content_revision);
end $$;

create function public.ark_forget_reading(p_work uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre na conta' using errcode='42501';end if;
 delete from public.ark_reading_progress where user_id=auth.uid() and work_id=p_work;
 delete from public.ark_mangadex_progress where user_id=auth.uid() and work_id=p_work;
end $$;
revoke all on function public.ark_forget_reading(uuid) from public,anon,authenticated;
grant execute on function public.ark_forget_reading(uuid) to authenticated;
