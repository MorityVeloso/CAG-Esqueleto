-- CAG-Esqueleto: Dynamic Snapshots Table
-- Layer 2 — Compressed contextual snapshots

CREATE TABLE IF NOT EXISTS cag_dynamic_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_text TEXT NOT NULL,
  original_tokens INTEGER,
  compressed_tokens INTEGER,
  compression_ratio FLOAT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_snapshots_created
  ON cag_dynamic_snapshots (created_at DESC);

-- RLS
ALTER TABLE cag_dynamic_snapshots ENABLE ROW LEVEL SECURITY;

-- Limpar snapshots velhos (manter só últimos N)
-- Call periodically to prevent table growth
CREATE OR REPLACE FUNCTION cag_cleanup_old_snapshots(keep_count INT DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
    FROM cag_dynamic_snapshots
  )
  DELETE FROM cag_dynamic_snapshots WHERE id IN (
    SELECT id FROM ranked WHERE rn > keep_count
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
