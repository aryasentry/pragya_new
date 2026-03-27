# Build Log

## 2026-03-26

- Created SQL prompt folder: `sql_prompts`.
- Added Supabase execution guide: `sql_prompts/README.md`.
- Added extension bootstrap SQL for `vector`, `pg_trgm`, `unaccent`, `pgcrypto`.
- Added per-domain chunk tables: `citizen_chunks`, `hr_chunks`, `company_chunks`.
- Added hierarchical parent foreign keys (`parent_id`) per domain table.
- Added weighted full-text trigger and BM25-ready `tsv` generation.
- Added indexes for vector search, BM25, parent lookup, metadata JSON, and recency.
- Added hybrid search RPCs with metadata filters and parent-content join.
- Added parent-context and entity-based related-chunk expansion functions.
- Added domain-aware RLS with roles: `super_admin`, `citizen_admin`, `hr_admin`, `company_admin`.
- Added document registry table and lifecycle helper SQL for list/delete/re-embed.
- Added ingestion batch and worker job tables for batch document uploads.
- Added temporary pending chunk table keyed by worker job and chunk ref IDs.
- Added SQL helpers to submit jobs for approval, approve to final domain tables, and reject.
- Added RLS policies and grants for ingestion staging tables.
- Added domain-scoped admin audit log table with indexes and RLS.
- Added ingestion section-index staging table to persist extracted section numbers/titles.
- Added `task.md` with phased implementation checklist.
