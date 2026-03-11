/**
 * Layer 5 — Knowledge Store
 *
 * In-memory store for curated knowledge entries with
 * usage tracking and optional persistence.
 */

import type { CuratedKnowledgeEntry } from '@core/types.js';

export class KnowledgeStore {
  private entries: Map<string, CuratedKnowledgeEntry> = new Map();

  add(entry: CuratedKnowledgeEntry): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): CuratedKnowledgeEntry | null {
    return this.entries.get(id) ?? null;
  }

  recordUsage(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.usageCount++;
      entry.lastUsedAt = new Date();
    }
  }

  getByCategory(category: string): CuratedKnowledgeEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  getAll(): CuratedKnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

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
