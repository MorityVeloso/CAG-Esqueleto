/**
 * Adapter — Supabase
 *
 * Provides persistent storage for:
 *  - Semantic cache entries (with pgvector for similarity search)
 *  - Curated knowledge
 *  - Dynamic snapshots
 *  - Usage analytics
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CAGConfig, CacheEntry, KnowledgeEntry, CompressedSnapshot } from '@core/types.js';

export class SupabaseAdapter {
  private client: SupabaseClient;

  constructor(config: CAGConfig) {
    if (!config.supabase) {
      throw new Error('Supabase configuration is required for SupabaseAdapter');
    }
    this.client = createClient(config.supabase.url, config.supabase.serviceKey);
  }

  // ─── Semantic Cache ────────────────────────────────────────────────────

  async saveCacheEntry(entry: CacheEntry): Promise<void> {
    const { error } = await this.client.from('cag_semantic_cache').upsert({
      query: entry.query,
      response: entry.response,
      embedding: entry.embedding,
      hit_count: entry.hitCount,
      metadata: entry.metadata ?? {},
      created_at: entry.createdAt.toISOString(),
      last_accessed_at: entry.lastAccessedAt.toISOString(),
    });
    if (error) throw error;
  }

  async findSimilarCacheEntries(
    embedding: number[],
    threshold: number,
    limit: number,
  ): Promise<CacheEntry[]> {
    const { data, error } = await this.client.rpc('match_semantic_cache', {
      query_embedding: embedding,
      similarity_threshold: threshold,
      match_count: limit,
    });
    if (error) throw error;
    return (data ?? []) as unknown as CacheEntry[];
  }

  // ─── Knowledge ─────────────────────────────────────────────────────────

  async saveKnowledge(entry: KnowledgeEntry): Promise<void> {
    const { error } = await this.client.from('cag_curated_knowledge').upsert({
      id: entry.id,
      content: entry.content,
      category: entry.category,
      priority: entry.priority,
      embedding: entry.embedding,
      usage_count: entry.usageCount,
      metadata: entry.metadata ?? {},
      last_used_at: entry.lastUsedAt.toISOString(),
      created_at: entry.createdAt.toISOString(),
    });
    if (error) throw error;
  }

  async loadAllKnowledge(): Promise<KnowledgeEntry[]> {
    const { data, error } = await this.client
      .from('cag_curated_knowledge')
      .select('*')
      .order('priority', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(this.mapKnowledgeRow);
  }

  // ─── Snapshots ─────────────────────────────────────────────────────────

  async saveSnapshot(snapshot: CompressedSnapshot): Promise<void> {
    const { error } = await this.client.from('cag_dynamic_snapshots').upsert({
      key: snapshot.key,
      original: snapshot.original,
      compressed: snapshot.compressed,
      compression_ratio: snapshot.compressionRatio,
      token_count: snapshot.tokenCount,
      created_at: snapshot.createdAt.toISOString(),
      expires_at: snapshot.expiresAt.toISOString(),
    });
    if (error) throw error;
  }

  // ─── Analytics ─────────────────────────────────────────────────────────

  async trackUsage(event: {
    eventType: string;
    layerName: string;
    tokensUsed: number;
    latencyMs: number;
    cacheHit: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.client.from('cag_usage_analytics').insert({
      event_type: event.eventType,
      layer_name: event.layerName,
      tokens_used: event.tokensUsed,
      latency_ms: event.latencyMs,
      cache_hit: event.cacheHit,
      metadata: event.metadata ?? {},
    });
    if (error) throw error;
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  private mapKnowledgeRow(row: Record<string, unknown>): KnowledgeEntry {
    return {
      id: row['id'] as string,
      content: row['content'] as string,
      category: row['category'] as string,
      priority: row['priority'] as number,
      embedding: row['embedding'] as number[] | undefined,
      usageCount: row['usage_count'] as number,
      lastUsedAt: new Date(row['last_used_at'] as string),
      createdAt: new Date(row['created_at'] as string),
      metadata: row['metadata'] as Record<string, unknown> | undefined,
    };
  }
}
