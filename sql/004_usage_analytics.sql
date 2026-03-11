-- CAG-Esqueleto: Usage Analytics Table

create table if not exists cag_usage_analytics (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  layer_name text not null,
  tokens_used integer default 0 not null,
  latency_ms integer default 0 not null,
  cache_hit boolean default false not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create index if not exists idx_cag_usage_analytics_event_type
  on cag_usage_analytics (event_type);

create index if not exists idx_cag_usage_analytics_created_at
  on cag_usage_analytics (created_at desc);

create index if not exists idx_cag_usage_analytics_layer
  on cag_usage_analytics (layer_name);

-- RLS
alter table cag_usage_analytics enable row level security;
