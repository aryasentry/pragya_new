begin;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  domain public.rag_domain not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_domain_idx on public.admin_audit_logs(domain);
create index if not exists admin_audit_logs_action_idx on public.admin_audit_logs(action);
create index if not exists admin_audit_logs_created_at_idx on public.admin_audit_logs(created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists admin_audit_logs_select_policy on public.admin_audit_logs;
create policy admin_audit_logs_select_policy on public.admin_audit_logs
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists admin_audit_logs_insert_policy on public.admin_audit_logs;
create policy admin_audit_logs_insert_policy on public.admin_audit_logs
for insert to authenticated
with check (public.has_domain_access(domain::text));

grant select, insert on public.admin_audit_logs to authenticated;

commit;
