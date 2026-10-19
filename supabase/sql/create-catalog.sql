-- Primeiro passo APENAS em um projeto Supabase novo.
-- Não modifica uma tabela de catálogo que já exista e não importa dados do projeto antigo.
begin;
create table if not exists public.itens_catalogo (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  type text not null default 'Mangá' check (type in ('Mangá', 'Manhwa', 'Manhua')),
  poster text not null default '',
  synopsis text not null default '',
  mal_id integer,
  currentcount integer not null default 0 check (currentcount >= 0),
  totalcount integer not null default 0 check (totalcount >= 0),
  rating numeric not null default 10 check (rating >= 0 and rating <= 10),
  status text not null default 'lendo' check (status in ('lendo', 'lido', 'pretendo')),
  created_at timestamptz not null default now()
);
create index if not exists itens_catalogo_created_at_idx on public.itens_catalogo(created_at desc);
alter table public.itens_catalogo enable row level security;
-- As políticas são aplicadas em reader-access.sql. Sem elas, RLS bloqueia o acesso.
commit;
