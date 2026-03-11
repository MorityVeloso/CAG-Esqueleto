/**
 * Layer 1 — Static CAG Cache
 *
 * Uses Anthropic's Prompt Caching to keep static knowledge in the API-side cache.
 * This avoids re-sending large system prompts on every request,
 * reducing both latency and input token costs by up to 90%.
 *
 * Prompt Caching rules:
 *  - Min 1024 tokens per cache breakpoint
 *  - Max 4 cache breakpoints per request
 *  - Blocks must be stable (same order always) — prefix matching
 *  - TTL ~5 minutes on Anthropic's side (ephemeral)
 */

import type {
  IStaticCagLayer,
  StaticSource,
  ContextBlock,
  CacheBlock,
  StaticLayerStats,
  CAGConfig,
} from '@core/types.js';
import { KnowledgeLoader, type LoadedSource } from './knowledge-loader.js';
import { countTokens } from '../../utils/token-counter.js';

/** Minimum tokens per cache checkpoint (Anthropic requirement) */
const MIN_CACHE_TOKENS = 1024;
/** Maximum cache breakpoints per request (Anthropic limit) */
const MAX_CACHE_BLOCKS = 4;

/**
 * Category group ordering for stable prefix (cache-friendly).
 * Rules/formulas change least often → always at prefix start.
 */
const CATEGORY_GROUP_ORDER: Record<string, number> = {
  rules_formulas: 0,
  parameters: 1,
  reference_data: 2,
  instructions: 3,
};

export class StaticCagCache implements IStaticCagLayer {
  readonly name = 'static-cag';
  readonly order = 1;

  private readonly loader = new KnowledgeLoader();
  private readonly config: CAGConfig;
  private systemPrompt = '';
  private lastSources: StaticSource[] = [];
  private lastLoadedAt: Date | null = null;

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const sources = this.config.layers.staticCAG.sources;
    if (sources.length > 0) {
      await this.loadSources(sources);
    }
  }

  async shutdown(): Promise<void> {
    this.loader.clear();
    this.systemPrompt = '';
  }

  /**
   * Load sources, validate token budget, and build the system prompt.
   */
  async loadSources(sources: StaticSource[]): Promise<void> {
    this.loader.clear();
    this.lastSources = sources;
    await this.loader.load(sources);

    // Validate total tokens don't exceed budget
    const totalTokens = this.loader.estimateTokens();
    const maxTokens = this.config.layers.staticCAG.maxTokens;
    if (totalTokens > maxTokens) {
      throw new Error(
        `Static knowledge (${totalTokens} tokens) exceeds maxTokens budget (${maxTokens}). ` +
        `Remove lower-priority sources or increase the limit.`,
      );
    }

    this.systemPrompt = this.loader.buildSystemPrompt();
    this.lastLoadedAt = new Date();
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
      cachedAt: this.lastLoadedAt ?? new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      metadata: { sourceCount: this.loader.getSourceCount() },
    }];
  }

  /**
   * Build Anthropic API formatted system blocks with cache_control.
   *
   * Strategy:
   *  1. Group sources by category (rules → params → reference → instructions)
   *  2. Create one block per category group with cache_control: ephemeral
   *  3. If a block has < 1024 tokens, merge it with the next block
   *  4. Max 4 blocks total (Anthropic limit)
   *
   * The output maps directly to Anthropic.Messages.TextBlockParam[].
   */
  buildCacheBlocks(): CacheBlock[] {
    const allSources = this.loader.getAll();
    if (allSources.length === 0) return [];

    // Group sources by category
    const groups = this.groupByCategory(allSources);

    // Build raw blocks (one per group)
    const rawBlocks: { text: string; tokens: number }[] = [];
    for (const [groupName, sources] of groups) {
      const header = this.getCategoryHeader(groupName);
      const content = sources.map((s) => s.formattedContent).join('\n\n');
      const text = `${header}\n${content}`;
      rawBlocks.push({ text, tokens: countTokens(text) });
    }

    // Merge small blocks (< MIN_CACHE_TOKENS) with the next block
    const mergedBlocks = this.mergeSmallBlocks(rawBlocks);

    // Limit to MAX_CACHE_BLOCKS
    const finalBlocks = this.limitBlocks(mergedBlocks);

    // Add cache_control to each block
    return finalBlocks.map((block) => ({
      type: 'text' as const,
      text: block.text,
      cache_control: { type: 'ephemeral' as const },
    }));
  }

  /**
   * Reload all sources (useful after rules change, deploy, etc.)
   */
  async refresh(): Promise<void> {
    if (this.lastSources.length === 0) return;
    await this.loadSources(this.lastSources);
  }

  /**
   * Get layer-specific statistics.
   */
  getLayerStats(): StaticLayerStats {
    return {
      totalTokens: this.loader.estimateTokens(),
      sourceCount: this.loader.getSourceCount(),
      cacheBlockCount: this.buildCacheBlocks().length,
      categories: this.loader.getCategories(),
      lastLoadedAt: this.lastLoadedAt,
    };
  }

  invalidate(): void {
    this.systemPrompt = '';
    this.loader.clear();
  }

  getEstimatedTokens(): number {
    return this.loader.estimateTokens();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Group loaded sources by normalized category.
   * Returns entries sorted by CATEGORY_GROUP_ORDER for stable prefixing.
   */
  private groupByCategory(sources: LoadedSource[]): Map<string, LoadedSource[]> {
    const groups = new Map<string, LoadedSource[]>();

    for (const source of sources) {
      const group = this.normalizeCategoryGroup(source.source.category);
      const existing = groups.get(group) ?? [];
      existing.push(source);
      groups.set(group, existing);
    }

    // Sort groups by stable order
    const sorted = new Map<string, LoadedSource[]>();
    const entries = Array.from(groups.entries())
      .sort(([a], [b]) => (CATEGORY_GROUP_ORDER[a] ?? 99) - (CATEGORY_GROUP_ORDER[b] ?? 99));

    for (const [key, value] of entries) {
      sorted.set(key, value);
    }

    return sorted;
  }

  /**
   * Merge blocks with < MIN_CACHE_TOKENS into the next block.
   */
  private mergeSmallBlocks(blocks: { text: string; tokens: number }[]): { text: string; tokens: number }[] {
    if (blocks.length <= 1) return blocks;

    const result: { text: string; tokens: number }[] = [];
    let accumText = '';
    let accumTokens = 0;

    for (const block of blocks) {
      accumText += (accumText ? '\n\n' : '') + block.text;
      accumTokens += block.tokens;

      if (accumTokens >= MIN_CACHE_TOKENS) {
        result.push({ text: accumText, tokens: accumTokens });
        accumText = '';
        accumTokens = 0;
      }
    }

    // Remaining accumulated content
    if (accumText) {
      if (result.length > 0) {
        // Merge leftover into the last block
        const last = result[result.length - 1]!;
        last.text += '\n\n' + accumText;
        last.tokens += accumTokens;
      } else {
        // Only block — keep even if small
        result.push({ text: accumText, tokens: accumTokens });
      }
    }

    return result;
  }

  /**
   * If more than MAX_CACHE_BLOCKS, merge the overflow into the last block.
   */
  private limitBlocks(blocks: { text: string; tokens: number }[]): { text: string; tokens: number }[] {
    if (blocks.length <= MAX_CACHE_BLOCKS) return blocks;

    const kept = blocks.slice(0, MAX_CACHE_BLOCKS - 1);
    const overflow = blocks.slice(MAX_CACHE_BLOCKS - 1);

    const mergedText = overflow.map((b) => b.text).join('\n\n');
    const mergedTokens = overflow.reduce((sum, b) => sum + b.tokens, 0);
    kept.push({ text: mergedText, tokens: mergedTokens });

    return kept;
  }

  private getCategoryHeader(group: string): string {
    const headers: Record<string, string> = {
      rules_formulas: '[CONHECIMENTO ESTÁTICO - REGRAS E FÓRMULAS]',
      parameters: '[CONHECIMENTO ESTÁTICO - PARÂMETROS]',
      reference_data: '[CONHECIMENTO ESTÁTICO - DADOS DE REFERÊNCIA]',
      instructions: '[CONHECIMENTO ESTÁTICO - INSTRUÇÕES DE CONTEXTO]',
    };
    return headers[group] ?? `[CONHECIMENTO ESTÁTICO - ${group.toUpperCase()}]`;
  }

  private normalizeCategoryGroup(category: string): string {
    const cat = category.toLowerCase();
    if (['business_rules', 'rules', 'formulas', 'regulations'].includes(cat)) return 'rules_formulas';
    if (['parameters', 'config', 'settings', 'configuration'].includes(cat)) return 'parameters';
    if (['reference', 'cadastros', 'data', 'reference_data', 'lookup'].includes(cat)) return 'reference_data';
    return 'instructions';
  }
}
