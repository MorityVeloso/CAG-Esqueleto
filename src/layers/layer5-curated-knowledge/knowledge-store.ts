/**
 * Layer 5 — Knowledge Store
 *
 * In-memory store for curated knowledge entries.
 * Supports full CRUD, keyword search, priority filtering,
 * usage tracking, and bulk operations.
 *
 * For production: swap for Supabase (PostgreSQL) via adapters.
 */

import type { CuratedKnowledgeEntry } from '@core/types.js';

export class KnowledgeStore {
  private entries: Map<string, CuratedKnowledgeEntry> = new Map();

  /**
   * Save (insert or upsert) a knowledge entry.
   * Returns the entry ID.
   */
  save(entry: CuratedKnowledgeEntry): string {
    this.entries.set(entry.id, entry);
    return entry.id;
  }

  /**
   * Get a single entry by ID.
   */
  getById(id: string): CuratedKnowledgeEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Get all entries in a specific category.
   */
  getByCategory(category: string): CuratedKnowledgeEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  /**
   * Get entries with priority >= minPriority, sorted by priority DESC.
   */
  getByPriority(minPriority: number, limit = 50): CuratedKnowledgeEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.priority >= minPriority)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }

  /**
   * Search entries by keyword matching in content and tags.
   * Returns entries sorted by number of keyword matches DESC.
   */
  search(query: string, limit = 10): CuratedKnowledgeEntry[] {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );

    if (queryWords.size === 0) return [];

    const scored = Array.from(this.entries.values()).map((entry) => {
      const contentWords = entry.content.toLowerCase().split(/\W+/);
      const tagWords = entry.tags.map((t) => t.toLowerCase());
      const allWords = [...contentWords, ...tagWords];
      const overlap = allWords.filter((w) => queryWords.has(w)).length;
      return { entry, relevance: overlap };
    });

    return scored
      .filter((s) => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  /**
   * Partially update an entry by ID.
   */
  update(id: string, updates: Partial<CuratedKnowledgeEntry>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    Object.assign(entry, updates);
  }

  /**
   * Record a usage event: increment count + update timestamp.
   */
  recordUsage(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.usageCount++;
      entry.lastUsedAt = new Date();
    }
  }

  /**
   * Delete a single entry by ID.
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Delete all entries with priority <= maxPriority.
   * Returns the number of entries removed.
   */
  deleteByPriority(maxPriority: number): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.priority <= maxPriority) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get the total number of entries.
   */
  count(): number {
    return this.entries.size;
  }

  /**
   * Get all entries (unsorted).
   */
  getAll(): CuratedKnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }
}
