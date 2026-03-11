/**
 * CAG-Esqueleto — Main engine orchestrating the 5-layer architecture
 *
 * Flow:
 *  1. Check Semantic Cache (L3) for similar queries
 *  2. Build context: Static (L1) + Dynamic (L2) + Curated Knowledge (L5)
 *  3. Optionally wrap with Think Tool (L4) for complex queries
 *  4. Call Anthropic API with assembled context
 *  5. Cache the response (L3) and update analytics
 */

import type {
  CAGConfig,
  CAGResponse,
  CAGEvent,
  CAGEventHandler,
  IStaticCagLayer,
  IDynamicCagLayer,
  ISemanticCacheLayer,
  IThinkToolLayer,
  ICuratedKnowledgeLayer,
  Message,
  QueryContext,
  TokenUsage,
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

  async query(userMessage: string, conversationHistory: Message[] = []): Promise<CAGResponse> {
    if (!this.initialized) {
      throw new Error('CAGEngine not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    const layersUsed: string[] = [];

    // Step 1: Check semantic cache
    if (this.semanticCache) {
      const cached = await this.semanticCache.get(userMessage);
      if (cached) {
        this.emit({ type: 'cache_hit', query: userMessage, similarity: cached.similarity });
        layersUsed.push('semantic-cache');
        return {
          content: cached.response,
          layersUsed,
          tokenUsage: this.emptyTokenUsage(),
          cacheHit: true,
          thinkingUsed: false,
          latencyMs: Date.now() - startTime,
          metadata: { cachedSimilarity: cached.similarity },
        };
      }
      this.emit({ type: 'cache_miss', query: userMessage });
    }

    // Step 2: Build context from layers
    const contextParts: string[] = [];

    if (this.staticCag) {
      const systemPrompt = this.staticCag.getSystemPrompt();
      if (systemPrompt) {
        contextParts.push(systemPrompt);
        layersUsed.push('static-cag');
      }
    }

    if (this.curatedKnowledge) {
      const relevant = await this.curatedKnowledge.getRelevantKnowledge(userMessage, 5);
      if (relevant.length > 0) {
        const knowledgeBlock = relevant.map((k) => k.content).join('\n\n');
        contextParts.push(`<curated-knowledge>\n${knowledgeBlock}\n</curated-knowledge>`);
        layersUsed.push('curated-knowledge');
      }
    }

    // Step 3: Determine if thinking is needed
    const queryContext: QueryContext = {
      query: userMessage,
      conversationHistory,
      activeKnowledge: contextParts,
      complexity: 'moderate', // TODO: implement complexity detection
    };

    let useThinking = false;
    if (this.thinkTool && this.config.layers.thinkTool.enabled) {
      useThinking = this.thinkTool.shouldUseThinking(userMessage, queryContext);
      if (useThinking) {
        this.emit({ type: 'thinking_activated', query: userMessage });
        layersUsed.push('think-tool');
      }
    }

    // Step 4: Call Anthropic API
    // TODO: Implement actual API call via AnthropicAdapter
    const response = await this.callModel(userMessage, contextParts, conversationHistory, useThinking);

    // Step 5: Cache the response
    if (this.semanticCache && response.content) {
      await this.semanticCache.set(userMessage, response.content);
    }

    return {
      ...response,
      layersUsed,
      latencyMs: Date.now() - startTime,
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

  private async callModel(
    _userMessage: string,
    _contextParts: string[],
    _history: Message[],
    _useThinking: boolean,
  ): Promise<CAGResponse> {
    // Placeholder — will be implemented in Prompt 1 (Anthropic Adapter)
    throw new Error('AnthropicAdapter not yet connected. Implement in next phase.');
  }

  private emptyTokenUsage(): TokenUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      totalCost: 0,
    };
  }
}
