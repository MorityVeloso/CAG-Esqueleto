-- CAG-Esqueleto: Curated Knowledge Table

create table if not exists cag_curated_knowledge (
  id text primary key,
  content text not null,
  category text not null,
  priority float default 0.5 not null,
  embedding vector(1536),
  usage_count integer default 0 not null,
  metadata jsonb default '{}'::jsonb not null,
  last_used_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create index if not exists idx_cag_curated_knowledge_category
  on cag_curated_knowledge (category);

create index if not exists idx_cag_curated_knowledge_priority
  on cag_curated_knowledge (priority desc);

create index if not exists idx_cag_curated_knowledge_embedding
  on cag_curated_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RLS
alter table cag_curated_knowledge enable row level security;
