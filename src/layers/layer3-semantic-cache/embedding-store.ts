/**
 * Layer 3 — Embedding Store
 *
 * In-memory store for embeddings with optional Supabase persistence.
 * Used by the Semantic Cache to find similar queries.
 */

import { cosineSimilarity } from './similarity.js';

export interface StoredEmbedding {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
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
   */
  findSimilar(
    queryEmbedding: number[],
    threshold: number,
    limit: number = 5,
  ): { entry: StoredEmbedding; similarity: number }[] {
    const results: { entry: StoredEmbedding; similarity: number }[] = [];

    for (const entry of this.entries.values()) {
      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
}
