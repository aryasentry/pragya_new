begin;

-- Structured legal ingestion metadata for hierarchical RAG.

alter table public.citizen_chunks add column if not exists node_uuid uuid not null default gen_random_uuid();
alter table public.citizen_chunks add column if not exists act_name text;
alter table public.citizen_chunks add column if not exists chapter text;
alter table public.citizen_chunks add column if not exists chapter_title text;
alter table public.citizen_chunks add column if not exists section_title text;
alter table public.citizen_chunks add column if not exists level text not null default 'child';
alter table public.citizen_chunks add column if not exists type text not null default 'content';
alter table public.citizen_chunks add column if not exists parent_node_uuid uuid;
alter table public.citizen_chunks add column if not exists child_node_uuid uuid;

alter table public.hr_chunks add column if not exists node_uuid uuid not null default gen_random_uuid();
alter table public.hr_chunks add column if not exists act_name text;
alter table public.hr_chunks add column if not exists chapter text;
alter table public.hr_chunks add column if not exists chapter_title text;
alter table public.hr_chunks add column if not exists section_title text;
alter table public.hr_chunks add column if not exists level text not null default 'child';
alter table public.hr_chunks add column if not exists type text not null default 'content';
alter table public.hr_chunks add column if not exists parent_node_uuid uuid;
alter table public.hr_chunks add column if not exists child_node_uuid uuid;

alter table public.company_chunks add column if not exists node_uuid uuid not null default gen_random_uuid();
alter table public.company_chunks add column if not exists act_name text;
alter table public.company_chunks add column if not exists chapter text;
alter table public.company_chunks add column if not exists chapter_title text;
alter table public.company_chunks add column if not exists section_title text;
alter table public.company_chunks add column if not exists level text not null default 'child';
alter table public.company_chunks add column if not exists type text not null default 'content';
alter table public.company_chunks add column if not exists parent_node_uuid uuid;
alter table public.company_chunks add column if not exists child_node_uuid uuid;

alter table public.citizen_chunks drop constraint if exists citizen_chunks_level_check;
alter table public.citizen_chunks add constraint citizen_chunks_level_check check (level in ('act', 'chapter', 'section', 'child'));
alter table public.citizen_chunks drop constraint if exists citizen_chunks_type_check;
alter table public.citizen_chunks add constraint citizen_chunks_type_check check (type in ('content', 'toc'));

alter table public.hr_chunks drop constraint if exists hr_chunks_level_check;
alter table public.hr_chunks add constraint hr_chunks_level_check check (level in ('act', 'chapter', 'section', 'child'));
alter table public.hr_chunks drop constraint if exists hr_chunks_type_check;
alter table public.hr_chunks add constraint hr_chunks_type_check check (type in ('content', 'toc'));

alter table public.company_chunks drop constraint if exists company_chunks_level_check;
alter table public.company_chunks add constraint company_chunks_level_check check (level in ('act', 'chapter', 'section', 'child'));
alter table public.company_chunks drop constraint if exists company_chunks_type_check;
alter table public.company_chunks add constraint company_chunks_type_check check (type in ('content', 'toc'));

create index if not exists citizen_chunks_node_uuid_idx on public.citizen_chunks(node_uuid);
create index if not exists citizen_chunks_type_level_idx on public.citizen_chunks(type, level);
create index if not exists citizen_chunks_section_number_idx on public.citizen_chunks(section_number);
create index if not exists citizen_chunks_chapter_idx on public.citizen_chunks(chapter);

create index if not exists hr_chunks_node_uuid_idx on public.hr_chunks(node_uuid);
create index if not exists hr_chunks_type_level_idx on public.hr_chunks(type, level);
create index if not exists hr_chunks_section_number_idx on public.hr_chunks(section_number);
create index if not exists hr_chunks_chapter_idx on public.hr_chunks(chapter);

create index if not exists company_chunks_node_uuid_idx on public.company_chunks(node_uuid);
create index if not exists company_chunks_type_level_idx on public.company_chunks(type, level);
create index if not exists company_chunks_section_number_idx on public.company_chunks(section_number);
create index if not exists company_chunks_chapter_idx on public.company_chunks(chapter);

create or replace function public.set_chunk_tsv()
returns trigger
language plpgsql
as $$
begin
  new.tsv :=
    setweight(to_tsvector('english', unaccent(coalesce(new.section_title, new.section_name, ''))), 'A') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.chapter_title, ''))), 'A') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.title, ''))), 'A') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.description, ''))), 'B') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.content, ''))), 'B') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.ocr_text, ''))), 'C') ||
    setweight(to_tsvector('english', unaccent(coalesce(new.image_description, ''))), 'C');

  return new;
end;
$$;

drop trigger if exists citizen_chunks_tsv_trigger on public.citizen_chunks;
create trigger citizen_chunks_tsv_trigger
before insert or update of title, section_name, section_title, chapter_title, description, content, ocr_text, image_description
on public.citizen_chunks
for each row execute function public.set_chunk_tsv();

drop trigger if exists hr_chunks_tsv_trigger on public.hr_chunks;
create trigger hr_chunks_tsv_trigger
before insert or update of title, section_name, section_title, chapter_title, description, content, ocr_text, image_description
on public.hr_chunks
for each row execute function public.set_chunk_tsv();

drop trigger if exists company_chunks_tsv_trigger on public.company_chunks;
create trigger company_chunks_tsv_trigger
before insert or update of title, section_name, section_title, chapter_title, description, content, ocr_text, image_description
on public.company_chunks
for each row execute function public.set_chunk_tsv();

commit;
