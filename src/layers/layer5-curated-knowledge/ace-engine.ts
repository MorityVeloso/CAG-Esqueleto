/**
 * Layer 5 — ACE (Agentic Context Engineering) Engine
 *
 * The self-managing layer. Automatically curates, prioritizes,
 * and maintains knowledge without manual intervention.
 *
 * Responsibilities:
 *  - Auto-categorize new knowledge
 *  - Track usage and prioritize high-value entries
 *  - Evict stale/low-value entries
 *  - Serve relevant knowledge for queries
 */

import type {
  ICuratedKnowledgeLayer,
  KnowledgeEntry,
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

  /** Embedding function for relevance search (injected) */
  private embedFn: ((text: string) => Promise<number[]>) | null = null;

  constructor(config: CAGConfig) {
    this.config = config;
  }

  setEmbeddingFunction(fn: (text: string) => Promise<number[]>): void {
    this.embedFn = fn;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.store.clear();
  }

  /**
   * Add a new knowledge entry.
   * Auto-evicts lowest priority entries if over limit.
   */
  async addKnowledge(entry: KnowledgeEntry): Promise<void> {
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
  }

  /**
   * Get knowledge entries most relevant to a query.
   *
   * Currently uses simple keyword matching.
   * TODO: Use embeddings for semantic relevance when embedFn is available.
   */
  async getRelevantKnowledge(query: string, limit = 5): Promise<KnowledgeEntry[]> {
    const allEntries = this.store.getAll();
    if (allEntries.length === 0) return [];

    // Simple keyword relevance scoring
    const queryWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

    const scored = allEntries.map((entry) => {
      const contentWords = entry.content.toLowerCase().split(/\W+/);
      const overlap = contentWords.filter((w) => queryWords.has(w)).length;
      return { entry, relevance: overlap };
    });

    scored.sort((a, b) => b.relevance - a.relevance);

    const results = scored.slice(0, limit).filter((s) => s.relevance > 0).map((s) => s.entry);

    // Record usage
    for (const entry of results) {
      this.store.recordUsage(entry.id);
    }

    return results;
  }

  /**
   * Re-prioritize all entries using the priority system.
   */
  async prioritize(): Promise<void> {
    if (!this.config.layers.curatedKnowledge.autoPrioritize) return;

    const entries = this.store.getAll();
    const scores = this.priority.score(entries);

    // Update priorities in store
    for (const score of scores) {
      const entry = this.store.get(score.entryId);
      if (entry) {
        entry.priority = score.score;
      }
    }
  }

  /**
   * Remove entries unused for 30+ days.
   */
  async removeStale(): Promise<number> {
    return this.store.removeStale(30);
  }

  getStore(): KnowledgeStore {
    return this.store;
  }
}
