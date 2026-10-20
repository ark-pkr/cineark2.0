alter table public.itens_catalogo add column reaction_config jsonb not null default '{"profile":"auto","labels":{}}'::jsonb;
alter table public.itens_catalogo add constraint itens_reaction_config_valid check (
 jsonb_typeof(reaction_config)='object' and
 reaction_config->>'profile' in ('auto','acao','romance','terror','comedia') and
 jsonb_typeof(reaction_config->'labels')='object' and
 octet_length(reaction_config::text)<=1500 and
 (not (reaction_config->'labels' ? 'epico') or (jsonb_typeof(reaction_config->'labels'->'epico')='string' and length(reaction_config->'labels'->>'epico')<=32)) and
 (not (reaction_config->'labels' ? 'surpreendente') or (jsonb_typeof(reaction_config->'labels'->'surpreendente')='string' and length(reaction_config->'labels'->>'surpreendente')<=32)) and
 (not (reaction_config->'labels' ? 'emocionante') or (jsonb_typeof(reaction_config->'labels'->'emocionante')='string' and length(reaction_config->'labels'->>'emocionante')<=32)) and
 (not (reaction_config->'labels' ? 'fofo') or (jsonb_typeof(reaction_config->'labels'->'fofo')='string' and length(reaction_config->'labels'->>'fofo')<=32)) and
 (not (reaction_config->'labels' ? 'tenso') or (jsonb_typeof(reaction_config->'labels'->'tenso')='string' and length(reaction_config->'labels'->>'tenso')<=32)) and
 (not (reaction_config->'labels' ? 'engracado') or (jsonb_typeof(reaction_config->'labels'->'engracado')='string' and length(reaction_config->'labels'->>'engracado')<=32))
);
alter table public.ark_chapter_reactions drop constraint ark_chapter_reactions_reaction_check;
alter table public.itens_catalogo add constraint itens_reaction_config_shape check (
 reaction_config ?& array['profile','labels'] and
 reaction_config - 'profile' - 'labels' = '{}'::jsonb and
 (reaction_config->'labels') - 'epico' - 'surpreendente' - 'emocionante' - 'fofo' - 'tenso' - 'engracado' = '{}'::jsonb
);
alter table public.ark_chapter_reactions add constraint ark_chapter_reactions_reaction_check check(reaction in ('epico','surpreendente','emocionante','fofo','tenso','engracado'));
create table public.ark_chapter_reaction_counts (
 work_id uuid not null references public.itens_catalogo(id) on delete cascade,
 source text not null check(source in ('remote','mangadex')),
 chapter_id text not null,
 reaction text not null,
 total bigint not null check(total>=0),
 primary key(work_id,source,chapter_id,reaction)
);
alter table public.ark_chapter_reaction_counts enable row level security;
create policy reaction_counts_read on public.ark_chapter_reaction_counts for select to anon,authenticated using(true);
revoke all on public.ark_chapter_reaction_counts from anon,authenticated;
grant select on public.ark_chapter_reaction_counts to anon,authenticated;
create schema if not exists ark_private;
revoke all on schema ark_private from public,anon,authenticated;
create function ark_private.update_reaction_counts() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and (old.work_id,old.source,old.chapter_id,old.reaction)=(new.work_id,new.source,new.chapter_id,new.reaction) then return new; end if;
 if TG_OP in ('DELETE','UPDATE') then
  update public.ark_chapter_reaction_counts set total=total-1
   where work_id=old.work_id and source=old.source and chapter_id=old.chapter_id and reaction=old.reaction and total>0;
 end if;
 if TG_OP in ('INSERT','UPDATE') then
  insert into public.ark_chapter_reaction_counts(work_id,source,chapter_id,reaction,total)
   values(new.work_id,new.source,new.chapter_id,new.reaction,1)
   on conflict(work_id,source,chapter_id,reaction) do update set total=public.ark_chapter_reaction_counts.total+1;
 end if;
 return null;
end $$;
revoke all on function ark_private.update_reaction_counts() from public,anon,authenticated;
lock table public.ark_chapter_reactions in share row exclusive mode;
insert into public.ark_chapter_reaction_counts select work_id,source,chapter_id,reaction,count(*) from public.ark_chapter_reactions group by work_id,source,chapter_id,reaction;
create trigger ark_reaction_counts_after after insert or update or delete on public.ark_chapter_reactions for each row execute function ark_private.update_reaction_counts();

