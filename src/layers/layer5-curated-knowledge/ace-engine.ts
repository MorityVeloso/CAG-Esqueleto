/**
 * Layer 5 — ACE (Agentic Context Engineering) Engine
 *
 * The self-managing knowledge layer. Learns from:
 *  - Explicit teaching (teach) → priority 0.7
 *  - Conversation extraction (autoExtract) → priority 0.5
 *  - User feedback (feedback) → boost or penalize
 *
 * Over time, unused knowledge decays and gets pruned,
 * while frequently-used knowledge rises in priority.
 * This creates a self-curating context that evolves.
 */

import type {
  ICuratedKnowledgeLayer,
  CuratedKnowledgeEntry,
  CuratedKnowledgeStats,
  ContextBlock,
  CAGConfig,
  Message,
} from '@core/types.js';
import { KnowledgeStore } from './knowledge-store.js';
import { PrioritySystem } from './priority-system.js';
import { estimateTokens } from '../../utils/token-counter.js';

/** Patterns that suggest a user correction in conversation */
const CORRECTION_PATTERNS = [
  /n[aã]o[,.]?\s*(na verdade|na real|o certo|o correto)/i,
  /no[,.]?\s*(actually|the correct|it'?s actually)/i,
  /errado|wrong|incorrect/i,
  /a resposta certa|the right answer/i,
  /deixa eu corrigir|let me correct/i,
];

/** Patterns that suggest new information being taught */
const TEACHING_PATTERNS = [
  /saiba que|you should know/i,
  /lembre[- ]se|remember that/i,
  /importante[: ]/i,
  /regra[: ]|rule[: ]/i,
  /sempre que|whenever/i,
  /nunca|never/i,
  /a pol[ií]tica [eé]|the policy is/i,
];

export class ACEEngine implements ICuratedKnowledgeLayer {
  readonly name = 'curated-knowledge';
  readonly order = 5;

  private readonly config: CAGConfig;
  private readonly store: KnowledgeStore;
  private readonly priority: PrioritySystem;
  private feedbackLog: Array<{ entryId: string; helpful: boolean; timestamp: Date }> = [];

  constructor(config: CAGConfig) {
    this.config = config;
    this.store = new KnowledgeStore();
    this.priority = new PrioritySystem();
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.store.clear();
  }

  /**
   * Explicitly teach the system new knowledge.
   * Creates an entry with source='user_taught' and priority 0.7.
   */
  async teach(
    content: string,
    category: string,
    tags: string[] = [],
    createdBy?: string,
  ): Promise<CuratedKnowledgeEntry> {
    const entry: CuratedKnowledgeEntry = {
      id: `ck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      source: 'user_taught',
      category,
      priority: this.priority.calculateInitialPriority('user_taught'),
      usageCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      createdBy,
      tags,
    };

    this.store.save(entry);
    this.evictIfNeeded();
    return entry;
  }

  /**
   * Auto-extract knowledge from a conversation.
   *
   * Scans user messages for correction patterns (e.g. "no, actually...")
   * or teaching patterns (e.g. "remember that...", "the policy is...").
   *
   * Returns null if nothing extractable is detected.
   */
  async autoExtract(
    conversation: Message[],
    _response: string,
  ): Promise<CuratedKnowledgeEntry | null> {
    // Only look at user messages for corrections/teachings
    const userMessages = conversation.filter((m) => m.role === 'user');
    if (userMessages.length === 0) return null;

    // Check the last user message for patterns
    const lastUserMessage = userMessages[userMessages.length - 1]!;
    const text = lastUserMessage.content;

    const isCorrection = CORRECTION_PATTERNS.some((p) => p.test(text));
    const isTeaching = TEACHING_PATTERNS.some((p) => p.test(text));

    if (!isCorrection && !isTeaching) return null;

    const entry: CuratedKnowledgeEntry = {
      id: `ck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: text,
      source: 'auto_extracted',
      category: isCorrection ? 'correction' : 'learned',
      priority: this.priority.calculateInitialPriority('auto_extracted'),
      usageCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      tags: isCorrection ? ['auto', 'correction'] : ['auto', 'learned'],
    };

    this.store.save(entry);
    this.evictIfNeeded();
    return entry;
  }

  /**
   * Get relevant knowledge as a formatted context block.
   *
   * Filters by minPriority, scores by keyword relevance,
   * and fits entries within the token budget.
   */
  async getRelevantKnowledge(query: string, maxTokens: number): Promise<ContextBlock> {
    const minPriority = this.config.layers.curatedKnowledge.minPriority;

    // Get eligible entries above minimum priority
    const eligible = this.store.getByPriority(minPriority);

    // Score by keyword relevance to the query
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );

    const scored = eligible.map((entry) => {
      const contentWords = entry.content.toLowerCase().split(/\W+/);
      const tagWords = entry.tags.map((t) => t.toLowerCase());
      const allWords = [...contentWords, ...tagWords];
      const overlap = allWords.filter((w) => queryWords.has(w)).length;
      // Combine keyword relevance with stored priority
      const score = overlap * 0.6 + entry.priority * 0.4;
      return { entry, score, overlap };
    });

    // Sort by combined score, filter out zero-relevance
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter((s) => s.overlap > 0);

    // Build content respecting maxTokens
    const lines: string[] = [];
    let currentTokens = estimateTokens('[CONHECIMENTO CURADO]\n');

    for (const { entry } of relevant) {
      const line = `- [${entry.category}] ${entry.content}`;
      const lineTokens = estimateTokens(line + '\n');

      if (currentTokens + lineTokens > maxTokens) break;

      lines.push(line);
      currentTokens += lineTokens;
    }

    const content =
      lines.length > 0 ? '[CONHECIMENTO CURADO]\n' + lines.join('\n') : '';

    const now = new Date();
    return {
      id: `curated-${now.getTime()}`,
      layer: 'curated',
      content,
      tokenCount: estimateTokens(content),
      cachedAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
      metadata: { entriesIncluded: lines.length },
    };
  }

  /**
   * Record that a knowledge entry was used.
   * Boosts priority by +0.02 (usage boost).
   */
  async recordUsage(entryId: string): Promise<void> {
    const entry = this.store.getById(entryId);
    if (!entry) return;

    this.store.recordUsage(entryId);
    entry.priority = this.priority.boostPriority(entry.priority, 'usage');
  }

  /**
   * Apply priority decay to ALL entries.
   * Entries that drop below the prune threshold (0.05) are removed.
   */
  async decayPriorities(): Promise<void> {
    const factor = this.config.layers.curatedKnowledge.decayFactor;

    for (const entry of this.store.getAll()) {
      entry.priority = this.priority.penalizePriority(entry.priority, 'decay', factor);
    }

    // Prune dead entries
    const toPrune = this.store.getAll().filter((e) => this.priority.shouldPrune(e.priority));
    for (const entry of toPrune) {
      this.store.delete(entry.id);
    }
  }

  /**
   * Provide feedback on a knowledge entry.
   * Positive: boost +0.10 | Negative: penalty -0.15
   */
  async feedback(entryId: string, helpful: boolean): Promise<void> {
    const entry = this.store.getById(entryId);
    if (!entry) return;

    if (helpful) {
      entry.priority = this.priority.boostPriority(entry.priority, 'positive_feedback');
    } else {
      entry.priority = this.priority.penalizePriority(entry.priority, 'negative_feedback');
    }

    this.feedbackLog.push({ entryId, helpful, timestamp: new Date() });
  }

  /**
   * Get layer statistics.
   */
  getStats(): CuratedKnowledgeStats {
    const all = this.store.getAll();

    const categoryCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let totalPriority = 0;

    for (const entry of all) {
      categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
      sourceCounts[entry.source] = (sourceCounts[entry.source] ?? 0) + 1;
      totalPriority += entry.priority;
    }

    return {
      totalEntries: all.length,
      avgPriority: all.length > 0 ? totalPriority / all.length : 0,
      categoryCounts,
      sourceCounts,
    };
  }

  /**
   * Get the underlying store (for testing/advanced use).
   */
  getStore(): KnowledgeStore {
    return this.store;
  }

  /**
   * Get the priority system (for testing/advanced use).
   */
  getPrioritySystem(): PrioritySystem {
    return this.priority;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /**
   * Evict lowest-priority entries when store exceeds maxEntries.
   */
  private evictIfNeeded(): void {
    const maxEntries = this.config.layers.curatedKnowledge.maxEntries;
    if (this.store.count() <= maxEntries) return;

    const all = this.store.getAll();
    all.sort((a, b) => a.priority - b.priority);

    const toRemove = this.store.count() - maxEntries;
    for (let i = 0; i < toRemove; i++) {
      this.store.delete(all[i]!.id);
    }
  }
}
