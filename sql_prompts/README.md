# Supabase SQL Prompts for Multi-Domain RAG

Paste the files in this folder into Supabase SQL Editor in order.

## Run Order

1. `00_extensions.sql`
2. `01_tables.sql`
3. `02_triggers_indexes.sql`
4. `03_hybrid_search_functions.sql`
5. `04_rls_policies.sql`
6. `05_admin_document_registry.sql`
7. `06_worker_jobs_staging.sql`
8. `07_admin_audit_logs.sql`
9. `08_section_index_staging.sql`
10. `09_drop_tracking_tables_for_direct_ingestion.sql` (optional: use when switching to direct ingestion mode)
11. `10_structured_legal_ingestion.sql` (required for hierarchy-aware ingestion metadata)
12. `11_mindmap_storage.sql` (required for persistent legal mindmap history)

## Notes

- Embedding dimension is set to `vector(768)` (works with `nomic-embed-text` in Ollama).
- If you use a different embedding model, update all `vector(768)` declarations before running.
- Parent nodes can be stored in the same chunk tables with `embedding = NULL`.
- Child nodes should have embeddings and `parent_id` set.
- `relationships` and `entities` are indexed for graph-style metadata lookups.
- In direct-ingestion mode, only the domain chunk tables are required; worker/job/document/audit tables can be dropped using `09_drop_tracking_tables_for_direct_ingestion.sql`.
