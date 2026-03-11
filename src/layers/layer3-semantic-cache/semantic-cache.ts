/**
 * Layer 3 — Semantic Cache
 *
 * Caches query-response pairs and retrieves them based on semantic similarity.
 * If a new query is semantically similar to a cached one (above threshold),
 * the cached response is returned — saving an entire API call.
 */

import type {
  ISemanticCacheLayer,
  SemanticCacheEntry,
  CacheStats,
  CAGConfig,
} from '@core/types.js';
import { EmbeddingStore } from './embedding-store.js';

export class SemanticCache implements ISemanticCacheLayer {
  readonly name = 'semantic-cache';
  readonly order = 3;

  private readonly config: CAGConfig;
  private readonly store = new EmbeddingStore();
  private responses: Map<string, SemanticCacheEntry> = new Map();

  private hits = 0;
  private misses = 0;
  private totalTokensSaved = 0;

  /** Embedding function — must be injected */
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
    this.store.clear();
    this.responses.clear();
  }

  async get(query: string): Promise<SemanticCacheEntry | null> {
    if (!this.embedFn) return null;

    const queryEmbedding = await this.embedFn(query);
    const threshold = this.config.layers.semanticCache.similarityThreshold;
    const results = this.store.findSimilar(queryEmbedding, threshold, 1);

    if (results.length === 0) {
      this.misses++;
      return null;
    }

    const best = results[0]!;
    const entry = this.responses.get(best.entry.id);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (new Date() > entry.expiresAt) {
      this.store.remove(best.entry.id);
      this.responses.delete(best.entry.id);
      this.misses++;
      return null;
    }

    this.hits++;
    entry.hitCount++;

    return entry;
  }

  async set(query: string, response: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.embedFn) return;

    const embedding = await this.embedFn(query);
    const id = this.generateId(query);

    this.store.add(id, query, embedding);

    const ttlMs = this.config.layers.semanticCache.ttl * 1000;
    this.responses.set(id, {
      id,
      queryEmbedding: embedding,
      queryText: query,
      responseText: response,
      hitCount: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      metadata: metadata ?? {},
    });

    // Evict oldest if over limit
    if (this.responses.size > this.config.layers.semanticCache.maxEntries) {
      this.evictOldest();
    }
  }

  async invalidate(query: string): Promise<void> {
    const id = this.generateId(query);
    this.store.remove(id);
    this.responses.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.responses.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalTokensSaved = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      totalEntries: this.responses.size,
      hitRate: total > 0 ? this.hits / total : 0,
      avgSimilarity: 0,
      tokensSaved: this.totalTokensSaved,
    };
  }

  private generateId(query: string): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `sc_${Math.abs(hash).toString(36)}`;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestDate = new Date();

    for (const [key, entry] of this.responses) {
      if (entry.createdAt < oldestDate) {
        oldestDate = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.remove(oldestKey);
      this.responses.delete(oldestKey);
    }
  }
}
