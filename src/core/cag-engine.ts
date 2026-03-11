/**
 * CAG-Esqueleto — Main engine orchestrating the 5-layer architecture
 *
 * Flow:
 *  1. Check Semantic Cache (L3) for similar queries
 *  2. Build context: Static (L1) + Dynamic (L2) + Curated Knowledge (L5)
 *  3. Optionally activate Think Tool (L4) for complex queries
 *  4. Call Anthropic API with assembled context
 *  5. Cache the response (L3) and track analytics
 */

import type {
  CAGConfig,
  CAGQuery,
  CAGResponse,
  CAGEvent,
  CAGEventHandler,
  IStaticCagLayer,
  IDynamicCagLayer,
  ISemanticCacheLayer,
  IThinkToolLayer,
  ICuratedKnowledgeLayer,
  AssembledContext,
  ContextBlock,
} from './types.js';

export class CAGEngine {
  private readonly config: CAGConfig;
  private readonly eventHandlers: CAGEventHandler[] = [];

  private staticCag: IStaticCagLayer | null = null;
  private dynamicCag: IDynamicCagLayer | null = null;
  private semanticCache: ISemanticCacheLayer | null = null;
  private thinkTool: IThinkToolLayer | null = null;
  private curatedKnowledge: ICuratedKnowledgeLayer | null = null;

  private initialized = false;

  constructor(config: CAGConfig) {
    this.config = config;
  }

  // ─── Layer Registration ──────────────────────────────────────────────────

  registerStaticCag(layer: IStaticCagLayer): this {
    this.staticCag = layer;
    return this;
  }

  registerDynamicCag(layer: IDynamicCagLayer): this {
    this.dynamicCag = layer;
    return this;
  }

  registerSemanticCache(layer: ISemanticCacheLayer): this {
    this.semanticCache = layer;
    return this;
  }

  registerThinkTool(layer: IThinkToolLayer): this {
    this.thinkTool = layer;
    return this;
  }

  registerCuratedKnowledge(layer: ICuratedKnowledgeLayer): this {
    this.curatedKnowledge = layer;
    return this;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const layers = this.getAllLayers();
    for (const layer of layers) {
      await layer.initialize();
    }
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    const layers = this.getAllLayers().reverse();
    for (const layer of layers) {
      await layer.shutdown();
    }
    this.initialized = false;
  }

  // ─── Main Query ──────────────────────────────────────────────────────────

  async query(input: string | CAGQuery): Promise<CAGResponse> {
    if (!this.initialized) {
      throw new Error('CAGEngine not initialized. Call initialize() first.');
    }

    const cagQuery: CAGQuery = typeof input === 'string'
      ? { message: input }
      : input;

    const startTime = Date.now();
    const layersUsed: string[] = [];
    let cacheCheckMs = 0;
    let contextAssemblyMs = 0;

    // Step 1: Check semantic cache (unless forceRefresh)
    if (this.semanticCache && this.config.layers.semanticCache.enabled && !cagQuery.forceRefresh) {
      const cacheStart = Date.now();
      const cached = await this.semanticCache.get(cagQuery.message);
      cacheCheckMs = Date.now() - cacheStart;

      if (cached) {
        this.emit({ type: 'cache_hit', query: cagQuery.message, similarity: 1 });
        layersUsed.push('semantic_cache');
        return {
          answer: cached.responseText,
          context: this.emptyContext(),
          cacheHit: true,
          semanticCacheKey: cached.id,
          processingTime: { total: Date.now() - startTime, contextAssembly: 0, llmCall: 0, cacheCheck: cacheCheckMs },
          usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: 0 },
        };
      }
      this.emit({ type: 'cache_miss', query: cagQuery.message });
    }

    // Step 2: Assemble context from layers
    const assemblyStart = Date.now();
    const contextBlocks: ContextBlock[] = [];

    if (this.staticCag && this.config.layers.staticCAG.enabled) {
      const blocks = this.staticCag.getContextBlocks();
      contextBlocks.push(...blocks);
      if (blocks.length > 0) layersUsed.push('static');
    }

    if (this.dynamicCag && this.config.layers.dynamicCAG.enabled) {
      const snapshot = await this.dynamicCag.getLatestSnapshot();
      if (snapshot) {
        contextBlocks.push(snapshot);
        layersUsed.push('dynamic');
      }
    }

    if (this.curatedKnowledge && this.config.layers.curatedKnowledge.enabled) {
      const relevant = await this.curatedKnowledge.getRelevant(cagQuery.message, 5);
      if (relevant.length > 0) {
        const block: ContextBlock = {
          id: 'curated-knowledge',
          layer: 'curated',
          content: relevant.map((k) => k.content).join('\n\n'),
          tokenCount: 0,
          cachedAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000),
          metadata: { entryCount: relevant.length },
        };
        contextBlocks.push(block);
        layersUsed.push('curated');
      }
    }

    contextAssemblyMs = Date.now() - assemblyStart;

    // Step 3: Check if thinking should be activated
    let useThinking = false;
    if (this.thinkTool && this.config.layers.thinkTool.enabled) {
      useThinking = this.thinkTool.shouldActivate(cagQuery.message, contextBlocks);
      if (useThinking) {
        this.emit({
          type: 'thinking_activated',
          query: cagQuery.message,
          budgetTokens: this.thinkTool.getThinkingBudget(),
        });
        layersUsed.push('think');
      }
    }

    // Step 4: Call Anthropic API
    const llmStart = Date.now();
    const response = await this.callModel(cagQuery, contextBlocks, useThinking);
    const llmMs = Date.now() - llmStart;

    // Step 5: Cache the response
    if (this.semanticCache && this.config.layers.semanticCache.enabled && response.answer) {
      await this.semanticCache.set(cagQuery.message, response.answer);
    }

    return {
      ...response,
      context: this.assembleContext(contextBlocks),
      cacheHit: false,
      processingTime: {
        total: Date.now() - startTime,
        contextAssembly: contextAssemblyMs,
        llmCall: llmMs,
        cacheCheck: cacheCheckMs,
      },
    };
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  on(handler: CAGEventHandler): void {
    this.eventHandlers.push(handler);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private emit(event: CAGEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let event handler errors break the engine
      }
    }
  }

  private getAllLayers() {
    return [
      this.staticCag,
      this.dynamicCag,
      this.semanticCache,
      this.thinkTool,
      this.curatedKnowledge,
    ].filter((l): l is NonNullable<typeof l> => l !== null);
  }

  private assembleContext(blocks: ContextBlock[]): AssembledContext {
    const totalTokens = blocks.reduce((sum, b) => sum + b.tokenCount, 0);
    return {
      blocks,
      totalTokens,
      cachedTokens: 0,
      freshTokens: totalTokens,
      costEstimate: { cachedInputCost: 0, freshInputCost: 0, totalEstimatedCost: 0 },
      layerStats: blocks.map((b) => ({ layer: b.layer, tokens: b.tokenCount })),
    };
  }

  private emptyContext(): AssembledContext {
    return { blocks: [], totalTokens: 0, cachedTokens: 0, freshTokens: 0, costEstimate: { cachedInputCost: 0, freshInputCost: 0, totalEstimatedCost: 0 }, layerStats: [] };
  }

  private async callModel(
    _query: CAGQuery,
    _context: ContextBlock[],
    _useThinking: boolean,
  ): Promise<CAGResponse> {
    // Placeholder — implemented in next phase with AnthropicAdapter
    throw new Error('AnthropicAdapter not yet connected. Implement in next phase.');
  }
}
