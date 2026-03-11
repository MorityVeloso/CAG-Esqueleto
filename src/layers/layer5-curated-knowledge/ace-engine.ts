/**
 * Layer 5 — ACE (Agentic Context Engineering) Engine
 *
 * The self-managing layer. Automatically curates, prioritizes,
 * and maintains knowledge without manual intervention.
 */

import type {
  ICuratedKnowledgeLayer,
  CuratedKnowledgeEntry,
  CAGConfig,
} from '@core/types.js';
import { KnowledgeStore } from './knowledge-store.js';
import { PrioritySystem } from './priority-system.js';

export class ACEEngine implements ICuratedKnowledgeLayer {
  readonly name = 'curated-knowledge';
  readonly order = 5;

  private readonly config: CAGConfig;
  private readonly store = new KnowledgeStore();
  private readonly priority = new PrioritySystem();

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.store.clear();
  }

  async addEntry(
    input: Omit<CuratedKnowledgeEntry, 'id' | 'usageCount' | 'lastUsedAt' | 'createdAt'>,
  ): Promise<CuratedKnowledgeEntry> {
    const entry: CuratedKnowledgeEntry = {
      ...input,
      id: `ck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      usageCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };

    this.store.add(entry);

    // Evict if over limit
    const maxEntries = this.config.layers.curatedKnowledge.maxEntries;
    if (this.store.size() > maxEntries) {
      const allEntries = this.store.getAll();
      const toEvict = this.priority.getEvictionCandidates(allEntries, this.store.size() - maxEntries);
      for (const id of toEvict) {
        this.store.remove(id);
      }
    }

    return entry;
  }

  async getRelevant(query: string, limit = 5): Promise<CuratedKnowledgeEntry[]> {
    const allEntries = this.store.getAll();
    if (allEntries.length === 0) return [];

    // Filter by minimum priority
    const minPriority = this.config.layers.curatedKnowledge.minPriority;
    const eligible = allEntries.filter((e) => e.priority >= minPriority);

    // Simple keyword relevance scoring
    const queryWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

    const scored = eligible.map((entry) => {
      const contentWords = entry.content.toLowerCase().split(/\W+/);
      const overlap = contentWords.filter((w) => queryWords.has(w)).length;
      return { entry, relevance: overlap };
    });

    scored.sort((a, b) => b.relevance - a.relevance);
    const results = scored.slice(0, limit).filter((s) => s.relevance > 0).map((s) => s.entry);

    for (const entry of results) {
      this.store.recordUsage(entry.id);
    }

    return results;
  }

  async decayPriorities(): Promise<void> {
    const factor = this.config.layers.curatedKnowledge.decayFactor;
    for (const entry of this.store.getAll()) {
      entry.priority = Math.max(0, entry.priority * factor);
    }
  }

  async removeStale(): Promise<number> {
    return this.store.removeStale(30);
  }

  getStore(): KnowledgeStore {
    return this.store;
  }
}
