begin;

-- Embedding dimension assumes Ollama nomic-embed-text.
-- Update all vector(768) declarations if your model dimension differs.

create table if not exists public.citizen_chunks (
  id bigserial primary key,
  content text not null,
  embedding vector(768),
  tsv tsvector,
  document_name text not null,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  child_id bigint,
  entities jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.hr_chunks (
  id bigserial primary key,
  content text not null,
  embedding vector(768),
  tsv tsvector,
  document_name text not null,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  child_id bigint,
  entities jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.company_chunks (
  id bigserial primary key,
  content text not null,
  embedding vector(768),
  tsv tsvector,
  document_name text not null,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  child_id bigint,
  entities jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'citizen_chunks_parent_fk'
  ) then
    alter table public.citizen_chunks
      add constraint citizen_chunks_parent_fk
      foreign key (parent_id) references public.citizen_chunks(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_chunks_parent_fk'
  ) then
    alter table public.hr_chunks
      add constraint hr_chunks_parent_fk
      foreign key (parent_id) references public.hr_chunks(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_chunks_parent_fk'
  ) then
    alter table public.company_chunks
      add constraint company_chunks_parent_fk
      foreign key (parent_id) references public.company_chunks(id) on delete cascade;
  end if;
end
$$;

commit;
