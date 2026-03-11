/**
 * Layer 3 — Embedding Store
 *
 * In-memory store for embeddings with similarity search.
 * Used by the Semantic Cache to find similar queries.
 *
 * For production: swap for Supabase (pgvector) or Redis via adapters.
 * This in-memory implementation is used for tests and development.
 */

import { cosineSimilarity } from './similarity.js';

export interface StoredEmbedding {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface SimilarResult {
  entry: StoredEmbedding;
  similarity: number;
}

export class EmbeddingStore {
  private entries: Map<string, StoredEmbedding> = new Map();

  add(id: string, text: string, embedding: number[], metadata?: Record<string, unknown>): void {
    this.entries.set(id, {
      id,
      text,
      embedding,
      metadata,
      createdAt: new Date(),
    });
  }

  /**
   * Find entries with cosine similarity above the threshold.
   * Returns sorted by similarity DESC.
   */
  findSimilar(
    queryEmbedding: number[],
    threshold: number,
    limit = 5,
  ): SimilarResult[] {
    const results: SimilarResult[] = [];

    for (const entry of this.entries.values()) {
      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  get(id: string): StoredEmbedding | undefined {
    return this.entries.get(id);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Delete the oldest entries (by createdAt).
   * Used for LRU eviction.
   */
  deleteOldest(count: number): string[] {
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const deleted: string[] = [];
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      const entry = sorted[i]!;
      this.entries.delete(entry.id);
      deleted.push(entry.id);
    }
    return deleted;
  }

  /**
   * Get all entry IDs matching a text pattern.
   */
  findByTextPattern(pattern: string): string[] {
    const regex = new RegExp(pattern, 'i');
    const ids: string[] = [];
    for (const entry of this.entries.values()) {
      if (regex.test(entry.text)) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  /**
   * Get all entries created before a given date.
   */
  findOlderThan(date: Date): string[] {
    const ids: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.createdAt < date) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  count(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
}
