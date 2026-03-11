/**
 * Layer 4 — Think Tool Engine
 *
 * Wraps Claude's extended thinking capability.
 * Uses configurable trigger patterns from config to decide when to activate.
 */

import type {
  IThinkToolLayer,
  ContextBlock,
  CAGConfig,
} from '@core/types.js';

export class ThinkEngine implements IThinkToolLayer {
  readonly name = 'think-tool';
  readonly order = 4;

  private readonly config: CAGConfig;
  private compiledPatterns: RegExp[] = [];

  constructor(config: CAGConfig) {
    this.config = config;
    this.compilePatterns();
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  /**
   * Determine if extended thinking should be activated.
   * Uses configurable trigger patterns from config.
   */
  shouldActivate(query: string, _context: ContextBlock[]): boolean {
    if (!this.config.layers.thinkTool.enabled) return false;

    for (const pattern of this.compiledPatterns) {
      if (pattern.test(query)) return true;
    }

    // Also activate for very long queries
    if (query.length > 500) return true;

    return false;
  }

  getThinkingBudget(): number {
    return this.config.layers.thinkTool.maxBudgetTokens;
  }

  private compilePatterns(): void {
    this.compiledPatterns = this.config.layers.thinkTool.triggerPatterns.map(
      (p) => new RegExp(p, 'i'),
    );
  }
}
