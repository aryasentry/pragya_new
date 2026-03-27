begin;

-- Remove workflow/state tracking that is not needed in direct ingestion mode.
drop function if exists public.start_ingestion_batch(public.rag_domain, uuid, int, jsonb);
drop function if exists public.enqueue_ingestion_job(uuid, public.rag_domain, text, public.rag_source_type, jsonb);
drop function if exists public.submit_worker_job_for_approval(uuid);
drop function if exists public.reject_worker_job(uuid, text);
drop function if exists public.approve_worker_job(uuid, uuid);
drop function if exists public.mark_document_reembed_pending(public.rag_domain, text);
drop function if exists public.list_documents_by_domain(public.rag_domain);

-- If you no longer want RPC delete wrapper, uncomment this line.
-- drop function if exists public.delete_document_chunks(public.rag_domain, text);

drop table if exists public.ingestion_section_index cascade;
drop table if exists public.ingestion_pending_chunks cascade;
drop table if exists public.ingestion_worker_jobs cascade;
drop table if exists public.ingestion_batches cascade;
drop table if exists public.admin_audit_logs cascade;
drop table if exists public.ingested_documents cascade;

commit;
