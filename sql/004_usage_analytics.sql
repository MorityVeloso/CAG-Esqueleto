-- CAG-Esqueleto: Usage Analytics Table
-- Tracks every query for cost analysis, cache efficiency, and performance

CREATE TABLE IF NOT EXISTS cag_usage_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id VARCHAR(100),
  timestamp TIMESTAMPTZ DEFAULT now(),
  layers_used TEXT[] DEFAULT '{}',
  cache_hit BOOLEAN DEFAULT false,
  processing_time_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  estimated_cost_usd FLOAT,
  user_id VARCHAR(255),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_analytics_timestamp
  ON cag_usage_analytics (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_user
  ON cag_usage_analytics (user_id);

-- RLS
ALTER TABLE cag_usage_analytics ENABLE ROW LEVEL SECURITY;

-- ─── Daily Stats View ─────────────────────────────────────────────────────────
-- Aggregated metrics per day: queries, cache hits, tokens, cost, latency

CREATE OR REPLACE VIEW cag_daily_stats AS
SELECT
  DATE(timestamp) as date,
  COUNT(*) as total_queries,
  COUNT(*) FILTER (WHERE cache_hit) as cache_hits,
  ROUND(
    COUNT(*) FILTER (WHERE cache_hit)::numeric / NULLIF(COUNT(*), 0) * 100, 1
  ) as cache_hit_rate,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cached_tokens) as total_cached_tokens,
  ROUND(SUM(estimated_cost_usd)::numeric, 4) as total_cost_usd,
  ROUND(AVG(processing_time_ms)::numeric, 0) as avg_processing_ms,
  ROUND(
    SUM(cached_tokens)::numeric / NULLIF(SUM(input_tokens + cached_tokens), 0) * 100, 1
  ) as cache_efficiency_pct
FROM cag_usage_analytics
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- ─── Savings Report View ──────────────────────────────────────────────────────
-- Estimates how much money was saved by using prompt caching vs. full-price input
-- Based on Sonnet pricing: $3/M input, $0.30/M cached (90% discount)

CREATE OR REPLACE VIEW cag_savings_report AS
SELECT
  DATE(timestamp) as date,
  SUM(cached_tokens) as tokens_served_from_cache,
  ROUND(SUM(cached_tokens) * 3.0 / 1000000, 4) as would_have_cost_usd,
  ROUND(SUM(cached_tokens) * 0.3 / 1000000, 4) as actual_cost_usd,
  ROUND(SUM(cached_tokens) * 2.7 / 1000000, 4) as saved_usd
FROM cag_usage_analytics
GROUP BY DATE(timestamp)
ORDER BY date DESC;
