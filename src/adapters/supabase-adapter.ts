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
import type { CAGConfig, SemanticCacheEntry, CuratedKnowledgeEntry, CompressedSnapshot } from '@core/types.js';

export class SupabaseAdapter {
  private client: SupabaseClient;

  constructor(config: CAGConfig) {
    if (!config.storage.supabase) {
      throw new Error('storage.supabase configuration is required for SupabaseAdapter');
    }
    this.client = createClient(config.storage.supabase.url, config.storage.supabase.serviceKey);
  }

  // ─── Semantic Cache ────────────────────────────────────────────────────

  async saveCacheEntry(entry: SemanticCacheEntry): Promise<void> {
    const { error } = await this.client.from('cag_semantic_cache').upsert({
      id: entry.id,
      query: entry.queryText,
      response: entry.responseText,
      embedding: entry.queryEmbedding,
      hit_count: entry.hitCount,
      metadata: entry.metadata,
      created_at: entry.createdAt.toISOString(),
      expires_at: entry.expiresAt.toISOString(),
    });
    if (error) throw error;
  }

  async findSimilarCacheEntries(
    embedding: number[],
    threshold: number,
    limit: number,
  ): Promise<SemanticCacheEntry[]> {
    const { data, error } = await this.client.rpc('match_semantic_cache', {
      query_embedding: embedding,
      similarity_threshold: threshold,
      match_count: limit,
    });
    if (error) throw error;
    return (data ?? []) as unknown as SemanticCacheEntry[];
  }

  // ─── Knowledge ─────────────────────────────────────────────────────────

  async saveKnowledge(entry: CuratedKnowledgeEntry): Promise<void> {
    const { error } = await this.client.from('cag_curated_knowledge').upsert({
      id: entry.id,
      content: entry.content,
      source: entry.source,
      category: entry.category,
      priority: entry.priority,
      usage_count: entry.usageCount,
      tags: entry.tags,
      created_by: entry.createdBy,
      last_used_at: entry.lastUsedAt.toISOString(),
      created_at: entry.createdAt.toISOString(),
    });
    if (error) throw error;
  }

  async loadAllKnowledge(): Promise<CuratedKnowledgeEntry[]> {
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

  private mapKnowledgeRow(row: Record<string, unknown>): CuratedKnowledgeEntry {
    return {
      id: row['id'] as string,
      content: row['content'] as string,
      source: row['source'] as CuratedKnowledgeEntry['source'],
      category: row['category'] as string,
      priority: row['priority'] as number,
      usageCount: row['usage_count'] as number,
      lastUsedAt: new Date(row['last_used_at'] as string),
      createdAt: new Date(row['created_at'] as string),
      createdBy: row['created_by'] as string | undefined,
      tags: (row['tags'] as string[]) ?? [],
    };
  }
}
