begin;

create or replace function public.set_chunk_tsv()
returns trigger
language plpgsql
as $$
begin
  new.tsv :=
    setweight(to_tsvector('english', unaccent(coalesce(new.title, ''))), 'A') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.section_name, ''))), 'A') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.description, ''))), 'B') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.content, ''))), 'B') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.ocr_text, ''))), 'C') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.image_description, ''))), 'C');

  return new;
end;
$$;

drop trigger if exists citizen_chunks_tsv_trigger on public.citizen_chunks;
create trigger citizen_chunks_tsv_trigger
before insert or update of title, section_name, description, content, ocr_text, image_description
on public.citizen_chunks
for each row execute function public.set_chunk_tsv();

drop trigger if exists hr_chunks_tsv_trigger on public.hr_chunks;
create trigger hr_chunks_tsv_trigger
before insert or update of title, section_name, description, content, ocr_text, image_description
on public.hr_chunks
for each row execute function public.set_chunk_tsv();

drop trigger if exists company_chunks_tsv_trigger on public.company_chunks;
create trigger company_chunks_tsv_trigger
before insert or update of title, section_name, description, content, ocr_text, image_description
on public.company_chunks
for each row execute function public.set_chunk_tsv();

create index if not exists citizen_chunks_tsv_idx on public.citizen_chunks using gin(tsv);
create index if not exists citizen_chunks_embedding_idx on public.citizen_chunks using ivfflat(embedding vector_cosine_ops) with (lists = 100);
create index if not exists citizen_chunks_document_name_idx on public.citizen_chunks(document_name);
create index if not exists citizen_chunks_parent_id_idx on public.citizen_chunks(parent_id);
create index if not exists citizen_chunks_entities_idx on public.citizen_chunks using gin(entities jsonb_path_ops);
create index if not exists citizen_chunks_relationships_idx on public.citizen_chunks using gin(relationships jsonb_path_ops);
create index if not exists citizen_chunks_created_at_idx on public.citizen_chunks(created_at desc);

create index if not exists hr_chunks_tsv_idx on public.hr_chunks using gin(tsv);
create index if not exists hr_chunks_embedding_idx on public.hr_chunks using ivfflat(embedding vector_cosine_ops) with (lists = 100);
create index if not exists hr_chunks_document_name_idx on public.hr_chunks(document_name);
create index if not exists hr_chunks_parent_id_idx on public.hr_chunks(parent_id);
create index if not exists hr_chunks_entities_idx on public.hr_chunks using gin(entities jsonb_path_ops);
create index if not exists hr_chunks_relationships_idx on public.hr_chunks using gin(relationships jsonb_path_ops);
create index if not exists hr_chunks_created_at_idx on public.hr_chunks(created_at desc);

create index if not exists company_chunks_tsv_idx on public.company_chunks using gin(tsv);
create index if not exists company_chunks_embedding_idx on public.company_chunks using ivfflat(embedding vector_cosine_ops) with (lists = 100);
create index if not exists company_chunks_document_name_idx on public.company_chunks(document_name);
create index if not exists company_chunks_parent_id_idx on public.company_chunks(parent_id);
create index if not exists company_chunks_entities_idx on public.company_chunks using gin(entities jsonb_path_ops);
create index if not exists company_chunks_relationships_idx on public.company_chunks using gin(relationships jsonb_path_ops);
create index if not exists company_chunks_created_at_idx on public.company_chunks(created_at desc);

commit;
