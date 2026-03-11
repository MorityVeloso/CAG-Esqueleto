/**
 * Adapter — Anthropic Claude API
 *
 * Wraps @anthropic-ai/sdk to provide:
 *  - Message creation with prompt caching support
 *  - Extended thinking (Think Tool)
 *  - Token counting
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CAGConfig, Message, ContextBlock } from '@core/types.js';

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
    contextBlocks?: ContextBlock[];
    useThinking?: boolean;
    thinkingBudget?: number;
  }): Promise<{ content: string; thinkingProcess?: string; usage: AnthropicUsage }> {
    const { systemPrompt, messages, useThinking = false, thinkingBudget } = params;

    // Build system with cache control
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

    const textBlocks = response.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
    );
    const content = textBlocks.map((b) => b.text).join('');

    // Extract thinking if present
    const thinkingBlocks = response.content.filter(
      (block) => block.type === 'thinking',
    );
    const thinkingProcess = thinkingBlocks.length > 0
      ? thinkingBlocks.map((b) => (b as { thinking: string }).thinking).join('\n')
      : undefined;

    const rawUsage = response.usage as Record<string, number>;
    const usage: AnthropicUsage = {
      inputTokens: rawUsage['input_tokens'] ?? 0,
      outputTokens: rawUsage['output_tokens'] ?? 0,
      cachedInputTokens: rawUsage['cache_read_input_tokens'] ?? 0,
      estimatedCost: 0,
    };

    return { content, thinkingProcess, usage };
  }

  getClient(): Anthropic {
    return this.client;
  }
}
