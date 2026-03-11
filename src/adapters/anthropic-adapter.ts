/**
 * Adapter — Anthropic Claude API
 *
 * Wraps @anthropic-ai/sdk to provide:
 *  - Message creation with prompt caching support
 *  - Extended thinking (Think Tool)
 *  - Token usage and cost calculation
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CAGConfig, Message, PricingConfig } from '@core/types.js';

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedCost: number;
}

export class AnthropicAdapter {
  private client: Anthropic;
  private readonly config: CAGConfig;

  constructor(config: CAGConfig) {
    this.config = config;
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async createMessage(params: {
    systemPrompt: string;
    messages: Message[];
    useThinking?: boolean;
    thinkingBudget?: number;
  }): Promise<{ content: string; thinkingProcess?: string; usage: AnthropicUsage }> {
    const { systemPrompt, messages, useThinking = false, thinkingBudget } = params;

    // Build system blocks with cache_control for prompt caching
    const system: Anthropic.Messages.TextBlockParam[] = [{
      type: 'text' as const,
      text: systemPrompt,
      ...(systemPrompt.length > 1000 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }];

    const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const requestParams: Anthropic.Messages.MessageCreateParams = {
      model: this.config.anthropic.model,
      max_tokens: this.config.anthropic.maxTokens,
      system,
      messages: apiMessages,
    };

    if (useThinking && thinkingBudget) {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget,
      };
    }

    const response = await this.client.messages.create(requestParams);

    // Extract text content
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
    );
    const content = textBlocks.map((b) => b.text).join('');

    // Extract thinking process if present
    const thinkingBlocks = response.content.filter(
      (block) => block.type === 'thinking',
    );
    const thinkingProcess = thinkingBlocks.length > 0
      ? thinkingBlocks.map((b) => (b as { thinking: string }).thinking).join('\n')
      : undefined;

    // Parse usage from API response
    const rawUsage = response.usage as Record<string, number>;
    const inputTokens = rawUsage['input_tokens'] ?? 0;
    const outputTokens = rawUsage['output_tokens'] ?? 0;
    const cachedInputTokens = rawUsage['cache_read_input_tokens'] ?? 0;

    const usage: AnthropicUsage = {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      estimatedCost: AnthropicAdapter.calculateCost(
        inputTokens,
        outputTokens,
        cachedInputTokens,
        this.config.anthropic.pricing,
      ),
    };

    return { content, thinkingProcess, usage };
  }

  /**
   * Calculate cost in USD based on Anthropic pricing.
   *
   * Fresh input tokens that were NOT cached are:
   *   totalInput - cachedInput (the cached ones get the discount)
   */
  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    pricing: PricingConfig,
  ): number {
    const freshInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    const freshInputCost = (freshInputTokens / 1_000_000) * pricing.inputTokens;
    const cachedInputCost = (cachedInputTokens / 1_000_000) * pricing.cachedInputTokens;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputTokens;
    return freshInputCost + cachedInputCost + outputCost;
  }

  getClient(): Anthropic {
    return this.client;
  }
}
