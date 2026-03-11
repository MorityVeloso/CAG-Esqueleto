/**
 * Layer 3 — Semantic Cache
 *
 * Caches query-response pairs and retrieves them based on semantic similarity.
 * If a new query is semantically similar to a cached one (above threshold),
 * the cached response is returned — saving an entire API call.
 *
 * Eviction strategy: LRU (Least Recently Used) — when maxEntries is reached,
 * the oldest entry with the fewest hits is evicted first.
 */

import type {
  ISemanticCacheLayer,
  SemanticCacheEntry,
  CacheLookupResult,
  CacheStats,
  CAGConfig,
} from '@core/types.js';
import { EmbeddingStore } from './embedding-store.js';
import { countTokens } from '../../utils/token-counter.js';

export class SemanticCache implements ISemanticCacheLayer {
  readonly name = 'semantic-cache';
  readonly order = 3;

  private readonly config: CAGConfig;
  private readonly embeddingStore = new EmbeddingStore();
  private entries: Map<string, SemanticCacheEntry> = new Map();

  private hits = 0;
  private misses = 0;
  private totalSimilarity = 0;
  private totalTokensSaved = 0;

  /** Embedding function — must be injected via setEmbeddingFunction() */
  private embedFn: ((text: string) => Promise<number[]>) | null = null;

  constructor(config: CAGConfig) {
    this.config = config;
  }

  setEmbeddingFunction(fn: (text: string) => Promise<number[]>): void {
    this.embedFn = fn;
  }

  async initialize(): Promise<void> {
    if (!this.embedFn) {
      throw new Error('Embedding function not set. Call setEmbeddingFunction() before initialize().');
    }
  }

  async shutdown(): Promise<void> {
    this.embeddingStore.clear();
    this.entries.clear();
  }

  // ─── Core API ─────────────────────────────────────────────────────────

  /**
   * Look up a cached response by semantic similarity.
   *
   * Generates an embedding for the query, finds the most similar cached entry
   * above the configured threshold, and returns the cached response.
   */
  async lookup(query: string): Promise<CacheLookupResult | null> {
    if (!this.embedFn) return null;

    const queryEmbedding = await this.embedFn(query);
    const threshold = this.config.layers.semanticCache.similarityThreshold;
    const results = this.embeddingStore.findSimilar(queryEmbedding, threshold, 1);

    if (results.length === 0) {
      this.misses++;
      return null;
    }

    const best = results[0]!;
    const entry = this.entries.get(best.entry.id);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (new Date() > entry.expiresAt) {
      this.embeddingStore.remove(best.entry.id);
      this.entries.delete(best.entry.id);
      this.misses++;
      return null;
    }

    // Record hit
    this.hits++;
    entry.hitCount++;
    this.totalSimilarity += best.similarity;
    this.totalTokensSaved += countTokens(entry.responseText);

    return {
      response: entry.responseText,
      similarity: best.similarity,
      queryOriginal: entry.queryText,
      cachedAt: entry.createdAt,
      hitCount: entry.hitCount,
      metadata: entry.metadata,
    };
  }

  /**
   * Store a query-response pair in the cache.
   * Applies LRU eviction if maxEntries is exceeded.
   */
  async store(query: string, response: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.embedFn) return;

    const embedding = await this.embedFn(query);
    const id = this.generateId(query);

    this.embeddingStore.add(id, query, embedding);

    const ttlMs = this.config.layers.semanticCache.ttl * 1000;
    this.entries.set(id, {
      id,
      queryEmbedding: embedding,
      queryText: query,
      responseText: response,
      hitCount: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      metadata: metadata ?? {},
    });

    // LRU eviction when over limit
    const maxEntries = this.config.layers.semanticCache.maxEntries;
    while (this.entries.size > maxEntries) {
      this.evictLRU();
    }
  }

  /**
   * Invalidate cached entries.
   *
   * @param pattern — if provided, removes entries whose query text matches (regex).
   *                   If omitted, removes ALL entries (full clear).
   * @returns number of entries removed
   */
  async invalidate(pattern?: string): Promise<number> {
    if (!pattern) {
      const count = this.entries.size;
      await this.clear();
      return count;
    }

    const matchingIds = this.embeddingStore.findByTextPattern(pattern);
    let removed = 0;

    for (const id of matchingIds) {
      this.embeddingStore.remove(id);
      if (this.entries.delete(id)) {
        removed++;
      }
    }

    return removed;
  }

  /**
   * Remove entries older than maxAgeSeconds.
   * @returns number of entries removed
   */
  async invalidateByAge(maxAgeSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeSeconds * 1000);
    const oldIds = this.embeddingStore.findOlderThan(cutoff);
    let removed = 0;

    for (const id of oldIds) {
      this.embeddingStore.remove(id);
      if (this.entries.delete(id)) {
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clear all cached entries and reset stats.
   */
  async clear(): Promise<void> {
    this.embeddingStore.clear();
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalSimilarity = 0;
    this.totalTokensSaved = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      totalEntries: this.entries.size,
      hitRate: total > 0 ? this.hits / total : 0,
      avgSimilarity: this.hits > 0 ? this.totalSimilarity / this.hits : 0,
      tokensSaved: this.totalTokensSaved,
    };
  }

  /**
   * Expose the embedding store for engine-level access.
   */
  getStore(): EmbeddingStore {
    return this.embeddingStore;
  }

  // ─── Backward Compatibility ───────────────────────────────────────────
  // cag-engine uses get/set — these delegate to lookup/store

  async get(query: string): Promise<SemanticCacheEntry | null> {
    const result = await this.lookup(query);
    if (!result) return null;

    // Find the original entry to return the full SemanticCacheEntry
    const id = this.generateId(result.queryOriginal);
    return this.entries.get(id) ?? null;
  }

  async set(query: string, response: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.store(query, response, metadata);
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Generate a deterministic ID from query text.
   */
  private generateId(query: string): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `sc_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Evict the least recently used entry.
   * Tie-breaker: lowest hitCount.
   */
  private evictLRU(): void {
    let evictKey: string | null = null;
    let evictDate = Infinity;
    let evictHits = Infinity;

    for (const [key, entry] of this.entries) {
      const time = entry.createdAt.getTime();
      if (time < evictDate || (time === evictDate && entry.hitCount < evictHits)) {
        evictDate = time;
        evictHits = entry.hitCount;
        evictKey = key;
      }
    }

    if (evictKey) {
      this.embeddingStore.remove(evictKey);
      this.entries.delete(evictKey);
    }
  }
}
