-- CAG-Esqueleto: Semantic Cache Table
-- Requires pgvector extension for similarity search

create extension if not exists vector;

create table if not exists cag_semantic_cache (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  response text not null,
  embedding vector(1536),
  hit_count integer default 0 not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  last_accessed_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Index for vector similarity search
create index if not exists idx_cag_semantic_cache_embedding
  on cag_semantic_cache using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for cleanup queries
create index if not exists idx_cag_semantic_cache_last_accessed
  on cag_semantic_cache (last_accessed_at);

-- Function for similarity search
create or replace function match_semantic_cache(
  query_embedding vector(1536),
  similarity_threshold float,
  match_count int
)
returns table (
  id uuid,
  query text,
  response text,
  similarity float
)
language sql stable
as $$
  select
    id,
    query,
    response,
    1 - (embedding <=> query_embedding) as similarity
  from cag_semantic_cache
  where 1 - (embedding <=> query_embedding) > similarity_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- RLS
alter table cag_semantic_cache enable row level security;
