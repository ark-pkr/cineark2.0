alter table public.ark_chapters add column content_revision bigint not null default 1 check(content_revision>0);
alter table public.ark_chapters add column content_updated_at timestamptz;
alter table public.ark_read_history add column chapter_revision bigint not null default 1 check(chapter_revision>0);
grant update on public.ark_read_history to authenticated;
create policy own_history_update on public.ark_read_history for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create function ark_private.chapter_metadata_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.title is distinct from old.title or new.number is distinct from old.number then
  new.content_revision=old.content_revision+1;new.content_updated_at=clock_timestamp();
 end if;return new;
end $$;
revoke all on function ark_private.chapter_metadata_revision() from public,anon,authenticated;
create trigger chapter_metadata_revision before update on public.ark_chapters for each row execute function ark_private.chapter_metadata_revision();
create function ark_private.chapter_pages_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  update public.ark_chapters set content_revision=content_revision+1,content_updated_at=clock_timestamp() where id in (select distinct chapter_id from changed_new);
 elsif TG_OP='DELETE' then
  update public.ark_chapters set content_revision=content_revision+1,content_updated_at=clock_timestamp() where id in (select distinct chapter_id from changed_old);
 else
  update public.ark_chapters set content_revision=content_revision+1,content_updated_at=clock_timestamp() where id in (
   select chapter_id from (select chapter_id,page_index,storage_path,width,height from changed_new except select chapter_id,page_index,storage_path,width,height from changed_old) n
   union select chapter_id from (select chapter_id,page_index,storage_path,width,height from changed_old except select chapter_id,page_index,storage_path,width,height from changed_new) o
  );
 end if;return null;
end $$;
revoke all on function ark_private.chapter_pages_revision() from public,anon,authenticated;
create trigger chapter_pages_insert_revision after insert on public.ark_chapter_pages referencing new table as changed_new for each statement execute function ark_private.chapter_pages_revision();
create trigger chapter_pages_update_revision after update on public.ark_chapter_pages referencing old table as changed_old new table as changed_new for each statement execute function ark_private.chapter_pages_revision();
create trigger chapter_pages_delete_revision after delete on public.ark_chapter_pages referencing old table as changed_old for each statement execute function ark_private.chapter_pages_revision();
