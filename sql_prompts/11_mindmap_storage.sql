begin;

create table if not exists public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  domain text not null check (domain in ('citizen_law', 'hr_law', 'company_law')),
  query text not null,
  action text not null check (action in ('generate', 'expand', 'define')),
  graph jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mindmaps_user_id_created_at_idx
  on public.mindmaps(user_id, created_at desc);

create index if not exists mindmaps_domain_created_at_idx
  on public.mindmaps(domain, created_at desc);

create index if not exists mindmaps_query_tsv_idx
  on public.mindmaps
  using gin(to_tsvector('english', coalesce(query, '')));

create index if not exists mindmaps_graph_idx
  on public.mindmaps
  using gin(graph jsonb_path_ops);

create or replace function public.set_mindmaps_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mindmaps_set_updated_at on public.mindmaps;
create trigger mindmaps_set_updated_at
before update on public.mindmaps
for each row execute function public.set_mindmaps_updated_at();

commit;
