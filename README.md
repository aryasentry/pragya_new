# Pragya - Legal RAG Platform

Pragya is a multi-domain legal assistant with:
- domain-routed chat (`citizen_law`, `hr_law`, `company_law`)
- hybrid retrieval (BM25 + vector)
- hierarchy-aware legal ingestion
- interactive legal mindmaps with persistence

## Features

### User Chat
- Retrieval-grounded legal answers with citations
- Automatic domain routing via LLM
- Query variants + `topK=25` retrieval
- Supports optional image input context

### Admin Ingestion
- Domain-scoped ingestion by admin role (`citizen_admin`, `hr_admin`, `company_admin`)
- Structured parser for statute-style documents:
  - TOC split
  - chapter/section hierarchy
  - child-level chunking
- Validation before insert
- Live ingestion progress
- Stored file/chunk/embedding metrics
- Delete-by-document from selected domain

### Mindmap
- Build legal memory graph from query
- Uses retrieved chunks + on-demand relationship extraction
- Double-click node to expand
- Click node for preview + optional definition generation
- Saves graphs in DB (`mindmaps` table)
- Reopen saved graphs from chat

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Supabase (Postgres + pgvector + SQL functions)
- Ollama (LLM + embeddings)

---

## 1) Prerequisites

- Node.js 20+ (recommended)
- npm
- Supabase project (URL + service role key)
- Ollama running locally or reachable via URL

---

## 2) Installation (Windows)

### 2.1 Clone and install app deps
```powershell
cd C:\path\to\pragya_new\app
npm install
```

### 2.2 Install Ollama models
```powershell
ollama pull qwen2.5:1.5b
ollama pull qwen3-embedding:0.6b
```

---

## 3) Environment Variables

Create/update `app/.env`:

```env
# LLM / Embeddings
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:1.5b
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
OLLAMA_EMBEDDING_DIMENSION=768

# Supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Optional image analysis
GROQ_API_KEY=
GROQ_TEXT_MODEL=llama-3.3-70b-versatile

# Redis (optional; app has fallback behavior for some paths)
REDIS_URL=redis://127.0.0.1:6379
```

---

## 4) Database Setup (Supabase SQL)

Run SQL files in order from `sql_prompts/README.md`:

1. `00_extensions.sql`
2. `01_tables.sql`
3. `02_triggers_indexes.sql`
4. `03_hybrid_search_functions.sql`
5. `04_rls_policies.sql`
6. `05_admin_document_registry.sql`
7. `06_worker_jobs_staging.sql`
8. `07_admin_audit_logs.sql`
9. `08_section_index_staging.sql`
10. `09_drop_tracking_tables_for_direct_ingestion.sql` (optional)
11. `10_structured_legal_ingestion.sql` (required)
12. `11_mindmap_storage.sql` (required for saved mindmaps)

---

## 5) Run the App

```powershell
cd C:\path\to\pragya_new\app
npm run dev
```

Open:
- `http://localhost:3000`

---

## 6) Operational Notes

- Admin portal domain is selected by admin email:
  - `citizen_admin@pragya.local` -> `citizen_law`
  - `hr_admin@pragya.local` -> `hr_law`
  - `company_admin@pragya.local` -> `company_law`
- Uploaded documents are written to that selected domain chunk table.
- Mindmaps are persisted in `public.mindmaps`.

---

## 7) Quick Verification Checklist

### Core services
```powershell
ollama list
```

### App
1. Open landing page
2. Go to Admin, ingest one PDF
3. Ask query in Chat and verify citation-backed answer
4. Generate mindmap and reopen from Saved Mindmaps

---

## 8) Troubleshooting

### Build fails fetching Google fonts in restricted network
- This is external network related; use network access or local fonts.
