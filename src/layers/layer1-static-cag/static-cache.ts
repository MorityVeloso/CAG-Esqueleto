/**
 * Layer 1 — Static CAG Cache
 *
 * Uses Anthropic's Prompt Caching to keep static knowledge in the API-side cache.
 * This avoids re-sending large system prompts on every request,
 * reducing both latency and input token costs by up to 90%.
 */

import type {
  IStaticCagLayer,
  StaticSource,
  ContextBlock,
  CAGConfig,
} from '@core/types.js';
import { KnowledgeLoader } from './knowledge-loader.js';

export class StaticCagCache implements IStaticCagLayer {
  readonly name = 'static-cag';
  readonly order = 1;

  private readonly loader = new KnowledgeLoader();
  private readonly config: CAGConfig;
  private systemPrompt = '';

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Auto-load sources from config if provided
    const sources = this.config.layers.staticCAG.sources;
    if (sources.length > 0) {
      await this.loadSources(sources);
    }
  }

  async shutdown(): Promise<void> {
    this.loader.clear();
    this.systemPrompt = '';
  }

  async loadSources(sources: StaticSource[]): Promise<void> {
    this.loader.clear();
    await this.loader.load(sources);
    this.systemPrompt = this.loader.buildSystemPrompt();
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getContextBlocks(): ContextBlock[] {
    if (!this.systemPrompt) return [];

    const ttlMs = this.config.layers.staticCAG.ttl * 1000;
    return [{
      id: 'static-cag-main',
      layer: 'static',
      content: this.systemPrompt,
      tokenCount: this.loader.estimateTokens(),
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      metadata: { sourceCount: this.loader.getSourceCount() },
    }];
  }

  invalidate(): void {
    this.systemPrompt = '';
    this.loader.clear();
  }

  getEstimatedTokens(): number {
    return this.loader.estimateTokens();
  }
}
