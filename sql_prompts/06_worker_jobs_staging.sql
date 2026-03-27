begin;

create table if not exists public.ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  domain public.rag_domain not null,
  created_by uuid,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'awaiting_approval', 'approved', 'rejected', 'failed', 'cancelled')),
  total_files int not null default 0,
  completed_files int not null default 0,
  failed_files int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingestion_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ingestion_batches(id) on delete cascade,
  domain public.rag_domain not null,
  document_name text not null,
  source_type public.rag_source_type not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'awaiting_approval', 'approved', 'rejected', 'failed', 'cancelled')),
  total_chunks int not null default 0,
  processed_chunks int not null default 0,
  error_message text,
  approved_by uuid,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingestion_pending_chunks (
  id bigserial primary key,
  job_id uuid not null references public.ingestion_worker_jobs(id) on delete cascade,
  domain public.rag_domain not null,
  chunk_ref_id text not null,
  parent_ref_id text,
  content text not null,
  embedding vector(768),
  document_name text not null,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  entities jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, chunk_ref_id)
);

create index if not exists ingestion_batches_domain_idx on public.ingestion_batches(domain);
create index if not exists ingestion_batches_status_idx on public.ingestion_batches(status);
create index if not exists ingestion_batches_created_at_idx on public.ingestion_batches(created_at desc);

create index if not exists ingestion_worker_jobs_batch_id_idx on public.ingestion_worker_jobs(batch_id);
create index if not exists ingestion_worker_jobs_domain_idx on public.ingestion_worker_jobs(domain);
create index if not exists ingestion_worker_jobs_status_idx on public.ingestion_worker_jobs(status);
create index if not exists ingestion_worker_jobs_document_name_idx on public.ingestion_worker_jobs(document_name);
create index if not exists ingestion_worker_jobs_created_at_idx on public.ingestion_worker_jobs(created_at desc);

create index if not exists ingestion_pending_chunks_job_id_idx on public.ingestion_pending_chunks(job_id);
create index if not exists ingestion_pending_chunks_domain_idx on public.ingestion_pending_chunks(domain);
create index if not exists ingestion_pending_chunks_document_name_idx on public.ingestion_pending_chunks(document_name);
create index if not exists ingestion_pending_chunks_parent_ref_id_idx on public.ingestion_pending_chunks(parent_ref_id);
create index if not exists ingestion_pending_chunks_entities_idx on public.ingestion_pending_chunks using gin(entities jsonb_path_ops);
create index if not exists ingestion_pending_chunks_relationships_idx on public.ingestion_pending_chunks using gin(relationships jsonb_path_ops);

create or replace function public.start_ingestion_batch(
  p_domain public.rag_domain,
  p_created_by uuid,
  p_total_files int,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_batch_id uuid;
begin
  insert into public.ingestion_batches (domain, created_by, total_files, status, metadata)
  values (p_domain, p_created_by, greatest(p_total_files, 0), 'processing', coalesce(p_metadata, '{}'::jsonb))
  returning id into v_batch_id;

  return v_batch_id;
end;
$$;

create or replace function public.enqueue_ingestion_job(
  p_batch_id uuid,
  p_domain public.rag_domain,
  p_document_name text,
  p_source_type public.rag_source_type,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_job_id uuid;
begin
  insert into public.ingestion_worker_jobs (
    batch_id,
    domain,
    document_name,
    source_type,
    status,
    metadata
  )
  values (
    p_batch_id,
    p_domain,
    p_document_name,
    p_source_type,
    'processing',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.submit_worker_job_for_approval(
  p_job_id uuid
)
returns void
language plpgsql
as $$
declare
  v_chunk_count int;
  v_batch_id uuid;
begin
  select count(*)::int
  into v_chunk_count
  from public.ingestion_pending_chunks
  where job_id = p_job_id;

  update public.ingestion_worker_jobs
  set status = 'awaiting_approval',
      total_chunks = v_chunk_count,
      processed_chunks = v_chunk_count,
      updated_at = now()
  where id = p_job_id
  returning batch_id into v_batch_id;

  update public.ingestion_batches b
  set status = case
    when exists (
      select 1
      from public.ingestion_worker_jobs j
      where j.batch_id = b.id
        and j.status = 'awaiting_approval'
    ) then 'awaiting_approval'
    else b.status
  end,
  updated_at = now()
  where b.id = v_batch_id;
end;
$$;

create or replace function public.reject_worker_job(
  p_job_id uuid,
  p_error_message text default null
)
returns void
language plpgsql
as $$
declare
  v_batch_id uuid;
begin
  update public.ingestion_worker_jobs
  set status = 'rejected',
      error_message = p_error_message,
      updated_at = now()
  where id = p_job_id
  returning batch_id into v_batch_id;

  update public.ingestion_batches
  set failed_files = failed_files + 1,
      status = 'processing',
      updated_at = now()
  where id = v_batch_id;
end;
$$;

create or replace function public.approve_worker_job(
  p_job_id uuid,
  p_admin_id uuid
)
returns int
language plpgsql
as $$
declare
  v_domain public.rag_domain;
  v_document_name text;
  v_target_table text;
  v_new_id bigint;
  v_parent_id bigint;
  v_map jsonb := '{}'::jsonb;
  v_inserted_count int := 0;
  v_batch_id uuid;
  rec record;
begin
  select j.domain, j.document_name, j.batch_id
  into v_domain, v_document_name, v_batch_id
  from public.ingestion_worker_jobs j
  where j.id = p_job_id
    and j.status = 'awaiting_approval';

  if not found then
    raise exception 'Job not found or not awaiting approval: %', p_job_id;
  end if;

  if v_domain = 'citizen_law' then
    v_target_table := 'public.citizen_chunks';
  elsif v_domain = 'hr_law' then
    v_target_table := 'public.hr_chunks';
  else
    v_target_table := 'public.company_chunks';
  end if;

  for rec in
    select
      c.chunk_ref_id,
      c.parent_ref_id,
      c.content,
      c.embedding,
      c.document_name,
      c.section_name,
      c.section_number,
      c.title,
      c.description,
      c.ocr_text,
      c.image_description,
      c.entities,
      c.relationships,
      c.created_at
    from public.ingestion_pending_chunks c
    where c.job_id = p_job_id
    order by case when c.parent_ref_id is null then 0 else 1 end, c.id asc
  loop
    if rec.parent_ref_id is not null then
      v_parent_id := nullif(v_map ->> rec.parent_ref_id, '')::bigint;
      if v_parent_id is null then
        raise exception 'Missing parent mapping for ref_id: %', rec.parent_ref_id;
      end if;
    else
      v_parent_id := null;
    end if;

    execute format(
      'insert into %s (
         content,
         embedding,
         tsv,
         document_name,
         section_name,
         section_number,
         title,
         description,
         ocr_text,
         image_description,
         parent_id,
         child_id,
         entities,
         relationships,
         created_at
       )
       values (
         $1, $2, null, $3, $4, $5, $6, $7, $8, $9, $10, null, $11, $12, $13
       )
       returning id',
      v_target_table
    )
    into v_new_id
    using
      rec.content,
      rec.embedding,
      rec.document_name,
      rec.section_name,
      rec.section_number,
      rec.title,
      rec.description,
      rec.ocr_text,
      rec.image_description,
      v_parent_id,
      rec.entities,
      rec.relationships,
      rec.created_at;

    v_map := v_map || jsonb_build_object(rec.chunk_ref_id, v_new_id);
    v_inserted_count := v_inserted_count + 1;
  end loop;

  update public.ingestion_worker_jobs
  set status = 'approved',
      approved_by = p_admin_id,
      approved_at = now(),
      total_chunks = v_inserted_count,
      processed_chunks = v_inserted_count,
      updated_at = now()
  where id = p_job_id;

  insert into public.ingested_documents (
    domain,
    document_name,
    source_type,
    status,
    uploaded_by,
    metadata
  )
  select
    j.domain,
    j.document_name,
    j.source_type,
    'ingested',
    p_admin_id,
    j.metadata
  from public.ingestion_worker_jobs j
  where j.id = p_job_id
  on conflict (domain, document_name)
  do update
  set status = 'ingested',
      metadata = excluded.metadata,
      updated_at = now();

  delete from public.ingestion_pending_chunks
  where job_id = p_job_id;

  update public.ingestion_batches
  set completed_files = completed_files + 1,
      status = case
        when completed_files + 1 >= total_files then 'approved'
        else 'awaiting_approval'
      end,
      updated_at = now()
  where id = v_batch_id;

  return v_inserted_count;
end;
$$;

drop trigger if exists ingestion_batches_set_updated_at on public.ingestion_batches;
create trigger ingestion_batches_set_updated_at
before update on public.ingestion_batches
for each row execute function public.set_updated_at();

drop trigger if exists ingestion_worker_jobs_set_updated_at on public.ingestion_worker_jobs;
create trigger ingestion_worker_jobs_set_updated_at
before update on public.ingestion_worker_jobs
for each row execute function public.set_updated_at();

alter table public.ingestion_batches enable row level security;
alter table public.ingestion_worker_jobs enable row level security;
alter table public.ingestion_pending_chunks enable row level security;

drop policy if exists ingestion_batches_select_policy on public.ingestion_batches;
create policy ingestion_batches_select_policy on public.ingestion_batches
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_batches_insert_policy on public.ingestion_batches;
create policy ingestion_batches_insert_policy on public.ingestion_batches
for insert to authenticated
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_batches_update_policy on public.ingestion_batches;
create policy ingestion_batches_update_policy on public.ingestion_batches
for update to authenticated
using (public.has_domain_access(domain::text))
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_batches_delete_policy on public.ingestion_batches;
create policy ingestion_batches_delete_policy on public.ingestion_batches
for delete to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_worker_jobs_select_policy on public.ingestion_worker_jobs;
create policy ingestion_worker_jobs_select_policy on public.ingestion_worker_jobs
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_worker_jobs_insert_policy on public.ingestion_worker_jobs;
create policy ingestion_worker_jobs_insert_policy on public.ingestion_worker_jobs
for insert to authenticated
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_worker_jobs_update_policy on public.ingestion_worker_jobs;
create policy ingestion_worker_jobs_update_policy on public.ingestion_worker_jobs
for update to authenticated
using (public.has_domain_access(domain::text))
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_worker_jobs_delete_policy on public.ingestion_worker_jobs;
create policy ingestion_worker_jobs_delete_policy on public.ingestion_worker_jobs
for delete to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_pending_chunks_select_policy on public.ingestion_pending_chunks;
create policy ingestion_pending_chunks_select_policy on public.ingestion_pending_chunks
for select to authenticated
using (public.has_domain_access(domain::text));

drop policy if exists ingestion_pending_chunks_insert_policy on public.ingestion_pending_chunks;
create policy ingestion_pending_chunks_insert_policy on public.ingestion_pending_chunks
for insert to authenticated
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_pending_chunks_update_policy on public.ingestion_pending_chunks;
create policy ingestion_pending_chunks_update_policy on public.ingestion_pending_chunks
for update to authenticated
using (public.has_domain_access(domain::text))
with check (public.has_domain_access(domain::text));

drop policy if exists ingestion_pending_chunks_delete_policy on public.ingestion_pending_chunks;
create policy ingestion_pending_chunks_delete_policy on public.ingestion_pending_chunks
for delete to authenticated
using (public.has_domain_access(domain::text));

grant select, insert, update, delete on public.ingestion_batches to authenticated;
grant select, insert, update, delete on public.ingestion_worker_jobs to authenticated;
grant select, insert, update, delete on public.ingestion_pending_chunks to authenticated;
grant usage, select on sequence public.ingestion_pending_chunks_id_seq to authenticated;

commit;
