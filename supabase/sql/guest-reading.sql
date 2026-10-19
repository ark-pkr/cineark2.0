-- Optional accounts: visitors can read published chapters and their pages only.
grant select on public.ark_chapters, public.ark_chapter_pages to anon;
drop policy if exists ark_chapters_guest_read on public.ark_chapters;
create policy ark_chapters_guest_read on public.ark_chapters for select to anon using (published);
drop policy if exists ark_pages_guest_read on public.ark_chapter_pages;
create policy ark_pages_guest_read on public.ark_chapter_pages for select to anon using (exists (select 1 from public.ark_chapters c where c.id = chapter_id and c.published));
drop policy if exists ark_storage_guest_read on storage.objects;
create policy ark_storage_guest_read on storage.objects for select to anon using (bucket_id = 'ark-pages' and exists (select 1 from public.ark_chapter_pages p join public.ark_chapters c on c.id=p.chapter_id where p.storage_path=name and c.published));
