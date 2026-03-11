-- CAG-Esqueleto: Curated Knowledge Table
-- Layer 5 — Agentic Context Engineering (ACE)

CREATE TABLE IF NOT EXISTS cag_curated_knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  source VARCHAR(50) NOT NULL CHECK (source IN ('user_taught', 'auto_extracted', 'feedback_loop')),
  category VARCHAR(100) NOT NULL,
  priority FLOAT DEFAULT 0.5 CHECK (priority >= 0 AND priority <= 1),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by VARCHAR(255),
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_curated_knowledge_priority
  ON cag_curated_knowledge (priority DESC);

CREATE INDEX IF NOT EXISTS idx_curated_knowledge_category
  ON cag_curated_knowledge (category);

CREATE INDEX IF NOT EXISTS idx_curated_knowledge_tags
  ON cag_curated_knowledge USING gin (tags);

-- RLS
ALTER TABLE cag_curated_knowledge ENABLE ROW LEVEL SECURITY;

-- Automatic priority decay function
-- Call periodically (e.g. daily via pg_cron or app-level scheduler)
-- Applies multiplicative decay and prunes dead entries (below min_priority)
CREATE OR REPLACE FUNCTION cag_decay_priorities(
  decay_factor FLOAT DEFAULT 0.95,
  min_priority FLOAT DEFAULT 0.05
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Apply decay to all entries
  UPDATE cag_curated_knowledge SET priority = priority * decay_factor;

  -- Remove dead entries (priority too low to ever be useful)
  DELETE FROM cag_curated_knowledge WHERE priority < min_priority;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
