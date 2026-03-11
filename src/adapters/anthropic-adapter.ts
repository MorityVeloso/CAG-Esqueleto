/**
 * Adapter — Anthropic Claude API
 *
 * Wraps @anthropic-ai/sdk to provide:
 *  - Message creation with prompt caching support
 *  - Extended thinking (Think Tool)
 *  - Embedding generation (for semantic cache)
 *  - Token counting
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CAGConfig, Message, TokenUsage, CacheBreakpoint } from '@core/types.js';

export class AnthropicAdapter {
  private client: Anthropic;
  private readonly config: CAGConfig;

  constructor(config: CAGConfig) {
    this.config = config;
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  /**
   * Send a message to Claude with optional prompt caching and thinking.
   */
  async createMessage(params: {
    systemPrompt: string;
    messages: Message[];
    cacheBreakpoints?: CacheBreakpoint[];
    useThinking?: boolean;
    thinkingBudget?: number;
  }): Promise<{ content: string; usage: TokenUsage }> {
    const { systemPrompt, messages, cacheBreakpoints = [], useThinking = false, thinkingBudget } = params;

    // Build system with cache control
    const system: Anthropic.Messages.TextBlockParam[] = [{
      type: 'text' as const,
      text: systemPrompt,
      ...(cacheBreakpoints.length > 0 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }];

    // Build messages
    const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    // Build request params
    const requestParams: Anthropic.Messages.MessageCreateParams = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system,
      messages: apiMessages,
    };

    // Add thinking if enabled
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

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: (response.usage as Record<string, number>)['cache_read_input_tokens'] ?? 0,
      cacheCreationTokens: (response.usage as Record<string, number>)['cache_creation_input_tokens'] ?? 0,
      thinkingTokens: 0, // TODO: extract from thinking blocks
      totalCost: 0, // TODO: calculate based on model pricing
    };

    return { content, usage };
  }

  /**
   * Get the underlying Anthropic client for advanced use cases.
   */
  getClient(): Anthropic {
    return this.client;
  }
}
