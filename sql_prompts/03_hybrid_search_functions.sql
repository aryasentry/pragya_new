begin;

create or replace function public.hybrid_search_domain(
  p_table regclass,
  p_query_text text,
  p_query_embedding vector(768),
  p_match_count int default 10,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  domain text,
  id bigint,
  content text,
  document_name text,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  parent_content text,
  entities jsonb,
  relationships jsonb,
  vector_score double precision,
  bm25_score double precision,
  final_score double precision,
  created_at timestamptz
)
language plpgsql
stable
as $$
declare
  v_table_name text;
  v_sql text;
begin
  v_table_name := p_table::text;

  if v_table_name not in (
    'public.citizen_chunks',
    'public.hr_chunks',
    'public.company_chunks',
    'citizen_chunks',
    'hr_chunks',
    'company_chunks'
  ) then
    raise exception 'Unsupported domain table: %', v_table_name;
  end if;

  v_sql := format(
    $query$
    with vector_hits as (
      select
        c.id,
        (1 - (c.embedding <=> $2))::double precision as vector_score
      from %1$s c
      where c.embedding is not null
        and coalesce(c.level, 'child') = 'child'
        and coalesce(c.type, 'content') = 'content'
        and (not ($4 ? 'document_name') or c.document_name = $4->>'document_name')
        and (not ($4 ? 'section_number') or c.section_number = $4->>'section_number')
        and (not ($4 ? 'section_name') or c.section_name ilike ('%%' || $4->>'section_name' || '%%'))
        and (not ($4 ? 'title') or c.title ilike ('%%' || $4->>'title' || '%%'))
      order by c.embedding <=> $2
      limit greatest($3 * 5, 25)
    ),
    bm25_hits as (
      select
        c.id,
        ts_rank_cd(c.tsv, websearch_to_tsquery('english', $1))::double precision as bm25_score
      from %1$s c
      where $1 <> ''
        and coalesce(c.level, 'child') = 'child'
        and coalesce(c.type, 'content') = 'content'
        and c.tsv @@ websearch_to_tsquery('english', $1)
        and (not ($4 ? 'document_name') or c.document_name = $4->>'document_name')
        and (not ($4 ? 'section_number') or c.section_number = $4->>'section_number')
        and (not ($4 ? 'section_name') or c.section_name ilike ('%%' || $4->>'section_name' || '%%'))
        and (not ($4 ? 'title') or c.title ilike ('%%' || $4->>'title' || '%%'))
      order by bm25_score desc
      limit greatest($3 * 5, 25)
    ),
    merged as (
      select
        coalesce(v.id, b.id) as id,
        coalesce(v.vector_score, 0)::double precision as vector_score,
        coalesce(b.bm25_score, 0)::double precision as bm25_score
      from vector_hits v
      full outer join bm25_hits b on b.id = v.id
    ),
    scored as (
      select
        c.id,
        c.content,
        c.document_name,
        c.section_name,
        c.section_number,
        c.title,
        c.description,
        c.ocr_text,
        c.image_description,
        c.parent_id,
        c.entities,
        c.relationships,
        c.created_at,
        m.vector_score,
        m.bm25_score,
        (0.65 * m.vector_score + 0.35 * m.bm25_score)::double precision as final_score
      from merged m
      join %1$s c on c.id = m.id
    )
    select
      %2$L::text as domain,
      s.id,
      s.content,
      s.document_name,
      s.section_name,
      s.section_number,
      s.title,
      s.description,
      s.ocr_text,
      s.image_description,
      s.parent_id,
      p.content as parent_content,
      s.entities,
      s.relationships,
      s.vector_score,
      s.bm25_score,
      s.final_score,
      s.created_at
    from scored s
    left join %1$s p on p.id = s.parent_id
    order by s.final_score desc, s.created_at desc
    limit $3
    $query$,
    v_table_name,
    replace(v_table_name, 'public.', '')
  );

  return query execute v_sql
    using coalesce(p_query_text, ''), p_query_embedding, p_match_count, coalesce(p_metadata_filter, '{}'::jsonb);
end;
$$;

create or replace function public.search_citizen_chunks_hybrid(
  p_query_text text,
  p_query_embedding vector(768),
  p_match_count int default 10,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  domain text,
  id bigint,
  content text,
  document_name text,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  parent_content text,
  entities jsonb,
  relationships jsonb,
  vector_score double precision,
  bm25_score double precision,
  final_score double precision,
  created_at timestamptz
)
language sql
stable
as $$
  select *
  from public.hybrid_search_domain(
    'public.citizen_chunks'::regclass,
    p_query_text,
    p_query_embedding,
    p_match_count,
    p_metadata_filter
  );
$$;

create or replace function public.search_hr_chunks_hybrid(
  p_query_text text,
  p_query_embedding vector(768),
  p_match_count int default 10,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  domain text,
  id bigint,
  content text,
  document_name text,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  parent_content text,
  entities jsonb,
  relationships jsonb,
  vector_score double precision,
  bm25_score double precision,
  final_score double precision,
  created_at timestamptz
)
language sql
stable
as $$
  select *
  from public.hybrid_search_domain(
    'public.hr_chunks'::regclass,
    p_query_text,
    p_query_embedding,
    p_match_count,
    p_metadata_filter
  );
$$;

create or replace function public.search_company_chunks_hybrid(
  p_query_text text,
  p_query_embedding vector(768),
  p_match_count int default 10,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  domain text,
  id bigint,
  content text,
  document_name text,
  section_name text,
  section_number text,
  title text,
  description text,
  ocr_text text,
  image_description text,
  parent_id bigint,
  parent_content text,
  entities jsonb,
  relationships jsonb,
  vector_score double precision,
  bm25_score double precision,
  final_score double precision,
  created_at timestamptz
)
language sql
stable
as $$
  select *
  from public.hybrid_search_domain(
    'public.company_chunks'::regclass,
    p_query_text,
    p_query_embedding,
    p_match_count,
    p_metadata_filter
  );
$$;

create or replace function public.fetch_parent_context(
  p_table regclass,
  p_child_ids bigint[]
)
returns table (
  child_id bigint,
  parent_id bigint,
  parent_content text,
  parent_title text,
  parent_section_name text,
  parent_section_number text,
  parent_document_name text
)
language plpgsql
stable
as $$
declare
  v_table_name text;
  v_sql text;
begin
  v_table_name := p_table::text;

  if v_table_name not in (
    'public.citizen_chunks',
    'public.hr_chunks',
    'public.company_chunks',
    'citizen_chunks',
    'hr_chunks',
    'company_chunks'
  ) then
    raise exception 'Unsupported domain table: %', v_table_name;
  end if;

  v_sql := format(
    $query$
    select
      c.id as child_id,
      p.id as parent_id,
      p.content as parent_content,
      p.title as parent_title,
      p.section_name as parent_section_name,
      p.section_number as parent_section_number,
      p.document_name as parent_document_name
    from %1$s c
    join %1$s p on p.id = c.parent_id
    where c.id = any($1)
    $query$,
    v_table_name
  );

  return query execute v_sql using p_child_ids;
end;
$$;

create or replace function public.expand_related_chunks_by_entities(
  p_table regclass,
  p_seed_ids bigint[],
  p_limit int default 20
)
returns table (
  id bigint,
  content text,
  document_name text,
  entities jsonb,
  relationships jsonb,
  shared_entity_count int,
  created_at timestamptz
)
language plpgsql
stable
as $$
declare
  v_table_name text;
  v_sql text;
begin
  v_table_name := p_table::text;

  if v_table_name not in (
    'public.citizen_chunks',
    'public.hr_chunks',
    'public.company_chunks',
    'citizen_chunks',
    'hr_chunks',
    'company_chunks'
  ) then
    raise exception 'Unsupported domain table: %', v_table_name;
  end if;

  v_sql := format(
    $query$
    with seed_entities as (
      select distinct key as entity_key
      from %1$s s,
      lateral jsonb_object_keys(coalesce(s.entities, '{}'::jsonb)) key
      where s.id = any($1)
    ),
    related as (
      select
        c.id,
        c.content,
        c.document_name,
        c.entities,
        c.relationships,
        c.created_at,
        (
          select count(*)::int
          from seed_entities se
          where coalesce(c.entities, '{}'::jsonb) ? se.entity_key
        ) as shared_entity_count
      from %1$s c
      where c.id <> all($1)
    )
    select
      r.id,
      r.content,
      r.document_name,
      r.entities,
      r.relationships,
      r.shared_entity_count,
      r.created_at
    from related r
    where r.shared_entity_count > 0
    order by r.shared_entity_count desc, r.created_at desc
    limit $2
    $query$,
    v_table_name
  );

  return query execute v_sql using p_seed_ids, p_limit;
end;
$$;

commit;
