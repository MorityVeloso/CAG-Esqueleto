-- CAG-Esqueleto: Dynamic Snapshots Table

create table if not exists cag_dynamic_snapshots (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  original text not null,
  compressed text not null,
  compression_ratio float not null,
  token_count integer not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  updated_at timestamp with time zone default now() not null
);

-- Only keep latest snapshot per key
create unique index if not exists idx_cag_dynamic_snapshots_key
  on cag_dynamic_snapshots (key);

-- Cleanup expired snapshots
create index if not exists idx_cag_dynamic_snapshots_expires
  on cag_dynamic_snapshots (expires_at);

-- RLS
alter table cag_dynamic_snapshots enable row level security;
