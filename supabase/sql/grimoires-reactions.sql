create table public.ark_grimoires (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 60),
 work_ids uuid[] not null default '{}' check (cardinality(work_ids)<=200 and array_position(work_ids,null) is null),
 created_at timestamptz not null default now(),
 primary key(user_id,id)
);
alter table public.ark_grimoires enable row level security;
create policy ark_grimoires_own on public.ark_grimoires for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.ark_grimoires to authenticated;
revoke all on public.ark_grimoires from anon;
create table public.ark_chapter_reactions (
 user_id uuid not null references auth.users(id) on delete cascade,
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 source text not null check (source in ('remote','mangadex')),
 chapter_id text not null check(length(chapter_id) between 1 and 120),
 reaction text not null check(reaction in ('epico','surpreendente','emocionante')),
 primary key(user_id,work_id,source,chapter_id)
);
create index ark_chapter_reactions_work_idx on public.ark_chapter_reactions(work_id);
alter table public.ark_chapter_reactions enable row level security;
create policy ark_chapter_reactions_own on public.ark_chapter_reactions for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.ark_chapter_reactions to authenticated;
revoke all on public.ark_chapter_reactions from anon;
