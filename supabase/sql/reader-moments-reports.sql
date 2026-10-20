create table public.ark_reader_moments (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 source text not null check(source in ('remote','mangadex')),
 chapter_id text not null check(length(chapter_id) between 1 and 120),
 chapter_number text not null default '' check(length(chapter_number)<=40),
 page_index integer not null check(page_index between 0 and 10000),
 page_offset double precision not null default 0 check(page_offset between 0 and 1),
 label text not null check(length(btrim(label)) between 1 and 80),
 manga_id text check(length(manga_id)<=120),
 language text check(length(language)<=20),
 created_at timestamptz not null default now(),
 primary key(user_id,id),
 unique(user_id,work_id,source,chapter_id,page_index)
);
create index ark_reader_moments_work_idx on public.ark_reader_moments(work_id);
alter table public.ark_reader_moments enable row level security;
revoke all on public.ark_reader_moments from anon,authenticated;
grant select,insert,update,delete on public.ark_reader_moments to authenticated;
create policy reader_moments_own on public.ark_reader_moments for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create table public.ark_reader_reports (
 id uuid primary key default gen_random_uuid(),
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 source text not null check(source in ('remote','mangadex')),
 chapter_id text not null check(length(chapter_id) between 1 and 120),
 chapter_number text not null default '' check(length(chapter_number)<=40),
 page_index integer not null check(page_index between 0 and 10000),
 category text not null check(category in ('missing','order','wrong','other')),
 details text not null default '' check(length(details)<=500),
 status text not null default 'open' check(status in ('open','resolved')),
 created_at timestamptz not null default now()
);
create index ark_reader_reports_work_idx on public.ark_reader_reports(work_id);
create index ark_reader_reports_queue_idx on public.ark_reader_reports(status,created_at desc);
alter table public.ark_reader_reports enable row level security;
revoke all on public.ark_reader_reports from anon,authenticated;
grant insert(work_id,source,chapter_id,chapter_number,page_index,category,details) on public.ark_reader_reports to anon,authenticated;
grant select on public.ark_reader_reports to authenticated;
grant update(status) on public.ark_reader_reports to authenticated;
create policy reader_report_submit on public.ark_reader_reports for insert to anon,authenticated with check (
 status='open' and (source='mangadex' or exists(select 1 from public.ark_chapters c where c.id::text=chapter_id and c.work_id=ark_reader_reports.work_id and c.published))
);
create policy reader_report_admin_read on public.ark_reader_reports for select to authenticated using(((select auth.jwt())->'app_metadata'->>'role')='admin');
create policy reader_report_admin_update on public.ark_reader_reports for update to authenticated using(((select auth.jwt())->'app_metadata'->>'role')='admin') with check(((select auth.jwt())->'app_metadata'->>'role')='admin');

