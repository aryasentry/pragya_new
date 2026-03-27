begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rag_domain') then
    create type public.rag_domain as enum ('citizen_law', 'hr_law', 'company_law');
  end if;

  if not exists (select 1 from pg_type where typname = 'rag_source_type') then
    create type public.rag_source_type as enum ('pdf', 'docx', 'txt', 'image');
  end if;
end
$$;

create table if not exists public.ingested_documents (
  id uuid primary key default gen_random_uuid(),
  domain public.rag_domain not null,
  document_name text not null,
  source_type public.rag_source_type not null,
  checksum text,
  status text not null default 'uploaded',
  uploaded_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain, document_name)
);

create index if not exists ingested_documents_domain_idx on public.ingested_documents(domain);
create index if not exists ingested_documents_created_at_idx on public.ingested_documents(created_at desc);
create index if not exists ingested_documents_status_idx on public.ingested_documents(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ingested_documents_set_updated_at on public.ingested_documents;
create trigger ingested_documents_set_updated_at
before update on public.ingested_documents
for each row execute function public.set_updated_at();

create or replace function public.list_documents_by_domain(p_domain public.rag_domain)
returns setof public.ingested_documents
language sql
stable
as $$
  select *
  from public.ingested_documents d
  where d.domain = p_domain
  order by d.created_at desc;
$$;

create or replace function public.mark_document_reembed_pending(
  p_domain public.rag_domain,
  p_document_name text
)
returns void
language sql
as $$
  update public.ingested_documents
  set status = 'embedding_pending'
  where domain = p_domain
    and document_name = p_document_name;
$$;

create or replace function public.delete_document_chunks(
  p_domain public.rag_domain,
  p_document_name text
)
returns void
language plpgsql
as $$
begin
  if p_domain = 'citizen_law' then
    delete from public.citizen_chunks where document_name = p_document_name;
  elsif p_domain = 'hr_law' then
    delete from public.hr_chunks where document_name = p_document_name;
  elsif p_domain = 'company_law' then
    delete from public.company_chunks where document_name = p_document_name;
  end if;

  delete from public.ingested_documents
  where domain = p_domain
    and document_name = p_document_name;
end;
$$;

alter table public.ingested_documents enable row level security;

drop policy if exists ingested_documents_select_policy on public.ingested_documents;
create policy ingested_documents_select_policy on public.ingested_documents
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingested_documents_insert_policy on public.ingested_documents;
create policy ingested_documents_insert_policy on public.ingested_documents
for insert to authenticated
with check (public.has_domain_access(domain::text));

drop policy if exists ingested_documents_update_policy on public.ingested_documents;
create policy ingested_documents_update_policy on public.ingested_documents
for update to authenticated
using (public.has_domain_access(domain::text))
with check (public.has_domain_access(domain::text));

drop policy if exists ingested_documents_delete_policy on public.ingested_documents;
create policy ingested_documents_delete_policy on public.ingested_documents
for delete to authenticated
using (public.has_domain_access(domain::text));

grant select, insert, update, delete on public.ingested_documents to authenticated;

commit;
