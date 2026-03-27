begin;

create table if not exists public.ingestion_section_index (
  id bigserial primary key,
  job_id uuid not null references public.ingestion_worker_jobs(id) on delete cascade,
  domain public.rag_domain not null,
  document_name text not null,
  section_number text not null,
  section_title text not null,
  page_hint int,
  created_at timestamptz not null default now(),
  unique (job_id, section_number, section_title)
);

create index if not exists ingestion_section_index_job_idx on public.ingestion_section_index(job_id);
create index if not exists ingestion_section_index_domain_idx on public.ingestion_section_index(domain);
create index if not exists ingestion_section_index_document_idx on public.ingestion_section_index(document_name);
create index if not exists ingestion_section_index_number_idx on public.ingestion_section_index(section_number);

alter table public.ingestion_section_index enable row level security;

drop policy if exists ingestion_section_index_select_policy on public.ingestion_section_index;
create policy ingestion_section_index_select_policy on public.ingestion_section_index
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_section_index_insert_policy on public.ingestion_section_index;
create policy ingestion_section_index_insert_policy on public.ingestion_section_index
for insert to authenticated
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_section_index_update_policy on public.ingestion_section_index;
create policy ingestion_section_index_update_policy on public.ingestion_section_index
for update to authenticated
using (public.has_domain_access(domain::text))
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_section_index_delete_policy on public.ingestion_section_index;
create policy ingestion_section_index_delete_policy on public.ingestion_section_index
for delete to authenticated
using (public.has_domain_access(domain::text));

grant select, insert, update, delete on public.ingestion_section_index to authenticated;
grant usage, select on sequence public.ingestion_section_index_id_seq to authenticated;

commit;
