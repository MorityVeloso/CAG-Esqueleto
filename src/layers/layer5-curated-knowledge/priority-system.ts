/**
 * Layer 5 — Priority System
 *
 * Stateless calculation module for knowledge entry priorities.
 * Handles initial scoring, boosting, penalizing, and pruning decisions.
 *
 * Priority range: 0.0 (dead) → 1.0 (maximum importance)
 *
 * Initial priorities by source:
 *   user_taught:    0.7 (explicitly taught — high confidence)
 *   auto_extracted: 0.5 (system inferred — medium confidence)
 *   feedback_loop:  0.6 (learned from feedback — medium-high)
 */

import type { KnowledgeSource } from '@core/types.js';

/** Initial priority values by knowledge source */
const INITIAL_PRIORITIES: Record<KnowledgeSource, number> = {
  user_taught: 0.7,
  auto_extracted: 0.5,
  feedback_loop: 0.6,
};

/** Boost amounts by reason */
const BOOST_AMOUNTS: Record<'usage' | 'positive_feedback', number> = {
  usage: 0.02,
  positive_feedback: 0.1,
};

/** Penalty amounts by reason */
const PENALTY_AMOUNTS: Record<'negative_feedback', number> = {
  negative_feedback: 0.15,
};

/** Priority below which an entry is considered dead and should be pruned */
const PRUNE_THRESHOLD = 0.05;

export class PrioritySystem {
  /**
   * Calculate the initial priority for a new knowledge entry.
   */
  calculateInitialPriority(source: KnowledgeSource): number {
    return INITIAL_PRIORITIES[source];
  }

  /**
   * Boost an entry's priority. Capped at 1.0.
   */
  boostPriority(current: number, reason: 'usage' | 'positive_feedback'): number {
    return Math.min(1.0, current + BOOST_AMOUNTS[reason]);
  }

  /**
   * Penalize an entry's priority. Floored at 0.0.
   *
   * For decay, use `applyDecay()` instead — it uses multiplicative decay.
   */
  penalizePriority(current: number, reason: 'negative_feedback' | 'decay', decayFactor = 0.95): number {
    if (reason === 'decay') {
      return Math.max(0, current * decayFactor);
    }
    return Math.max(0, current - PENALTY_AMOUNTS[reason]);
  }

  /**
   * Check if an entry's priority is above the inclusion threshold.
   */
  shouldInclude(priority: number, minPriority: number): boolean {
    return priority >= minPriority;
  }

  /**
   * Check if an entry's priority is so low it should be pruned entirely.
   * Entries below 0.05 are considered "dead".
   */
  shouldPrune(priority: number): boolean {
    return priority < PRUNE_THRESHOLD;
  }
}
