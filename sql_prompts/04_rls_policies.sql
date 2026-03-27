begin;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

create or replace function public.has_domain_access(p_domain text)
returns boolean
language sql
stable
as $$
  select case
    when public.current_app_role() = 'super_admin' then true
    when p_domain = 'citizen_law' and public.current_app_role() = 'citizen_admin' then true
    when p_domain = 'hr_law' and public.current_app_role() = 'hr_admin' then true
    when p_domain = 'company_law' and public.current_app_role() = 'company_admin' then true
    else false
  end;
$$;

alter table public.citizen_chunks enable row level security;
alter table public.hr_chunks enable row level security;
alter table public.company_chunks enable row level security;

drop policy if exists citizen_chunks_select_policy on public.citizen_chunks;
create policy citizen_chunks_select_policy on public.citizen_chunks
for select to authenticated
using (public.has_domain_access('citizen_law'));

drop policy if exists citizen_chunks_insert_policy on public.citizen_chunks;
create policy citizen_chunks_insert_policy on public.citizen_chunks
for insert to authenticated
with check (public.has_domain_access('citizen_law'));

drop policy if exists citizen_chunks_update_policy on public.citizen_chunks;
create policy citizen_chunks_update_policy on public.citizen_chunks
for update to authenticated
using (public.has_domain_access('citizen_law'))
with check (public.has_domain_access('citizen_law'));

drop policy if exists citizen_chunks_delete_policy on public.citizen_chunks;
create policy citizen_chunks_delete_policy on public.citizen_chunks
for delete to authenticated
using (public.has_domain_access('citizen_law'));

drop policy if exists hr_chunks_select_policy on public.hr_chunks;
create policy hr_chunks_select_policy on public.hr_chunks
for select to authenticated
using (public.has_domain_access('hr_law'));

drop policy if exists hr_chunks_insert_policy on public.hr_chunks;
create policy hr_chunks_insert_policy on public.hr_chunks
for insert to authenticated
with check (public.has_domain_access('hr_law'));

drop policy if exists hr_chunks_update_policy on public.hr_chunks;
create policy hr_chunks_update_policy on public.hr_chunks
for update to authenticated
using (public.has_domain_access('hr_law'))
with check (public.has_domain_access('hr_law'));

drop policy if exists hr_chunks_delete_policy on public.hr_chunks;
create policy hr_chunks_delete_policy on public.hr_chunks
for delete to authenticated
using (public.has_domain_access('hr_law'));

drop policy if exists company_chunks_select_policy on public.company_chunks;
create policy company_chunks_select_policy on public.company_chunks
for select to authenticated
using (public.has_domain_access('company_law'));

drop policy if exists company_chunks_insert_policy on public.company_chunks;
create policy company_chunks_insert_policy on public.company_chunks
for insert to authenticated
with check (public.has_domain_access('company_law'));

drop policy if exists company_chunks_update_policy on public.company_chunks;
create policy company_chunks_update_policy on public.company_chunks
for update to authenticated
using (public.has_domain_access('company_law'))
with check (public.has_domain_access('company_law'));

drop policy if exists company_chunks_delete_policy on public.company_chunks;
create policy company_chunks_delete_policy on public.company_chunks
for delete to authenticated
using (public.has_domain_access('company_law'));

grant usage, select on all sequences in schema public to authenticated;
grant select, insert, update, delete on public.citizen_chunks to authenticated;
grant select, insert, update, delete on public.hr_chunks to authenticated;
grant select, insert, update, delete on public.company_chunks to authenticated;

commit;
