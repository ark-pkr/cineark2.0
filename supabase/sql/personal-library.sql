begin;
create table public.ark_user_library (
 user_id uuid not null references auth.users(id) on delete cascade,
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 status text not null default 'pretendo' check(status in ('lendo','lido','pretendo')),
 favorite boolean not null default false,
 primary key(user_id,work_id)
);
create index ark_user_library_work_idx on public.ark_user_library(work_id);
alter table public.ark_user_library enable row level security;
revoke all on public.ark_user_library from anon,authenticated;
grant select,insert,update,delete on public.ark_user_library to authenticated;
create policy own_library on public.ark_user_library for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table public.ark_read_history (
 user_id uuid not null references auth.users(id) on delete cascade,
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 source text not null check(source in ('remote','mangadex')),
 chapter_id text not null check(length(chapter_id) between 1 and 120),
 chapter_number text not null default '' check(length(chapter_number)<=80),
 read_at timestamptz not null default now(),
 primary key(user_id,work_id,source,chapter_id)
);
create index ark_read_history_work_idx on public.ark_read_history(work_id);
alter table public.ark_read_history enable row level security;
revoke all on public.ark_read_history from anon,authenticated;
grant select,insert on public.ark_read_history to authenticated;
create policy own_history_read on public.ark_read_history for select to authenticated using ((select auth.uid())=user_id);
create policy own_history_insert on public.ark_read_history for insert to authenticated with check ((select auth.uid())=user_id);
alter table public.itens_catalogo add column author text not null default '' check(length(author)<=500);
alter table public.itens_catalogo add column genres text[] not null default '{}';
alter table public.itens_catalogo add column reading_language text not null default 'pt-br' check(reading_language in ('pt-br','pt','en','es','es-la','fr','de','it','ja','ko','zh','zh-hk'));
alter table public.ark_mangadex_progress drop constraint ark_mangadex_progress_language_check;
alter table public.ark_mangadex_progress add constraint ark_mangadex_progress_language_check check(language in ('pt-br','pt','en','es','es-la','fr','de','it','ja','ko','zh','zh-hk'));
notify pgrst,'reload schema';
commit;
