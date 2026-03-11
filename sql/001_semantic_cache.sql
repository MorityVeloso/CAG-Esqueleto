-- CAG-Esqueleto: Semantic Cache Table
-- Requires pgvector extension for similarity search

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cag_semantic_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_text TEXT NOT NULL,
  query_embedding vector(1024),  -- Voyage 3 Large = 1024 dims
  response_text TEXT NOT NULL,
  hit_count INTEGER DEFAULT 0,
  similarity_score FLOAT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for vector similarity search (ivfflat for fast approximate search)
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
  ON cag_semantic_cache
  USING ivfflat (query_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires
  ON cag_semantic_cache (expires_at);

-- Function for similarity search with TTL filtering
CREATE OR REPLACE FUNCTION cag_search_similar_queries(
  query_embedding vector(1024),
  similarity_threshold FLOAT DEFAULT 0.85,
  max_results INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  query_text TEXT,
  response_text TEXT,
  similarity FLOAT,
  hit_count INTEGER,
  metadata JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.query_text,
    sc.response_text,
    1 - (sc.query_embedding <=> query_embedding) as similarity,
    sc.hit_count,
    sc.metadata
  FROM cag_semantic_cache sc
  WHERE sc.expires_at > now()
    AND 1 - (sc.query_embedding <=> query_embedding) >= similarity_threshold
  ORDER BY sc.query_embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE cag_semantic_cache ENABLE ROW LEVEL SECURITY;
