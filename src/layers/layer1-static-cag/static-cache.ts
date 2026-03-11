/**
 * Layer 1 — Static CAG Cache
 *
 * Uses Anthropic's Prompt Caching to keep static knowledge in the API-side cache.
 * This avoids re-sending large system prompts on every request,
 * reducing both latency and input token costs by up to 90%.
 *
 * Key concept: Anthropic caches the prefix of your prompt. By placing static
 * knowledge at the beginning with cache_control breakpoints, subsequent
 * requests reuse the cached prefix automatically.
 */

import type {
  IStaticCagLayer,
  KnowledgeSource,
  CacheBreakpoint,
  CAGConfig,
} from '@core/types.js';
import { KnowledgeLoader } from './knowledge-loader.js';

export class StaticCagCache implements IStaticCagLayer {
  readonly name = 'static-cag';
  readonly order = 1;

  private readonly loader = new KnowledgeLoader();
  private readonly config: CAGConfig;
  private systemPrompt = '';
  private cacheBreakpoints: CacheBreakpoint[] = [];

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // No async initialization needed for static cache
  }

  async shutdown(): Promise<void> {
    this.loader.clear();
    this.systemPrompt = '';
  }

  /**
   * Load knowledge sources and build the system prompt.
   * Should be called once at startup or when knowledge changes.
   */
  async loadKnowledge(sources: KnowledgeSource[]): Promise<void> {
    this.loader.clear();
    await this.loader.load(sources);
    this.systemPrompt = this.loader.buildSystemPrompt();

    // Set cache breakpoint at end of static knowledge
    // This tells Anthropic to cache everything up to this point
    if (this.config.layers.staticCag.usePromptCaching) {
      this.cacheBreakpoints = [
        { type: 'ephemeral', position: this.systemPrompt.length },
      ];
    }
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getCacheBreakpoints(): CacheBreakpoint[] {
    return this.cacheBreakpoints;
  }

  invalidate(): void {
    this.systemPrompt = '';
    this.cacheBreakpoints = [];
    this.loader.clear();
  }

  getEstimatedTokens(): number {
    return this.loader.estimateTokens();
  }
}
