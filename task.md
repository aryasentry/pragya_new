# Governance RAG Build Tasks

## Phase 1 - Data Layer and Retrieval Foundation

- [x] Create Supabase SQL prompt bundle for extensions, schema, indexes, hybrid search, and RLS.
- [x] Add admin document registry SQL with domain-aware document lifecycle helpers.
- [x] Add worker batch/job + pending chunk staging SQL with admin approval gate.
- [ ] Build ingestion modules in Next.js server for hierarchical chunking and metadata extraction.
- [ ] Build embedding pipeline using Ollama embeddings and Supabase insert/upsert.
- [ ] Build router LLM module that returns one of: citizen_law, hr_law, company_law.
- [ ] Build hybrid retrieval service (vector + BM25 + metadata filter + parent retrieval).
- [ ] Build Redis memory service keyed by chat:{userId}.
- [ ] Build chat server action tying router, memory, retrieval, and answer generation.
- [ ] Build admin portal pages/actions for upload, parse preview, ingest, list, delete, and re-embed.
- [ ] Add integration tests for route selection, retrieval relevance, and memory behavior.

## SQL Prompt Folder

- sql_prompts/00_extensions.sql
- sql_prompts/01_tables.sql
- sql_prompts/02_triggers_indexes.sql
- sql_prompts/03_hybrid_search_functions.sql
- sql_prompts/04_rls_policies.sql
- sql_prompts/05_admin_document_registry.sql
- sql_prompts/06_worker_jobs_staging.sql
- sql_prompts/07_admin_audit_logs.sql
- sql_prompts/08_section_index_staging.sql
