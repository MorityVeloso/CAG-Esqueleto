/**
 * Layer 4 — Think Tool Engine
 *
 * Provides a dedicated "think" tool that Claude can invoke during its
 * chain-of-thought to reason through complex problems step-by-step.
 *
 * Unlike Extended Thinking (automatic), the Think Tool is explicit:
 *  - Claude calls it as a tool during the response
 *  - The reasoning is captured in the API response for logging/audit
 *  - Task-specific instructions can be injected via ComplexTaskRegistry
 *
 * Ideal for: calculations, reconciliations, multi-variable analysis,
 * comparisons, and multi-rule decisions.
 */

import type {
  IThinkToolLayer,
  ContextBlock,
  CAGConfig,
  AnthropicToolDef,
  AnthropicToolResponse,
  ThinkResult,
} from '@core/types.js';
import { ComplexTaskRegistry } from './complex-tasks.js';

/** Default trigger patterns for Think Tool activation */
const DEFAULT_PATTERNS: string[] = [
  'calcul',
  'compar',
  'concili',
  'simul',
  'analys|analis',
  'optim',
  'which.*best|qual.*melhor',
  'step.by.step|passo.a.passo',
  'explain.why|explique.por',
];

export class ThinkEngine implements IThinkToolLayer {
  readonly name = 'think-tool';
  readonly order = 4;

  private readonly config: CAGConfig;
  private readonly registry: ComplexTaskRegistry;
  private compiledPatterns: RegExp[] = [];

  constructor(config: CAGConfig) {
    this.config = config;
    this.registry = new ComplexTaskRegistry();
    this.compilePatterns();
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  /**
   * Determine if the Think Tool should be activated for this query.
   *
   * Checks:
   *  1. Config-level triggerPatterns (from user config)
   *  2. Default patterns (built-in)
   *  3. ComplexTaskRegistry matches
   *  4. Very long queries (>500 chars)
   */
  shouldActivate(query: string, _context: ContextBlock[]): boolean {
    if (!this.config.layers.thinkTool.enabled) return false;

    // Check config trigger patterns
    for (const pattern of this.compiledPatterns) {
      if (pattern.test(query)) return true;
    }

    // Check ComplexTaskRegistry
    if (this.registry.matchQuery(query)) return true;

    // Long queries often benefit from structured thinking
    if (query.length > 500) return true;

    return false;
  }

  /**
   * Get the budget in tokens for thinking.
   */
  getThinkingBudget(): number {
    return this.config.layers.thinkTool.maxBudgetTokens;
  }

  /**
   * Get the Anthropic tool definition for the "think" tool.
   * This is passed to the API in the `tools` parameter.
   */
  getToolDefinition(): AnthropicToolDef {
    return {
      name: 'think',
      description:
        'Use this tool to think through complex problems step-by-step before providing your answer. ' +
        'Break down the problem, consider multiple approaches, perform calculations, and reason through ' +
        'the solution. Your thinking will not be shown to the user but will help you provide a more accurate response.',
      input_schema: {
        type: 'object',
        properties: {
          reasoning: {
            type: 'string',
            description: 'Your detailed step-by-step reasoning process',
          },
          conclusion: {
            type: 'string',
            description: 'The conclusion reached after reasoning',
          },
        },
        required: ['reasoning'],
      },
    };
  }

  /**
   * Extract thinking result from an Anthropic API response.
   * Returns null if the Think Tool was not invoked.
   */
  extractThinking(response: AnthropicToolResponse): ThinkResult | null {
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'think') {
        const input = block.input;
        return {
          reasoning: (input['reasoning'] as string) ?? '',
          conclusion: (input['conclusion'] as string) ?? '',
          tokensUsed: response.usage?.output_tokens ?? 0,
        };
      }
    }
    return null;
  }

  /**
   * Build tool configuration for the API call.
   * Uses tool_choice: "auto" so Claude decides when to invoke it.
   */
  buildToolConfig(): { tools: AnthropicToolDef[]; tool_choice: { type: string } } {
    return {
      tools: [this.getToolDefinition()],
      tool_choice: { type: 'auto' },
    };
  }

  /**
   * Get the ComplexTaskRegistry for registering custom tasks.
   */
  getRegistry(): ComplexTaskRegistry {
    return this.registry;
  }

  /**
   * Get the system prompt addition for a matched complex task.
   * Returns null if no task matches the query.
   */
  getTaskPromptAddition(query: string): string | null {
    const task = this.registry.matchQuery(query);
    return task?.systemPromptAddition ?? null;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private compilePatterns(): void {
    const configPatterns = this.config.layers.thinkTool.triggerPatterns;

    // Merge config patterns with defaults (deduplicate)
    const allPatterns = new Set([...DEFAULT_PATTERNS, ...configPatterns]);

    this.compiledPatterns = Array.from(allPatterns).map((p) => new RegExp(p, 'i'));
  }
}
