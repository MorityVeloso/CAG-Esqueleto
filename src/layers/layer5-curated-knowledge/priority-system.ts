/**
 * Layer 5 — Auto-Prioritization System
 *
 * Ranks knowledge entries by usage frequency, recency, and relevance.
 * Low-priority entries are candidates for eviction when storage is full.
 */

import type { KnowledgeEntry } from '@core/types.js';

export interface PriorityScore {
  entryId: string;
  score: number;
  factors: {
    recency: number;
    frequency: number;
    category: number;
  };
}

export class PrioritySystem {
  private categoryWeights: Map<string, number> = new Map();

  /**
   * Set importance weight for a knowledge category.
   * Higher weight = higher priority.
   */
  setCategoryWeight(category: string, weight: number): void {
    this.categoryWeights.set(category, weight);
  }

  /**
   * Calculate priority scores for all entries.
   */
  score(entries: KnowledgeEntry[]): PriorityScore[] {
    const now = Date.now();
    const maxUsage = Math.max(...entries.map((e) => e.usageCount), 1);

    return entries.map((entry) => {
      // Recency: exponential decay over 30 days
      const ageMs = now - entry.lastUsedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recency = Math.exp(-ageDays / 30);

      // Frequency: normalized usage count
      const frequency = entry.usageCount / maxUsage;

      // Category weight
      const categoryWeight = this.categoryWeights.get(entry.category) ?? 0.5;

      // Weighted combination
      const score = recency * 0.4 + frequency * 0.4 + categoryWeight * 0.2;

      return {
        entryId: entry.id,
        score,
        factors: { recency, frequency, category: categoryWeight },
      };
    });
  }

  /**
   * Get entries that should be evicted (lowest priority).
   */
  getEvictionCandidates(entries: KnowledgeEntry[], count: number): string[] {
    const scores = this.score(entries);
    scores.sort((a, b) => a.score - b.score);
    return scores.slice(0, count).map((s) => s.entryId);
  }
}
