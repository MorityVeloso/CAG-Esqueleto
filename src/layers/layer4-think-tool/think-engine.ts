/**
 * Layer 4 — Think Tool Engine
 *
 * Wraps Claude's extended thinking capability.
 * Automatically activates for complex queries that benefit from
 * step-by-step reasoning (math, multi-constraint, comparisons).
 */

import type {
  IThinkToolLayer,
  Message,
  QueryContext,
  QueryComplexity,
  CAGConfig,
} from '@core/types.js';

/** Keywords that suggest a query needs deeper reasoning */
const COMPLEXITY_SIGNALS: Record<QueryComplexity, RegExp[]> = {
  simple: [],
  moderate: [
    /compare/i,
    /difference between/i,
    /pros and cons/i,
  ],
  complex: [
    /calculate/i,
    /analyze/i,
    /step[- ]by[- ]step/i,
    /trade[- ]?off/i,
    /if.*then.*else/i,
  ],
  multi_step: [
    /first.*then.*finally/i,
    /plan.*implement/i,
    /design.*architect/i,
    /multiple.*criteria/i,
  ],
};

export class ThinkEngine implements IThinkToolLayer {
  readonly name = 'think-tool';
  readonly order = 4;

  private readonly config: CAGConfig;

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  /**
   * Determine if extended thinking should be activated.
   * Uses heuristics: keyword signals + conversation length + query length.
   */
  shouldUseThinking(query: string, context: QueryContext): boolean {
    if (!this.config.layers.thinkTool.enabled) return false;

    const complexity = this.assessComplexity(query, context);
    return complexity === 'complex' || complexity === 'multi_step';
  }

  /**
   * Wrap messages to enable extended thinking in the API call.
   * Adds the thinking budget configuration.
   */
  wrapWithThinking(messages: Message[]): Message[] {
    // The actual thinking configuration is set at the API call level
    // (model parameter), not in messages. This method returns messages
    // unchanged but signals to the engine to use thinking params.
    return messages;
  }

  getThinkingBudget(): number {
    return this.config.layers.thinkTool.budgetTokens;
  }

  /**
   * Assess query complexity using keyword signals and context.
   */
  assessComplexity(query: string, context: QueryContext): QueryComplexity {
    // Check for multi_step signals first (highest complexity)
    for (const pattern of COMPLEXITY_SIGNALS.multi_step) {
      if (pattern.test(query)) return 'multi_step';
    }

    for (const pattern of COMPLEXITY_SIGNALS.complex) {
      if (pattern.test(query)) return 'complex';
    }

    for (const pattern of COMPLEXITY_SIGNALS.moderate) {
      if (pattern.test(query)) return 'moderate';
    }

    // Long queries or long conversation history suggest more complexity
    if (query.length > 500 || context.conversationHistory.length > 10) {
      return 'moderate';
    }

    return 'simple';
  }
}
