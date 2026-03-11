/**
 * Layer 5 — Knowledge Store
 *
 * In-memory store for curated knowledge entries with
 * usage tracking and optional persistence.
 */

import type { KnowledgeEntry } from '@core/types.js';

export class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry> = new Map();

  add(entry: KnowledgeEntry): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): KnowledgeEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Mark entry as used (increments counter, updates timestamp).
   */
  recordUsage(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.usageCount++;
      entry.lastUsedAt = new Date();
    }
  }

  /**
   * Get entries by category.
   */
  getByCategory(category: string): KnowledgeEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  /**
   * Get all entries sorted by priority (usage count * recency).
   */
  getAll(): KnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Remove entries that haven't been used in `days` days.
   */
  removeStale(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, entry] of this.entries) {
      if (entry.lastUsedAt.getTime() < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    return removed;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
